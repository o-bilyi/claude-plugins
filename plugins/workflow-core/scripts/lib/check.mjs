import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { baselineSignature, buildInfoFile, head, parseOutput, readBaseline } from './baseline.mjs';
import { compareCounts, errorPath } from './parsers.mjs';
import { excerpt, runCommand, safeName, withIncremental } from './run.mjs';
import { expand, hasExt, matchesAny, missingTool } from './shell.mjs';
import { checkApplies, entryPath, touched, unitFiles, unitPaths } from './touched.mjs';

const fpFile = (repo, unit) => join(repo.state, 'checked', `${safeName(unit)}.fp`);
const UNTOUCHED_LIMIT = 200;

export function fingerprint(model, unit, touchedResult) {
	const hash = createHash('sha1');
	hash.update(`${head(model.repos[unit.repo]) ?? ''}\n`);
	for (const repo of Object.values(touchedResult.repos)) {
		for (const entry of repo.projectEntries) {
			if (matchesAny(entryPath(entry), unit.triggers)) hash.update(`${entry}\n`);
		}
	}
	hash.update(JSON.stringify({ unit, extensions: model.config.extensions }));
	hash.update(baselineSignature(model.repos[unit.repo], unit.name));
	return hash.digest('hex');
}

export function checkLabel(check, mode) {
	if (check.kind !== 'test') return check.name;
	const name = check.name === 'test' ? 'tests' : check.name;
	return mode === 'related' ? `${name} (related)` : name;
}

function chooseCommand(check, { hasBaseline, files }) {
	if (check.kind === 'test') {
		if (check.run && check.fullWhen && files.some(f => matchesAny(f, check.fullWhen))) {
			return { mode: 'run', template: check.run };
		}
		if (check.related) return { mode: 'related', template: check.related };
		return { mode: 'run', template: check.run };
	}
	if (!hasBaseline && check.changed) return { mode: 'changed', template: check.changed };
	return { mode: 'run', template: check.run };
}

function untouchedCounts(counts, paths) {
	const touchedPaths = new Set(paths);
	return new Map([...counts].filter(([line]) => !touchedPaths.has(errorPath(line))));
}

function judge(check, result, { cwd, baseline, paths, label }) {
	if (check.parser) {
		const parsed = parseOutput(check.parser, result, cwd);
		if (parsed.ok) {
			const reference = baseline ?? untouchedCounts(parsed.counts, paths);
			const { caused, preExisting } = compareCounts(parsed.counts, reference);
			const verdict = { status: caused.length ? 'fail' : 'pass', caused, preExisting };
			if (baseline) return verdict;
			const untouched = [...reference.keys()].sort();
			return {
				...verdict,
				untouched: untouched.slice(0, UNTOUCHED_LIMIT),
				untouchedTruncated: Math.max(0, untouched.length - UNTOUCHED_LIMIT),
			};
		}
		const warning = `${label}: unparseable output, judged by exit code (${parsed.reason})`;
		return { ...judgeExitCode(check, result), warning };
	}
	return judgeExitCode(check, result);
}

function judgeExitCode(check, result) {
	if (result.code === 0) return { status: 'pass' };
	return { status: 'fail', raw: excerpt(result.output, check.kind === 'test' ? 'tail' : 'head') };
}

async function runCheck(model, unit, check, ctx) {
	const base = { name: check.name, kind: check.kind, label: `${unit.name} ${check.name}` };
	if (!checkApplies(check, ctx.touched.files)) {
		return { ...base, status: 'skipped', reason: 'its paths are not touched', silent: true };
	}
	const repo = model.repos[unit.repo];
	const baseline = check.parser ? readBaseline(repo, unit.name, check.name) : null;
	const { mode, template } = chooseCommand(check, {
		hasBaseline: Boolean(baseline),
		files: ctx.touched.files,
	});
	const label = `${unit.name} ${checkLabel(check, mode)}`;
	if (!template) return { ...base, label, status: 'skipped', reason: 'no command', silent: true };

	const lists = ctx.lists;
	const empty =
		(template.includes('{code}') && lists.code.length === 0) ||
		(template.includes('{files}') && lists.files.length === 0);
	if (empty) {
		return { ...base, label, status: 'skipped', reason: 'no matching touched files', silent: true };
	}

	const cwd = unit.path;
	const expanded = expand(template, lists);
	const tool = missingTool(expanded, cwd);
	if (tool) {
		return { ...base, label, status: 'skipped', reason: `${tool} not found`, missing: tool };
	}
	const command = withIncremental(expanded, buildInfoFile(repo, unit.name, check.name));
	const result = await runCommand(command, cwd);
	const verdict = judge(check, result, { cwd, baseline, paths: ctx.paths, label });
	return { ...base, label, mode, command, baseline: Boolean(baseline), ...verdict };
}

