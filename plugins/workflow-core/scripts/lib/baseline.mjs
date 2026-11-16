import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { parseCounted } from './parsers.mjs';
import { PLACEHOLDER, runCommand, safeName, withIncremental } from './run.mjs';
import { missingTool } from './shell.mjs';
import { currentEntries, DIRTY_FILE } from './touched.mjs';

const META_FILE = 'baseline/meta.json';

export const head = repo => git(repo.path, ['rev-parse', 'HEAD'])?.trim() ?? null;

export const buildInfoFile = (repo, unit, check) =>
	join(repo.state, 'tsbuildinfo', safeName(unit), safeName(check));

const unitDir = (repo, unit) => join(repo.state, 'baseline', safeName(unit));
const errorsFile = (repo, unit, check) => join(unitDir(repo, unit), `${safeName(check)}.errors`);

export function parseOutput(parser, result, cwd) {
	const parsed = parseCounted(parser, result.stdout, { unitDir: cwd });
	if (parsed.ok && result.code !== 0 && parsed.errors.length === 0) {
		return { ok: false, reason: `exit code ${result.code} with no parsed errors` };
	}
	return parsed;
}

export function baselineSignature(repo, unit) {
	const read = file => (existsSync(file) ? readFileSync(file, 'utf8') : '-');
	const dir = unitDir(repo, unit);
	const files = existsSync(dir) ? readdirSync(dir).sort() : [];
	return [
		read(join(repo.state, DIRTY_FILE)),
		...files.map(name => `${name}\n${read(join(dir, name))}`),
	].join('\0');
}

export function readBaseline(repo, unit, check) {
	const file = errorsFile(repo, unit, check);
	if (!existsSync(file)) return null;
	const counts = new Map();
	for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
		const m = line.match(/^(\d+)\t(.*)$/);
		const [count, error] = m ? [Number(m[1]), m[2]] : [1, line];
		counts.set(error, (counts.get(error) ?? 0) + count);
	}
	return counts;
}

export function readMeta(repo) {
	const file = join(repo.state, META_FILE);
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}

function writeMeta(repo, meta) {
	mkdirSync(join(repo.state, 'baseline'), { recursive: true });
	writeFileSync(join(repo.state, META_FILE), `${JSON.stringify(meta, null, '\t')}\n`);
}

async function saveCheck(model, unit, repo, check) {
	if (PLACEHOLDER.test(check.run)) return { skipped: 'run uses {files} or {code}' };
	const cwd = unit.path;
	const tool = missingTool(check.run, cwd);
	if (tool) return { skipped: `${tool} not found` };
	const command = withIncremental(check.run, buildInfoFile(repo, unit.name, check.name));
	const parsed = parseOutput(check.parser, await runCommand(command, cwd), cwd);
	if (!parsed.ok) return { unparseable: parsed.reason };
	mkdirSync(unitDir(repo, unit.name), { recursive: true });
	const lines = parsed.errors.map(e => `${parsed.counts.get(e)}\t${e}\n`);
	writeFileSync(errorsFile(repo, unit.name, check.name), lines.join(''));
	return { count: [...parsed.counts.values()].reduce((a, b) => a + b, 0) };
}

async function saveUnit(model, unit) {
	const repo = model.repos[unit.repo];
	rmSync(unitDir(repo, unit.name), { recursive: true, force: true });
	const checks = {};
	for (const check of unit.checks.filter(c => c.parser)) {
		checks[check.name] = await saveCheck(model, unit, repo, check);
	}
	return checks;
}

export function selectUnits(model, names) {
	const unknown = names.filter(name => !model.units[name]);
	if (unknown.length) throw new Error(`Unknown unit: ${unknown.join(', ')}`);
	const selected = names.length ? names : Object.keys(model.units);
	return selected.map(name => model.units[name]).filter(unit => unit.repo !== null);
}

export async function saveBaseline(model, names = [], { force = false } = {}) {
	if (model.config.process.preflight.baseline === 'off' && !force) {
		return {
			saved: false,
			message: 'Baseline is off (process.preflight.baseline); nothing saved.',
		};
	}
	const units = selectUnits(model, names);
	const results = await Promise.all(units.map(unit => saveUnit(model, unit)));
	const repos = {};
	units.forEach((unit, i) => {
		repos[unit.repo] ??= {};
		repos[unit.repo][unit.name] = results[i];
	});

	const savedAt = new Date().toISOString();
	for (const [key, units] of Object.entries(repos)) {
		const repo = model.repos[key];
		const entries = currentEntries(repo);
		mkdirSync(join(repo.state, 'baseline'), { recursive: true });
		writeFileSync(join(repo.state, DIRTY_FILE), entries.map(e => `${e}\n`).join(''));
		const previous = readMeta(repo)?.units ?? {};
		writeMeta(repo, { savedAt, head: head(repo), units: { ...previous, ...units } });
		repos[key] = { units, dirty: entries.length };
	}
	return { saved: true, repos };
}

export function clearBaseline(model, names = []) {
	const units = selectUnits(model, names);
	const cleared = [];
	for (const key of new Set(units.map(unit => unit.repo))) {
		const repo = model.repos[key];
		if (names.length === 0) {
			rmSync(join(repo.state, 'baseline'), { recursive: true, force: true });
			cleared.push(key);
			continue;
		}
		const meta = readMeta(repo);
		for (const unit of units.filter(u => u.repo === key)) {
			rmSync(unitDir(repo, unit.name), { recursive: true, force: true });
			if (meta) delete meta.units[unit.name];
			cleared.push(`${key}/${unit.name}`);
		}
		if (meta) writeMeta(repo, meta);
	}
	return cleared;
}

export function baselineStatus(model) {
	const repos = {};
	for (const [key, repo] of Object.entries(model.repos)) {
		const meta = readMeta(repo);
		const dirtyFile = join(repo.state, DIRTY_FILE);
		const dirty = existsSync(dirtyFile)
			? readFileSync(dirtyFile, 'utf8').split('\n').filter(Boolean).length
			: null;
		const current = head(repo);
		repos[key] = meta
			? {
					present: true,
					savedAt: meta.savedAt,
					head: meta.head,
					stale: meta.head !== current,
					dirty,
					units: meta.units,
				}
			: { present: false, dirty };
	}
	return repos;
}

export function baselineErrorCount(repo) {
	const meta = readMeta(repo);
	if (!meta) return null;
	return Object.values(meta.units)
		.flatMap(checks => Object.values(checks))
		.reduce((sum, c) => sum + (c.count ?? 0), 0);
}
