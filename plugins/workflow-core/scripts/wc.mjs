#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ConfigError,
	findRoot,
	getValue,
	KINDS,
	loadConfig,
	MISSING_MESSAGE,
	normalizeTrigger,
	UnsupportedVersionError,
} from './lib/config.mjs';
import { baselineStatus, clearBaseline, saveBaseline } from './lib/baseline.mjs';
import { renderChecks, runChecks } from './lib/check.mjs';
import { checkDocs, renderDocs } from './lib/docs.mjs';
import { refExists } from './lib/git.mjs';
import { buildModel } from './lib/model.mjs';
import { preflight, renderBaselineSave, renderPreflight } from './lib/preflight.mjs';
import { checkPlan, planKind, renderPlanCheck } from './lib/plan.mjs';
import { lintProse, renderProse } from './lib/prose.mjs';
import { renderRepro, runRepro } from './lib/repro.mjs';
import {
	advancePhase,
	clearRun,
	nextRound,
	projectState,
	readMetrics,
	readPlan,
	readRun,
	recordMetrics,
	recordReview,
	renderMetrics,
	renderReview,
	setRun,
	startRun,
	summarizeMetrics,
	switchMode,
} from './lib/runstate.mjs';
import { diffstat, renderDiffstat, renderScope, scope } from './lib/scope.mjs';
import { missingOnPath, missingTool, matchesAny } from './lib/shell.mjs';
import { renderTable } from './lib/table.mjs';
import { touched } from './lib/touched.mjs';

const USAGE = `usage: wc.mjs <command> [--json]
  doctor | units | table | get <dot.path> | config
  touched [--since-base] | reviewers [--since-base] | diffstat [--since-base]
  check [unit...] [--stop] [--since-base] [--kind <kind>] [--retry]
  scope [--plan <file|->] [--since-base]   (without --plan: the plan of the run)
  plan check [--plan <file|->] | repro   (without --plan: the plan of the run)
  docs [--staged]
  preflight [unit...] [--force]
  baseline save [unit...] [--force] | baseline status | baseline clear [unit...]
  state | state get <key> | state set <key=value...> | state clear
  state start [quick|full] [--plan <file|->] | state round | state review -   (JSON on stdin)
  metrics | metrics record -   (JSON on stdin)
  writing | prose <file|-...> [--strict] | prose --rules   (work without a config)
exit codes: 0 ok, 1 a check failed (get: no value; docs: out of date in require mode; scope: files outside the plan; plan check and state start: the plan misses parts; repro: the bug still shows; state round: no round left; prose --strict: writing issues), 2 invalid config or usage, 3 no config or unsupported config version`;
const FLAGS = new Set([
	'--json',
	'--since-base',
	'--force',
	'--stop',
	'--staged',
	'--strict',
	'--rules',
	'--retry',
]);
const VALUE_FLAGS = new Set(['--kind', '--plan']);
const RULES_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'ste100.md');

// Takes `--name value` pairs out of argv.
function takeValues(argv) {
	const rest = [];
	const values = {};
	for (let i = 0; i < argv.length; i++) {
		if (VALUE_FLAGS.has(argv[i])) {
			if (i + 1 >= argv.length) throw new UsageError(`${argv[i]} needs a value`);
			values[argv[i].slice(2)] = argv[++i];
		} else rest.push(argv[i]);
	}
	return { rest, values };
}

class UsageError extends Error {}

function readInput(path) {
	return path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
}

// The writing rules for the prompts, in one call: the STE rules for `ste100`, and the project guide.
function writing(root) {
	let config = null;
	try {
		config = loadConfig(root);
	} catch {
		config = null;
	}
	const style = config?.writing?.style ?? 'plain';
	const guide = config?.writing?.guide;
	const parts = [];
	if (style === 'ste100') parts.push(readFileSync(RULES_FILE, 'utf8').trimEnd());
	if (guide) {
		const file = join(root, guide);
		parts.push(
			existsSync(file)
				? `## Project writing guide (${guide})\n\n${readFileSync(file, 'utf8').trimEnd()}`
				: `Project writing guide ${guide} not found.`
		);
	}
	console.log(parts.length ? parts.join('\n\n') : 'Writing style: plain. No extra rules.');
	return 0;
}

