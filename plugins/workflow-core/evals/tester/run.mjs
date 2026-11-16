#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	claudeRecord,
	cliFail,
	diffSnapshots,
	fmtNum,
	git,
	globToRegExp,
	mean,
	noJsonError,
	parseClaudeJson,
	parseCli as parseEvalCli,
	pct,
	PLUGIN,
	pool,
	readIn,
	runClaude,
	snapshot,
	tail,
	WC,
} from '../lib/harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');
const AGENT = 'workflow-core:tester';
const TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const EXTRA_ARGS = ['--settings', '{"disableAllHooks":true}'];
const WC_TIMEOUT_MS = 2 * 60 * 1000;
const TAG_ACCURACY_TARGET = 0.9;
const DEFAULT_PROMPT =
	'Verify the current changes in the project at `{{REPO}}`.\n\nwc.mjs: `{{WC}}`\n';

const USAGE = `usage: node run.mjs [--models haiku,sonnet] [--runs 5] [--case <glob>] [--budget-usd 0.5]
                   [--dry-run reference] [--out <dir>] [--jobs 1] [--keep]
  --dry-run reference  use each case's reference-output.md as the result instead of calling claude,
                       and compare \`wc.mjs check --json\` with case.json "check"
  --jobs               runs in parallel (default 1)
  --keep               keep the temp repos (their paths go into results.json)`;

function parseCli() {
	return parseEvalCli({ usage: USAGE, runs: '5', budget: '0.5', dryRuns: ['reference'] });
}

function fail(message) {
	cliFail(USAGE, message);
}

function loadCases(glob) {
	const names = readdirSync(CASES, { withFileTypes: true })
		.filter(d => d.isDirectory() && !d.name.startsWith('.'))
		.map(d => d.name)
		.filter(name => !glob || globToRegExp(glob).test(name))
		.sort();
	if (names.length === 0) fail(`no case matches ${glob}`);
	return names.map(name => {
		const dir = join(CASES, name);
		const def = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
		if (!def.expected?.result) throw new Error(`${name}: case.json has no expected.result`);
		const stubKeys = new Set(
			Object.entries(def.stubs ?? {}).flatMap(([unitDir, stubs]) =>
				stubs.map(stub => `${unitDir}/${stub}`)
			)
		);
		for (const key of [...Object.keys(def.before ?? {}), ...Object.keys(def.after ?? {})]) {
			if (!stubKeys.has(key)) throw new Error(`${name}: output for ${key}, which is not a stub`);
		}
		return { ...def, name, dir };
	});
}

const RESULT_RE = /^RESULT: (PASS|FAIL \((\d+) caused, (\d+) unsure, (\d+) pre-existing\))$/;
const BLOCK_RE = /^- \[(caused|unsure|pre-existing)\] /;

export function parseReport(text) {
	const lines = (text ?? '').split('\n').map(l => l.trimEnd());
	const last = lines.findLast(l => l.trim() !== '') ?? '';
	const m = last.match(RESULT_RE);
	const result = !m
		? null
		: m[1] === 'PASS'
			? { pass: true }
			: { pass: false, caused: Number(m[2]), unsure: Number(m[3]), preExisting: Number(m[4]) };

	const blocks = [];
	let current = null;
	let skipped = null;
	let inSkipped = false;
	for (const line of lines) {
		const ends = line.startsWith('## ') || line.startsWith('RESULT:');
		const tag = line.match(BLOCK_RE)?.[1];
		if (tag || ends) current = null;
		if (tag) {
			current = { tag, lines: [line] };
			blocks.push(current);
		} else if (current) current.lines.push(line);

		if (ends) inSkipped = false;
		if (/^## Skipped\s*$/.test(line)) {
			inSkipped = true;
			skipped = [];
		} else if (inSkipped) skipped.push(line);
	}
	return {
		lastLine: last,
		format: Boolean(m),
		result,
		blocks: blocks.map(b => ({
			tag: b.tag,
			firstLine: b.lines[0],
			text: b.lines.join('\n').trimEnd(),
		})),
		skipped: skipped === null ? null : skipped.join('\n').trim(),
	};
}

const asList = x => (Array.isArray(x) ? x : [x]);
const resultLabel = r =>
	r === null
		? 'no RESULT line'
		: r.pass
			? 'PASS'
			: `FAIL (${r.caused} caused, ${r.unsure} unsure, ${r.preExisting} pre-existing)`;

