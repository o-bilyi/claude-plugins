#!/usr/bin/env node
import { baselineErrorCount } from './lib/baseline.mjs';
import { findRoot, loadConfig } from './lib/config.mjs';
import { git } from './lib/git.mjs';
import { buildModel } from './lib/model.mjs';
import { projectState, readRun, repoBranches } from './lib/runstate.mjs';
import { touched } from './lib/touched.mjs';

function main() {
	const root = findRoot();
	let config;
	try {
		config = loadConfig(root);
	} catch (err) {
		console.log(`workflow-core: ${err.message.split('\n')[0]} Run wc.mjs doctor for details.`);
		return;
	}
	if (!config) return;

	const model = buildModel(root, config);
	const result = touched(model);
	for (const [key, repo] of Object.entries(model.repos)) {
		const branch = git(repo.path, ['branch', '--show-current'])?.trim() || '(detached)';
		const changed = result.repos[key].entries.length;
		const errors = baselineErrorCount(repo);
		const baseline = errors === null ? 'no' : `yes (${errors} errors)`;
		console.log(`${key}: branch=${branch} changed=${changed} baseline=${baseline}`);
	}
	const run = readRun(projectState(model));
	if (run.phase && run.phase !== 'done') {
		const round = run.round === undefined ? '' : ` round=${run.round}`;
		const plan = run.plan ? ` plan=${run.plan}` : '';
		const now = repoBranches(model);
		const other = Object.entries(run.branches ?? {}).filter(
			([key, b]) => now[key] && now[key] !== b
		);
		const where = other.length
			? ` on another branch (${other.map(([key, b]) => `${key}: ${b}`).join(', ')})`
			: '';
		console.log(
			`workflow run in progress${where}: mode=${run.mode ?? '?'} phase=${run.phase}${round}${plan} (wc.mjs state shows it; resume or clear it)`
		);
	}
}

try {
	main();
} catch {
	// Session start must never fail.
}
