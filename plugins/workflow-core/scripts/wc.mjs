#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	ConfigError,
	findRoot,
	getValue,
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
import { missingOnPath, missingTool, matchesAny } from './lib/shell.mjs';
import { renderTable } from './lib/table.mjs';
import { touched } from './lib/touched.mjs';

const USAGE = `usage: wc.mjs <command> [--json]
  doctor | units | table | get <dot.path> | config
  touched [--since-base] | reviewers [--since-base]
  check [unit...] [--stop] [--since-base]
  docs [--staged]
  preflight [unit...] [--force]
  baseline save [unit...] [--force] | baseline status | baseline clear [unit...]
exit codes: 0 ok, 1 a check failed (get: no value; docs: out of date in require mode), 2 invalid config or usage, 3 no config or unsupported config version`;
const FLAGS = new Set(['--json', '--since-base', '--force', '--stop', '--staged']);

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

export async function main(argv) {
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

	const root = findRoot();
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
			const report = await runChecks(model, { units: args, stop, sinceBase });
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