export function gradeReport(expected, text, changes = []) {
	const report = parseReport(text);
	const got = report.result;
	const wantPass = expected.result === 'PASS';
	const want = wantPass ? { pass: true } : { pass: false, ...expected.result };

	const verdictOk = got !== null && got.pass === wantPass;
	const countsOk =
		got !== null &&
		(wantPass
			? got.pass
			: !got.pass &&
				got.caused === want.caused &&
				got.unsure === want.unsure &&
				got.preExisting === want.preExisting);

	const tags = (expected.failures ?? []).map(f => {
		const allowed = asList(f.tag);
		const matched = report.blocks.filter(b => new RegExp(f.match, 'i').test(b.text));
		const good = matched.find(
			b => allowed.includes(b.tag) && (!f.mentions || new RegExp(f.mentions, 'i').test(b.text))
		);
		const want = `${allowed.join('|')}${f.mentions ? ` mentioning /${f.mentions}/` : ''}`;
		const detail = good
			? `[${good.tag}] ${good.firstLine}`
			: matched.length === 0
				? `no failure block matches /${f.match}/ (want ${want})`
				: `want ${want}, got: ${matched.map(b => b.firstLine).join(' | ')}`;
		return { match: f.match, ok: Boolean(good), detail };
	});

	const extra = report.blocks.filter(
		b =>
			(b.tag === 'caused' || b.tag === 'unsure') &&
			!(expected.failures ?? []).some(f => new RegExp(f.match, 'i').test(b.text))
	);

	const skippedChecks = (expected.skipped ?? []).map(re => ({
		pattern: re,
		ok: report.skipped !== null && new RegExp(re, 'i').test(report.skipped),
	}));
	const skippedOk = skippedChecks.every(s => s.ok);
	const skippedDetail = skippedOk
		? 'ok'
		: report.skipped === null
			? 'no ## Skipped section'
			: `## Skipped does not match ${skippedChecks
					.filter(s => !s.ok)
					.map(s => `/${s.pattern}/`)
					.join(', ')}`;

	const metrics = {
		result: resultLabel(got),
		expectedResult: resultLabel(want),
		format: report.format,
		lastLine: report.lastLine,
		verdictOk,
		countsOk,
		falsePass: !wantPass && got !== null && got.pass,
		falseFail: wantPass && got !== null && !got.pass,
		tags,
		extraBlocking: { count: extra.length, lines: extra.map(b => b.firstLine) },
		skipped: { ok: skippedOk, detail: skippedDetail },
		unchanged: { ok: changes.length === 0, changes: changes.map(c => `${c.kind} ${c.path}`) },
	};
	metrics.passed =
		metrics.format &&
		metrics.countsOk &&
		tags.every(t => t.ok) &&
		extra.length === 0 &&
		skippedOk &&
		metrics.unchanged.ok;
	return metrics;
}

export function failedDetails(m) {
	const out = [];
	if (!m.format) out.push(`format: last line ${JSON.stringify(m.lastLine)}`);
	if (!m.countsOk) out.push(`result: expected ${m.expectedResult}, got ${m.result}`);
	if (m.falsePass) out.push('false PASS');
	for (const t of m.tags.filter(t => !t.ok)) out.push(`tag /${t.match}/: ${t.detail}`);
	if (m.extraBlocking.count) out.push(`extra blocking: ${m.extraBlocking.lines.join(' | ')}`);
	if (!m.skipped.ok) out.push(`skipped: ${m.skipped.detail}`);
	if (!m.unchanged.ok) out.push(`edits: ${m.unchanged.changes.join(', ')}`);
	return out;
}

function stateDir(dir) {
	return resolve(dir, git(dir, ['rev-parse', '--git-path', 'workflow-eval']).trim());
}

function createStubs(c, dir) {
	for (const [unitDir, stubs] of Object.entries(c.stubs ?? {})) {
		const bin = join(dir, unitDir, 'node_modules', '.bin');
		mkdirSync(bin, { recursive: true });
		for (const stub of stubs) {
			const key = `${unitDir}/${stub}`;
			const script = `#!/bin/sh
d="$(git rev-parse --git-path workflow-eval)"
k="$d/${key}"
[ -f "$k.out" ] && cat "$k.out"
[ -f "$k.code" ] && exit "$(cat "$k.code")"
exit 0
`;
			writeFileSync(join(bin, stub), script);
			chmodSync(join(bin, stub), 0o755);
		}
	}
}

