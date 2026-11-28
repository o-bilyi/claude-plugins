import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const PLUGIN = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const WC = join(PLUGIN, 'scripts', 'wc.mjs');
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;

export function cliFail(usage, message) {
	console.error(`run.mjs: ${message}\n${usage}`);
	process.exit(2);
}

export function parseCli({
	usage,
	models: defaultModels = 'haiku,sonnet',
	runs: defaultRuns,
	budget: defaultBudget,
	dryRuns,
}) {
	const { values } = parseArgs({
		options: {
			models: { type: 'string', default: defaultModels },
			runs: { type: 'string', default: defaultRuns },
			case: { type: 'string' },
			'budget-usd': { type: 'string', default: defaultBudget },
			'dry-run': { type: 'string' },
			out: { type: 'string' },
			jobs: { type: 'string', default: '1' },
			keep: { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h', default: false },
		},
	});
	if (values.help) {
		console.log(usage);
		process.exit(0);
	}
	const fail = message => cliFail(usage, message);
	const dryRun = values['dry-run'];
	if (dryRun && !dryRuns.includes(dryRun)) fail(`unknown --dry-run ${dryRun}`);
	const runs = Number(values.runs);
	const budget = Number(values['budget-usd']);
	const jobs = Number(values.jobs);
	if (!Number.isInteger(runs) || runs < 1) fail('--runs must be a positive integer');
	if (!(budget > 0)) fail('--budget-usd must be a positive number');
	if (!Number.isInteger(jobs) || jobs < 1) fail('--jobs must be a positive integer');
	return {
		models: dryRun
			? [dryRun]
			: values.models
					.split(',')
					.map(m => m.trim())
					.filter(Boolean),
		runs: dryRun ? 1 : runs,
		caseGlob: values.case,
		budget,
		dryRun,
		out: values.out,
		jobs,
		keep: values.keep,
	};
}

export function globToRegExp(glob) {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (glob.startsWith('**/', i)) {
			re += '(?:.*/)?';
			i += 2;
		} else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
			re += '(?:/.*)?';
			i += 2;
		} else if (glob.startsWith('**', i)) {
			re += '.*';
			i += 1;
		} else if (c === '*') re += '[^/]*';
		else if (c === '?') re += '[^/]';
		else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}
	return new RegExp(`^${re}$`);
}

export const matchesAny = (path, globs) => globs.some(g => globToRegExp(g).test(path));

export function git(dir, args) {
	return execFileSync(
		'git',
		[
			'-c',
			'user.name=eval',
			'-c',
			'user.email=eval@example.com',
			'-c',
			'commit.gpgsign=false',
			...args,
		],
		{ cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
	);
}

export function snapshot(root) {
	const files = new Map();
	const dirs = new Set();
	const walk = rel => {
		for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
			const path = rel ? `${rel}/${entry.name}` : entry.name;
			if (path === '.git') continue;
			if (entry.isDirectory()) {
				dirs.add(path);
				walk(path);
			} else {
				const hash = createHash('sha256')
					.update(readFileSync(join(root, path)))
					.digest('hex');
				files.set(path, hash);
			}
		}
	};
	walk('');
	return { files, dirs };
}

export function diffSnapshots(before, after) {
	const changes = [];
	for (const [path, hash] of after.files) {
		if (!before.files.has(path)) changes.push({ path, kind: 'added' });
		else if (before.files.get(path) !== hash) changes.push({ path, kind: 'modified' });
	}
	for (const path of before.files.keys()) {
		if (!after.files.has(path)) changes.push({ path, kind: 'deleted' });
	}
	return changes.sort((a, b) => a.path.localeCompare(b.path));
}

export function readIn(dir, file) {
	const path = join(dir, file);
	return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

export function tail(text, lines = 20) {
	return text.trimEnd().split('\n').slice(-lines).join('\n');
}

export function runClaude({ prompt, agent, model, budget, dir, tools, extraArgs = [] }) {
	const args = [
		'-p',
		prompt,
		'--plugin-dir',
		PLUGIN,
		'--agent',
		agent,
		'--model',
		model,
		'--output-format',
		'json',
		'--permission-mode',
		'acceptEdits',
		'--allowedTools',
		...tools,
		'--max-budget-usd',
		String(budget),
		'--no-session-persistence',
		...extraArgs,
	];
	const env = { ...process.env };
	delete env.CLAUDE_PROJECT_DIR;
	delete env.CLAUDE_PLUGIN_ROOT;
	return new Promise(done => {
		const started = Date.now();
		const child = spawn('claude', args, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGTERM');
		}, CLAUDE_TIMEOUT_MS);
		child.stdout.on('data', d => (stdout += d));
		child.stderr.on('data', d => (stderr += d));
		child.on('error', error => {
			clearTimeout(timer);
			done({
				exitCode: null,
				stdout,
				stderr: `${stderr}${error.message}`,
				timedOut,
				wallMs: Date.now() - started,
			});
		});
		child.on('close', exitCode => {
			clearTimeout(timer);
			done({ exitCode, stdout, stderr, timedOut, wallMs: Date.now() - started });
		});
	});
}

export function parseClaudeJson(stdout) {
	const candidates = [stdout.trim(), ...stdout.trim().split('\n').reverse()];
	for (const text of candidates) {
		try {
			const value = JSON.parse(text);
			const result = Array.isArray(value) ? value.findLast(e => e?.type === 'result') : value;
			if (result && typeof result === 'object') return result;
		} catch {}
	}
	return null;
}

export function claudeRecord(json, raw) {
	const record = {
		exitCode: raw.exitCode,
		timedOut: raw.timedOut,
		wallMs: raw.wallMs,
		isError: json?.is_error ?? null,
		subtype: json?.subtype ?? null,
		costUsd: json?.total_cost_usd ?? json?.cost_usd ?? null,
		numTurns: json?.num_turns ?? null,
		durationMs: json?.duration_ms ?? null,
		models: json?.modelUsage ? Object.keys(json.modelUsage) : null,
		stderr: raw.stderr ? tail(raw.stderr) : '',
	};
	if (!json) record.stdout = tail(raw.stdout);
	return record;
}

export const noJsonError = raw =>
	`no JSON result from claude (exit ${raw.exitCode}${raw.timedOut ? ', timed out' : ''})`;

export async function pool(tasks, jobs, onDone) {
	const results = new Array(tasks.length);
	let next = 0;
	const worker = async () => {
		while (next < tasks.length) {
			const i = next++;
			results[i] = await tasks[i]();
			onDone(results[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, worker));
	return results;
}

export const mean = xs => {
	const ys = xs.filter(x => typeof x === 'number');
	return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
};
export const pct = x => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
export const fmtNum = (x, digits) => (x === null ? 'n/a' : x.toFixed(digits));
