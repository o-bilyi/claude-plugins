import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';

const RUN_FILE = 'run.json';
const PLAN_FILE = 'plan.md';
const METRICS_FILE = 'metrics.jsonl';
const MODES = ['quick', 'full'];
const REPEAT_PASSES = 3;

// The project's state directory: the root repo's, else the first repo's (sorted by key).
export function projectState(model) {
	const keys = Object.keys(model.repos).sort();
	const key = model.repos['.'] ? '.' : keys[0];
	return key ? (model.repos[key].state ?? null) : null;
}

function parseValue(text) {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function parseJson(text, what) {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${what} needs JSON`);
	}
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function readRun(dir) {
	const file = dir && join(dir, RUN_FILE);
	if (!file || !existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return {};
	}
}

function writeRun(dir, run) {
	if (!dir) throw new Error('no git state directory for the run state');
	mkdirSync(dir, { recursive: true });
	run.updatedAt = new Date().toISOString();
	writeFileSync(join(dir, RUN_FILE), `${JSON.stringify(run, null, 2)}\n`);
	return run;
}

export function readPlan(dir) {
	const file = dir && join(dir, PLAN_FILE);
	return file && existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export function clearRun(dir) {
	if (!dir) return;
	rmSync(join(dir, RUN_FILE), { force: true });
	rmSync(join(dir, PLAN_FILE), { force: true });
}

// The mode that the `## Execution` part of a plan names (`Mode: quick`), else null.
export function planMode(text) {
	return text?.match(/^\W*mode\W*:\W*(quick|full)\b/im)?.[1].toLowerCase() ?? null;
}

// The current branch of each repo, to tell a run of this branch from a run of another branch.
export function repoBranches(model) {
	const branches = {};
	for (const [key, repo] of Object.entries(model.repos)) {
		branches[key] = git(repo.path, ['branch', '--show-current'])?.trim() || '(detached)';
	}
	return branches;
}

// Starts a new run after the plan is approved. It keeps a copy of the plan for `scope`.
export function startRun(dir, model, { mode, plan, planText }) {
	const chosen = mode ?? planMode(planText) ?? 'full';
	if (!MODES.includes(chosen)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
	clearRun(dir);
	mkdirSync(dir, { recursive: true });
	if (planText) writeFileSync(join(dir, PLAN_FILE), planText);
	return writeRun(dir, {
		mode: chosen,
		phase: 'preflight',
		round: 0,
		pass: 0,
		plan: plan ?? null,
		branches: repoBranches(model),
		findings: [],
		startedAt: new Date().toISOString(),
	});
}

// `key=value` pairs. A value is JSON when it parses, else a string.
export function setRun(dir, pairs) {
	if (pairs.length === 0) throw new Error('state set needs key=value');
	const run = readRun(dir);
	for (const pair of pairs) {
		const at = pair.indexOf('=');
		if (at < 1) throw new Error(`state set needs key=value, not ${pair}`);
		run[pair.slice(0, at)] = parseValue(pair.slice(at + 1));
	}
	return writeRun(dir, run);
}

// Phase changes that the scripts make. They do nothing when no run started.
export function advancePhase(dir, phase) {
	const run = readRun(dir);
	if (!run.phase || run.phase === 'done') return null;
	run.phase = phase;
	return writeRun(dir, run);
}

export function switchMode(dir, mode) {
	const run = readRun(dir);
	if (!run.phase) return null;
	run.mode = mode;
	return writeRun(dir, run);
}

// One round is one message of failures or findings to the implementer.
export function nextRound(dir, maxRounds) {
	const run = readRun(dir);
	const round = run.round ?? 0;
	if (round >= maxRounds) return { ok: false, round, maxRounds };
	run.round = round + 1;
	run.phase = 'fix';
	writeRun(dir, run);
	return { ok: true, round: run.round, maxRounds };
}

const SEVERITIES = ['blocking', 'should-fix'];

function validFinding(f) {
	return (
		isObject(f) &&
		typeof f.reviewer === 'string' &&
		typeof f.id === 'string' &&
		SEVERITIES.includes(f.severity) &&
		typeof f.path === 'string'
	);
}

// The same finding: the same reviewer, file and category. A line number does not count.
const findingKey = f => [f.reviewer, f.path.replace(/:\d.*$/, ''), f.category ?? ''].join(' | ');

// Records the findings of one review pass, and decides the next step:
// report (no blocking finding), fix (another round), or ask (the same blocking finding in the last
// three passes, or no round left).
export function recordReview(dir, text, maxRounds) {
	const findings = parseJson(text, 'state review');
	if (!Array.isArray(findings) || !findings.every(validFinding)) {
		throw new Error(
			`state review needs a JSON array of {"reviewer","id","severity","path","category","summary"}; severity is ${SEVERITIES.join(' or ')}`
		);
	}
	const run = readRun(dir);
	const pass = (run.pass ?? 0) + 1;
	const round = run.round ?? 0;
	const all = [...(run.findings ?? []), ...findings.map(f => ({ ...f, pass, round }))];
	const blockingKeys = p =>
		new Set(all.filter(f => f.pass === p && f.severity === 'blocking').map(findingKey));
	const blocking = findings.filter(f => f.severity === 'blocking');
	let repeated = [];
	if (pass >= REPEAT_PASSES) {
		const earlier = Array.from({ length: REPEAT_PASSES - 1 }, (_, i) => blockingKeys(pass - 1 - i));
		repeated = [...blockingKeys(pass)].filter(key => earlier.every(keys => keys.has(key)));
	}
	let next;
	let reason;
	if (blocking.length === 0) next = 'report';
	else if (repeated.length) {
		next = 'ask';
		reason = `the same blocking finding in the last ${REPEAT_PASSES} review passes`;
	} else if (round >= maxRounds) {
		next = 'ask';
		reason = `no round left (${round} of ${maxRounds})`;
	} else next = 'fix';
	Object.assign(run, {
		pass,
		findings: all,
		phase: next === 'report' ? 'report' : 'review',
		next,
	});
	writeRun(dir, run);
	return {
		pass,
		blocking: blocking.length,
		shouldFix: findings.length - blocking.length,
		repeated,
		next,
		reason,
	};
}

export function renderReview(result) {
	const lines = [
		`pass ${result.pass}: ${result.blocking} blocking, ${result.shouldFix} should fix`,
	];
	if (result.repeated.length) lines.push('repeated:', ...result.repeated.map(k => `  ${k}`));
	lines.push(`NEXT: ${result.next}${result.reason ? ` (${result.reason})` : ''}`);
	return lines.join('\n');
}

const METRIC_INPUT = ['result', 'caused', 'unsure', 'flaky', 'estimate'];

// Records a run. The script adds what it knows: the mode, the rounds, the passes, the size and the
// findings (with their summaries, for `learn`). The input gives only the tester counts, the result and the size estimate of the plan.
export function recordMetrics(dir, text, size) {
	const input = text.trim() ? parseJson(text, 'metrics record') : {};
	if (!isObject(input)) throw new Error('metrics record needs a JSON object');
	const unknown = Object.keys(input).filter(k => !METRIC_INPUT.includes(k));
	if (unknown.length) {
		throw new Error(
			`metrics record takes only ${METRIC_INPUT.join(', ')}; not ${unknown.join(', ')}`
		);
	}
	if (!dir) throw new Error('no git state directory for metrics');
	const run = readRun(dir);
	if (run.phase === 'done') throw new Error('metrics record: this run is already recorded');
	const entry = {
		at: new Date().toISOString(),
		mode: run.mode ?? null,
		rounds: run.round ?? 0,
		passes: run.pass ?? 0,
		...input,
		added: size.added,
		deleted: size.deleted,
		files: size.files.length,
		findings: run.findings ?? [],
	};
	mkdirSync(dir, { recursive: true });
	appendFileSync(join(dir, METRICS_FILE), `${JSON.stringify(entry)}\n`);
	if (run.phase) {
		run.phase = 'done';
		writeRun(dir, run);
	}
	return entry;
}

export function readMetrics(dir) {
	const file = dir && join(dir, METRICS_FILE);
	if (!file || !existsSync(file)) return [];
	return readFileSync(file, 'utf8')
		.split('\n')
		.filter(Boolean)
		.flatMap(line => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});
}

export function summarizeMetrics(entries) {
	const num = v => (typeof v === 'number' ? v : 0);
	const blocking = {};
	const categories = {};
	for (const e of entries) {
		for (const f of Array.isArray(e.findings) ? e.findings : []) {
			const reviewer = f.reviewer ?? 'unknown';
			if (f.severity === 'blocking') blocking[reviewer] = (blocking[reviewer] ?? 0) + 1;
			if (f.category) categories[f.category] = (categories[f.category] ?? 0) + 1;
		}
	}
	const runs = entries.length;
	return {
		runs,
		meanRounds: runs ? entries.reduce((n, e) => n + num(e.rounds), 0) / runs : null,
		caused: entries.reduce((n, e) => n + num(e.caused), 0),
		blockingByReviewer: blocking,
		categories,
	};
}

export function renderMetrics(summary) {
	if (summary.runs === 0) return 'No workflow runs recorded.';
	const lines = [
		`runs: ${summary.runs}`,
		`mean rounds: ${summary.meanRounds.toFixed(1)}`,
		`caused failures: ${summary.caused}`,
	];
	const pairs = obj =>
		Object.entries(obj)
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => `  ${k}: ${v}`);
	if (Object.keys(summary.blockingByReviewer).length) {
		lines.push('blocking findings by reviewer:', ...pairs(summary.blockingByReviewer));
	}
	if (Object.keys(summary.categories).length) {
		lines.push('findings by category:', ...pairs(summary.categories));
	}
	return lines.join('\n');
}