function writeOutputs(c, dir, entries) {
	const state = stateDir(dir);
	for (const [key, entry] of Object.entries(entries ?? {})) {
		const base = join(state, key);
		mkdirSync(dirname(base), { recursive: true });
		const text =
			entry.out !== undefined ? readFileSync(join(c.dir, entry.out), 'utf8') : (entry.text ?? '');
		writeFileSync(`${base}.out`, text);
		if (entry.code !== undefined) writeFileSync(`${base}.code`, String(entry.code));
		else rmSync(`${base}.code`, { force: true });
	}
}

function runWc(dir, args) {
	return spawnSync(process.execPath, [WC, ...args], {
		cwd: dir,
		env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
		encoding: 'utf8',
		timeout: WC_TIMEOUT_MS,
	});
}

async function prepare(c, dir) {
	cpSync(join(c.dir, 'repo'), dir, { recursive: true });
	git(dir, ['init', '-q', '-b', 'main']);
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'initial']);
	createStubs(c, dir);
	const setupFile = join(c.dir, 'setup.mjs');
	const setup = existsSync(setupFile) ? await import(pathToFileURL(setupFile).href) : {};
	if (setup.before) await setup.before(dir);
	writeOutputs(c, dir, c.before);
	if (c.preflight) {
		const r = runWc(dir, ['preflight']);
		if (r.status !== 0) {
			const why = r.error ? r.error.message : `exit ${r.status ?? r.signal}`;
			throw new Error(`wc.mjs preflight: ${why}\n${tail(`${r.stdout}${r.stderr}`)}`);
		}
	}
	if (existsSync(join(c.dir, 'change'))) cpSync(join(c.dir, 'change'), dir, { recursive: true });
	if (setup.after) await setup.after(dir);
	writeOutputs(c, dir, c.after);
}

function compareCheck(c, dir) {
	const expectations = Object.entries(c.check ?? {});
	const r = runWc(dir, ['check', '--json']);
	if (![0, 1, 3].includes(r.status)) {
		const why = r.error ? r.error.message : `exit ${r.status ?? r.signal}`;
		return [`wc.mjs check: ${why}: ${tail(r.stderr, 5)}`];
	}
	if (r.status === 3) return expectations.map(([key]) => `${key}: no workflow config (exit 3)`);
	const report = JSON.parse(r.stdout);
	const mismatches = [];
	for (const [key, want] of expectations) {
		const slash = key.indexOf('/');
		const unitName = key.slice(0, slash);
		const checkName = key.slice(slash + 1);
		const check = report.units
			.find(u => u.name === unitName)
			?.checks.find(ch => ch.name === checkName);
		if (!check) {
			mismatches.push(`${key}: not in check --json`);
			continue;
		}
		const got = {
			status: check.status,
			caused: check.caused?.length ?? 0,
			preExisting: check.preExisting ?? 0,
			untouched: check.untouched?.length ?? 0,
		};
		for (const [field, value] of Object.entries(want)) {
			if (got[field] !== value) {
				mismatches.push(
					`${key}: ${field} ${JSON.stringify(got[field])}, want ${JSON.stringify(value)}`
				);
			}
		}
	}
	return mismatches;
}

async function runOne({ c, model, run, opts }) {
	const record = { case: c.name, model, run };
	const dir = realpathSync(mkdtempSync(join(tmpdir(), `wc-eval-tester-${c.name}-`)));
	if (opts.keep) record.dir = dir;
	try {
		await prepare(c, dir);
		const before = snapshot(dir);
		let resultText = '';
		if (opts.dryRun === 'reference') {
			const reference = readIn(c.dir, 'reference-output.md');
			if (reference === null) throw new Error('no reference-output.md');
			resultText = reference;
			record.checkMismatches = compareCheck(c, dir);
		} else {
			const prompt = (readIn(c.dir, 'prompt.md') ?? DEFAULT_PROMPT)
				.replaceAll('{{REPO}}', dir)
				.replaceAll('{{WC}}', WC);
			const raw = await runClaude({
				prompt,
				agent: AGENT,
				model,
				budget: opts.budget,
				dir,
				tools: TOOLS,
				extraArgs: EXTRA_ARGS,
			});
			const json = parseClaudeJson(raw.stdout);
			record.claude = claudeRecord(json, raw);
			if (!json) record.error = noJsonError(raw);
			resultText = typeof json?.result === 'string' ? json.result : '';
			record.headMoved = git(dir, ['rev-list', '--count', 'HEAD']).trim() !== '1';
		}
		record.resultText = resultText;
		const after = snapshot(dir);
		record.metrics = gradeReport(c.expected, resultText, diffSnapshots(before, after));
		record.passed = record.metrics.passed;
	} catch (error) {
		record.error = `harness: ${error.message}`;
	} finally {
		if (!opts.keep) rmSync(dir, { recursive: true, force: true });
	}
	return record;
}