function readStdin(arg, what) {
	if (arg !== '-') throw new UsageError(`${what} reads JSON from stdin: use ${what} -`);
	return readFileSync(0, 'utf8');
}

function prose(files, { json, strict, rules }) {
	if (rules) {
		console.log(readFileSync(RULES_FILE, 'utf8').trimEnd());
		return 0;
	}
	if (files.length === 0) {
		console.error(`prose needs a file or -\n${USAGE}`);
		return 2;
	}
	const results = files.map(file => ({ file, issues: lintProse(readInput(file)) }));
	print(results, json, () => renderProse(results));
	return strict && results.some(r => r.issues.length) ? 1 : 0;
}

function print(value, json, text) {
	const out = json ? JSON.stringify(value, null, 2) : text();
	if (out !== '') console.log(out);
}

function doctor(model) {
	const problems = [];
	const add = (type, message) => problems.push({ type, message });

	for (const name of model.orphans) {
		const unit = model.units[name];
		const why = existsSync(unit.path) ? 'is not inside a git work tree' : 'does not exist';
		add('orphan', `unit ${name}: ${unit.dir} ${why}; it is skipped`);
	}
	for (const key of Object.keys(model.config.repos)) {
		if (!model.repos[key]) add('repo', `repos.${key}: no unit resolves to this repo`);
	}
	for (const repo of Object.values(model.repos)) {
		const found =
			refExists(repo.path, repo.baseBranch) || refExists(repo.path, `origin/${repo.baseBranch}`);
		if (!found) {
			const why =
				repo.baseSource === 'default' ? ' (no baseBranch configured and no origin/HEAD)' : '';
			add('base', `repo ${repo.key}: base branch ${repo.baseBranch} not found${why}`);
		}
		if (!repo.state) add('state', `repo ${repo.key}: cannot resolve the git state directory`);
	}
	for (const unit of Object.values(model.units)) {
		if (unit.repo === null) continue;
		const seen = new Set();
		for (const check of unit.checks) {
			const cwd = unit.path;
			for (const command of [check.run, check.changed, check.related].filter(Boolean)) {
				const tool = missingTool(command, cwd) ?? missingOnPath(command);
				if (tool && !seen.has(tool)) {
					seen.add(tool);
					add('binary', `unit ${unit.name}, check ${check.name}: ${tool} not found`);
				}
			}
		}
	}
	return problems;
}

function unitsView(model) {
	return {
		root: model.root,
		repos: model.repos,
		units: model.units,
		orphans: model.orphans,
	};
}

function unitsText(model) {
	const lines = [];
	for (const repo of Object.values(model.repos)) {
		lines.push(
			`repo ${repo.key}: base ${repo.baseBranch} (${repo.baseSource}), PR target ${repo.prTarget}`
		);
		for (const name of repo.units) {
			const unit = model.units[name];
			const checks = unit.checks.map(c => c.name).join(', ') || '-';
			const stop = unit.stopHook ? '' : ' [no stop hook]';
			lines.push(`  ${name} (${unit.dir})${stop}: ${checks}`);
		}
	}
	if (model.orphans.length) lines.push(`outside git: ${model.orphans.join(', ')}`);
	return lines.join('\n');
}

function statusText(repos) {
	const lines = [];
	for (const [key, repo] of Object.entries(repos)) {
		if (!repo.present) {
			lines.push(`repo ${key}: no baseline`);
			continue;
		}
		const stale = repo.stale ? ' (stale: HEAD changed since)' : '';
		lines.push(
			`repo ${key}: saved ${repo.savedAt} at ${repo.head?.slice(0, 12)}${stale}, ${repo.dirty ?? 0} dirty file(s)`
		);
		for (const [unit, checks] of Object.entries(repo.units)) {
			for (const [name, c] of Object.entries(checks)) {
				const what =
					c.count !== undefined
						? `${c.count} errors`
						: c.unparseable
							? `unparseable (${c.unparseable})`
							: `skipped (${c.skipped})`;
				lines.push(`  ${unit} ${name}: ${what}`);
			}
		}
	}
	return lines.join('\n');
}

function touchedText(result) {
	const lines = [];
	for (const [key, repo] of Object.entries(result.repos)) {
		if (repo.projectFiles.length === 0) continue;
		lines.push(`repo ${key}:`, ...repo.projectFiles.map(f => `  ${f}`));
	}
	lines.push(`units: ${result.units.join(' ') || '-'}`);
	return lines.join('\n');
}