async function checkUnit(model, unit, { stop, touchedResult }) {
	const repo = model.repos[unit.repo];
	const fp = fingerprint(model, unit, touchedResult);
	const file = fpFile(repo, unit.name);
	if (stop && existsSync(file) && readFileSync(file, 'utf8') === fp) {
		return { name: unit.name, repo: unit.repo, cached: true, checks: [] };
	}

	const ctx = {
		touched: touchedResult,
		lists: unitFiles(model, touchedResult, unit.name),
		paths: unitPaths(model, touchedResult, unit.name),
	};
	const checks = [];
	for (const check of unit.checks.filter(c => !stop || c.stopHook)) {
		checks.push(await runCheck(model, unit, check, ctx));
	}

	if (checks.some(c => c.status === 'fail')) rmSync(file, { force: true });
	else {
		mkdirSync(join(repo.state, 'checked'), { recursive: true });
		writeFileSync(file, fp);
	}
	return { name: unit.name, repo: unit.repo, cached: false, checks };
}

function stopUnits(model, touchedResult) {
	const files = touchedResult.files.filter(f => hasExt(f, model.config.extensions.changed));
	return Object.values(model.units).filter(
		unit => unit.repo !== null && unit.stopHook && files.some(f => matchesAny(f, unit.triggers))
	);
}

export async function runChecks(
	model,
	{ units: names = [], stop = false, sinceBase = false, only = null } = {}
) {
	const touchedResult = touched(model, { sinceBase, only });
	const unknown = names.filter(name => !model.units[name]);
	if (unknown.length) throw new Error(`Unknown unit: ${unknown.join(', ')}`);

	let units;
	if (names.length) units = names.map(name => model.units[name]);
	else if (stop) units = stopUnits(model, touchedResult);
	else units = touchedResult.units.map(name => model.units[name]);
	const orphans = units.filter(unit => unit.repo === null).map(unit => unit.name);
	units = units.filter(unit => unit.repo !== null && (!stop || unit.stopHook));

	const results = await Promise.all(
		units.map(unit => checkUnit(model, unit, { stop, touchedResult }))
	);
	const checks = results.flatMap(r => r.checks);
	return {
		ok: !checks.some(c => c.status === 'fail'),
		units: results,
		orphans,
		warnings: checks.filter(c => c.warning).map(c => c.warning),
		missing: checks.filter(c => c.missing).map(c => `${c.label}: ${c.reason}`),
	};
}

const ICON = { pass: '✅', fail: '❌', skipped: '⏭' };

export function renderChecks(report) {
	const lines = [];
	for (const unit of report.units) {
		lines.push(`## ${unit.name}`);
		if (unit.cached) {
			lines.push('unchanged since the last passing check', '');
			continue;
		}
		if (unit.checks.length === 0) lines.push('no checks');
		for (const c of unit.checks) {
			const reason = c.status === 'skipped' ? ` (${c.reason})` : '';
			const where = c.untouched ? 'in untouched files' : 'pre-existing';
			const pre = c.preExisting ? ` (${c.preExisting} ${where})` : '';
			lines.push(`- ${ICON[c.status]} ${c.label.slice(unit.name.length + 1)}${reason}${pre}`);
		}
		for (const c of unit.checks.filter(c => c.status === 'fail')) {
			lines.push('', `### ${c.label}`, `\`${c.command}\``, '```');
			lines.push(c.caused?.length ? c.caused.join('\n') : (c.raw ?? ''), '```');
			if (c.untouched?.length) {
				lines.push(`untouched-file errors: ${c.preExisting} (see --json)`);
			} else if (c.preExisting) lines.push(`pre-existing: ${c.preExisting}`);
		}
		lines.push('');
	}
	if (report.orphans.length) lines.push(`Outside git, not checked: ${report.orphans.join(', ')}`);
	if (report.warnings.length) lines.push('Warnings:', ...report.warnings.map(w => `- ${w}`));
	if (report.units.length === 0) lines.push('No units to check.');
	return lines.join('\n').trimEnd();
}