function dryRunReport(records) {
	let ok = true;
	const lines = [];
	for (const r of records) {
		if (r.error) {
			ok = false;
			lines.push(`FAIL ${r.case}: ${r.error}`);
			continue;
		}
		const problems = [...r.checkMismatches, ...failedDetails(r.metrics)];
		const caseOk = r.passed && problems.length === 0;
		ok &&= caseOk;
		lines.push(`${caseOk ? 'ok  ' : 'FAIL'} ${r.case} (${r.metrics.result})`);
		for (const p of problems) lines.push(`  ! ${p}`);
	}
	lines.push('', ok ? 'dry-run reference: all cases as expected' : 'dry-run reference: MISMATCH');
	return { ok, text: lines.join('\n') };
}

function stats(rs) {
	const graded = rs.filter(r => !r.error);
	const ms = graded.map(r => r.metrics);
	const rate = f => (ms.length ? ms.filter(f).length / ms.length : null);
	const tags = ms.flatMap(m => m.tags);
	const tagsOk = tags.filter(t => t.ok).length;
	return {
		runs: rs.length,
		graded: graded.length,
		allPass: graded.filter(r => r.passed).length,
		format: rate(m => m.format),
		verdictOk: rate(m => m.verdictOk),
		countsOk: rate(m => m.countsOk),
		tagsOk,
		tagsTotal: tags.length,
		tagRate: tags.length ? tagsOk / tags.length : null,
		falsePass: ms.filter(m => m.falsePass).length,
		falseFail: ms.filter(m => m.falseFail).length,
		extraBlocking: ms.reduce((n, m) => n + m.extraBlocking.count, 0),
		edits: ms.filter(m => !m.unchanged.ok).length,
		errors: rs.length - graded.length,
		cost: mean(rs.map(r => r.claude?.costUsd)),
		turns: mean(rs.map(r => r.claude?.numTurns)),
		duration: mean(rs.map(r => (r.claude?.durationMs ?? r.claude?.wallMs ?? null) / 1000 || null)),
	};
}

const tagCell = s => (s.tagsTotal ? `${pct(s.tagRate)} (${s.tagsOk}/${s.tagsTotal})` : '-');

export function verdict(records, model) {
	const s = stats(records.filter(r => r.model === model));
	const keep =
		s.falsePass === 0 &&
		s.tagRate !== null &&
		s.tagRate >= TAG_ACCURACY_TARGET &&
		s.format === 1 &&
		s.edits === 0 &&
		s.errors === 0;
	const incomplete =
		!keep && s.falsePass === 0 && (s.errors > 0 || s.graded === 0 || s.tagRate === null);
	return { model, ...s, verdict: keep ? 'keep' : incomplete ? 'incomplete' : 'not ok' };
}