export async function main(rawArgv) {
	let argv;
	let values;
	try {
		({ rest: argv, values } = takeValues(rawArgv));
	} catch (err) {
		if (!(err instanceof UsageError)) throw err;
		console.error(`${err.message}\n${USAGE}`);
		return 2;
	}
	const json = argv.includes('--json');
	const sinceBase = argv.includes('--since-base');
	const force = argv.includes('--force');
	const stop = argv.includes('--stop');
	const staged = argv.includes('--staged');
	const [command, ...args] = argv.filter(a => !a.startsWith('--'));
	const unknown = argv.filter(a => a.startsWith('--') && !FLAGS.has(a));
	if (unknown.length) {
		console.error(`Unknown option: ${unknown.join(' ')}\n${USAGE}`);
		return 2;
	}
	if (values.kind && !KINDS.includes(values.kind)) {
		console.error(`--kind must be one of ${KINDS.join(', ')}`);
		return 2;
	}
	if (command === 'prose') {
		return prose(args, {
			json,
			strict: argv.includes('--strict'),
			rules: argv.includes('--rules'),
		});
	}

	const root = findRoot();
	if (command === 'writing') return writing(root);
	let config;
	try {
		config = loadConfig(root);
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(err.message);
		return err instanceof UnsupportedVersionError ? 3 : 2;
	}
	if (!config) {
		console.error(MISSING_MESSAGE);
		return 3;
	}

	if (command === 'get') {
		const value = getValue(config, args[0] ?? '');
		if (value === undefined) {
			console.error(`No value at ${args[0]}`);
			return 1;
		}
		print(value, json, () => (typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
		return 0;
	}

	if (command === 'config') {
		console.log(JSON.stringify(config, null, '\t'));
		return 0;
	}

	const commands = {
		doctor: model => {
			const problems = doctor(model);
			print({ problems }, json, () =>
				problems.length
					? [`${problems.length} problem(s):`, ...problems.map(p => `- ${p.message}`)].join('\n')
					: 'No problems found.'
			);
		},
		units: model => print(unitsView(model), json, () => unitsText(model)),
		touched: model => {
			const result = touched(model, { sinceBase });
			print(result, json, () => touchedText(result));
		},
		table: model => {
			const table = renderTable(config);
			print({ table }, json, () => table);
		},
		check: async model => {
			const kinds = values.kind ? [values.kind] : null;
			const retry = argv.includes('--retry');
			const report = await runChecks(model, { units: args, stop, sinceBase, kinds, retry });
			print(report, json, () => renderChecks(report));
			return report.ok ? 0 : 1;
		},
		docs: model => {
			if (!config.docs) {
				print({ enabled: false }, json, () => 'Docs: not configured (no docs section)');
				return 0;
			}
			const report = checkDocs(model, config.docs, { staged });
			print(report, json, () => renderDocs(report, config.docs));
			return report.ok || config.docs.mode !== 'require' ? 0 : 1;
		},
		preflight: async model => {
			const result = await preflight(model, args, { force });
			advancePhase(projectState(model), 'implement');
			print(result, json, () => renderPreflight(result));
		},
		baseline: async model => {
			const [action, ...units] = args;
			if (action === 'save') {
				const result = await saveBaseline(model, units, { force });
				print(result, json, () => renderBaselineSave(result));
			} else if (action === 'status') {
				const repos = baselineStatus(model);
				print(repos, json, () => statusText(repos));
			} else if (action === 'clear') {
				const cleared = clearBaseline(model, units);
				print({ cleared }, json, () => `Cleared: ${cleared.join(', ') || 'nothing'}`);
			} else {
				console.error(USAGE);
				return 2;
			}
		},
		diffstat: model => {
			const result = diffstat(model, touched(model, { sinceBase }), { sinceBase });
			print(result, json, () => renderDiffstat(result));
		},
		scope: model => {
			const dir = projectState(model);
			const text = values.plan ? readInput(values.plan) : readPlan(dir);
			if (text === null) {
				console.error(`scope needs --plan <file|->: the run has no plan\n${USAGE}`);
				return 2;
			}
			const run = readRun(dir);
			const result = scope(model, touched(model, { sinceBase }), text, { mode: run.mode });
			if (result.quickExceeded) switchMode(dir, 'full');
			print(result, json, () => renderScope(result));
			return result.ok ? 0 : 1;
		},
		plan: model => {
			if (args[0] !== 'check') {
				console.error(USAGE);
				return 2;
			}
			const text = values.plan ? readInput(values.plan) : readPlan(projectState(model));
			if (text === null) {
				console.error(`plan check needs --plan <file|->: the run has no plan\n${USAGE}`);
				return 2;
			}
			const result = checkPlan(model, text, { mode: readRun(projectState(model)).mode });
			print(result, json, () => renderPlanCheck(result));
			return result.ok ? 0 : 1;
		},
		repro: async model => {
			const dir = projectState(model);
			const text = readPlan(dir);
			if (text === null) {
				console.error(`repro needs a run with a plan: run state start --plan first\n${USAGE}`);
				return 2;
			}
			const result = await runRepro(model, dir, text);
			print(result, json, () => renderRepro(result));
			return result.ok ? 0 : 1;
		},
		state: model => {
			const dir = projectState(model);
			const [action, ...rest] = args;
			if (!action) {
				const run = readRun(dir);
				print(run, json, () => JSON.stringify(run, null, 2));
				return 0;
			}
			if (action === 'get') {
				const value = readRun(dir)[rest[0]];
				if (value === undefined) {
					console.error(`No state at ${rest[0]}`);
					return 1;
				}
				print(value, json, () =>
					typeof value === 'string' ? value : JSON.stringify(value, null, 2)
				);
				return 0;
			}
			if (action === 'clear') {
				clearRun(dir);
				print({}, json, () => 'Run state cleared.');
				return 0;
			}
			if (action === 'set') {
				const run = setRun(dir, rest);
				print(run, json, () => `Saved ${rest.map(p => p.split('=')[0]).join(', ')}.`);
				return 0;
			}
			if (action === 'start') {
				const planText = values.plan ? readInput(values.plan) : undefined;
				const plan = values.plan && values.plan !== '-' ? values.plan : null;
				if (planText !== undefined) {
					const result = checkPlan(model, planText, { mode: rest[0] });
					if (!result.ok) {
						print(result, json, () => renderPlanCheck(result));
						return 1;
					}
				}
				const kind = planText === undefined ? 'feature' : planKind(planText);
				const run = startRun(dir, model, { mode: rest[0], plan, planText, kind });
				print(
					run,
					json,
					() => `Run started: mode=${run.mode}, kind=${run.kind}, phase=${run.phase}.`
				);
				return 0;
			}
			if (action === 'round') {
				const result = nextRound(dir, config.process.maxRounds);
				print(result, json, () =>
					result.ok
						? `round ${result.round} of ${result.maxRounds}`
						: `NEXT: ask (no round left: ${result.round} of ${result.maxRounds})`
				);
				return result.ok ? 0 : 1;
			}
			if (action === 'review') {
				const result = recordReview(
					dir,
					readStdin(rest[0], 'state review'),
					config.process.maxRounds
				);
				print(result, json, () => renderReview(result));
				return 0;
			}
			console.error(USAGE);
			return 2;
		},
		metrics: model => {
			const dir = projectState(model);
			const [action, arg] = args;
			if (action === 'record') {
				const size = diffstat(model, touched(model, {}), {});
				const entry = recordMetrics(dir, readStdin(arg, 'metrics record'), size);
				print(entry, json, () => 'Recorded.');
				return 0;
			}
			if (action) {
				console.error(USAGE);
				return 2;
			}
			const entries = readMetrics(dir);
			print({ entries, summary: summarizeMetrics(entries) }, json, () =>
				renderMetrics(summarizeMetrics(entries))
			);
		},
		reviewers: model => {
			const { files } = touched(model, { sinceBase });
			const matched = config.reviewers.filter(r =>
				files.some(f => matchesAny(f, r.paths.map(normalizeTrigger)))
			);
			print(matched, json, () => matched.map(r => r.agent).join('\n'));
		},
	};

	if (!commands[command]) {
		console.error(USAGE);
		return 2;
	}
	return (await commands[command](buildModel(root, config))) ?? 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (err) {
		console.error(err.message);
		process.exitCode = 2;
	}
}