function summarize(records, opts) {
	const lines = ['# Tester eval', ''];
	lines.push(
		`Models: ${opts.models.join(', ')}. Runs: ${opts.runs}. Budget cap per run: $${opts.budget}.`,
		''
	);
	lines.push(
		'| case | model | runs | all-pass runs | format | verdict ok | counts ok | tag accuracy | false PASS | false FAIL | extra blocking | edits | errors | mean cost $ | mean turns | mean duration s |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
	);
	const cases = [...new Set(records.map(r => r.case))];
	for (const name of cases) {
		for (const model of opts.models) {
			const rs = records.filter(r => r.case === name && r.model === model);
			if (rs.length === 0) continue;
			const s = stats(rs);
			const cells = [
				name,
				model,
				s.runs,
				s.graded ? pct(s.allPass / s.graded) : 'n/a',
				pct(s.format),
				pct(s.verdictOk),
				pct(s.countsOk),
				tagCell(s),
				s.falsePass,
				s.falseFail,
				s.extraBlocking,
				s.edits,
				s.errors,
				fmtNum(s.cost, 3),
				fmtNum(s.turns, 1),
				fmtNum(s.duration, 0),
			];
			lines.push(`| ${cells.join(' | ')} |`);
		}
	}
	lines.push('', '## Verdict', '');
	lines.push(
		`Rule: keep a model iff 0 false PASS, tag accuracy >= ${TAG_ACCURACY_TARGET * 100}%, RESULT format 100%, 0 runs with edits and 0 errored runs.`,
		''
	);
	const verdicts = opts.models.map(m => verdict(records, m));
	for (const v of verdicts) {
		lines.push(
			`- ${v.model}: ${v.verdict.toUpperCase()} (${v.falsePass} false PASS, tag accuracy ${tagCell(v)}, format ${pct(v.format)}, ${v.falseFail} false FAIL, ${v.extraBlocking} extra blocking, ${v.edits} runs with edits, ${v.errors} errored runs, ${v.allPass}/${v.runs} all-pass runs)`
		);
	}
	const haiku = verdicts.find(v => v.model === 'haiku');
	const sonnet = verdicts.find(v => v.model === 'sonnet');
	if (haiku) {
		lines.push(
			'',
			haiku.verdict === 'keep'
				? 'Verdict: haiku is fine for the tester; keep `model: haiku`.'
				: haiku.verdict === 'incomplete'
					? 'Verdict: incomplete; run every case and re-run errored haiku runs before deciding.'
					: sonnet?.verdict === 'keep'
						? 'Verdict: haiku is not ok for the tester and sonnet is; move it to sonnet.'
						: sonnet
							? 'Verdict: neither model meets the targets; fix the tester prompt or the cases before choosing a model.'
							: 'Verdict: haiku is not ok for the tester; run sonnet to compare before moving it.'
		);
	}
	const failures = records.filter(r => r.error || !r.passed);
	if (failures.length > 0) {
		lines.push('', '## Failures', '');
		for (const r of failures) {
			const head = `- ${r.case} / ${r.model} / run ${r.run}`;
			if (r.error) {
				lines.push(`${head}: ${r.error.split('\n')[0]}`);
				continue;
			}
			lines.push(`${head}:`);
			for (const d of failedDetails(r.metrics)) lines.push(`  - ${d}`);
		}
	}
	return lines.join('\n');
}

async function main() {
	const opts = parseCli();
	const cases = loadCases(opts.caseGlob);
	const tasks = [];
	for (const c of cases) {
		for (const model of opts.models) {
			for (let run = 1; run <= opts.runs; run++) tasks.push(() => runOne({ c, model, run, opts }));
		}
	}

	if (opts.dryRun) {
		const records = await pool(tasks, opts.jobs, () => {});
		const report = dryRunReport(records);
		console.log(report.text);
		process.exit(report.ok ? 0 : 1);
	}

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const out = resolve(opts.out ?? join(PLUGIN, 'evals', 'results', `tester-${stamp}`));
	mkdirSync(out, { recursive: true });
	const maxCost = tasks.length * opts.budget;
	console.log(
		`${cases.length} cases x ${opts.models.length} models x ${opts.runs} runs = ${tasks.length} runs, at most $${maxCost.toFixed(2)}. Output: ${out}`
	);

	const done = [];
	const meta = { startedAt: new Date().toISOString(), plugin: PLUGIN, ...opts };
	const save = () =>
		writeFileSync(join(out, 'results.json'), `${JSON.stringify({ meta, runs: done }, null, 2)}\n`);
	await pool(tasks, opts.jobs, r => {
		done.push(r);
		save();
		const status = r.error
			? `ERROR ${r.error.split('\n')[0]}`
			: r.passed
				? 'pass'
				: `fail${r.metrics.falsePass ? ' (false PASS)' : ''}`;
		const cost = r.claude?.costUsd != null ? ` $${r.claude.costUsd.toFixed(3)}` : '';
		console.log(
			`[${done.length}/${tasks.length}] ${r.case} ${r.model} #${r.run}: ${status}${cost}`
		);
	});

	const order = (a, b) =>
		a.case.localeCompare(b.case) || a.model.localeCompare(b.model) || a.run - b.run;
	done.sort(order);
	meta.finishedAt = new Date().toISOString();
	save();
	const summary = summarize(done, opts);
	writeFileSync(join(out, 'summary.md'), `${summary}\n`);
	console.log(`\n${summary}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
