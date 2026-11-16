#!/usr/bin/env node
import { runChecks } from './lib/check.mjs';
import { findRoot, loadConfig, UnsupportedVersionError } from './lib/config.mjs';
import { buildModel } from './lib/model.mjs';
import { sessionFiles } from './lib/session.mjs';

function readStdin() {
	return new Promise(done => {
		if (process.stdin.isTTY) return done('');
		const chunks = [];
		process.stdin.on('data', chunk => chunks.push(chunk));
		process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
	});
}

function parse(text) {
	try {
		return JSON.parse(text) ?? {};
	} catch {
		return {};
	}
}

function section(check) {
	const body = check.caused?.length ? check.caused.join('\n') : (check.raw ?? '');
	const pre = check.preExisting ? `\n(${check.preExisting} pre-existing errors not shown)` : '';
	return `\n## ${check.label}\n${body}${pre}`;
}

async function main() {
	const payload = parse(await readStdin());
	if (payload.stop_hook_active === true) return 0;

	const root = findRoot();
	let config;
	try {
		config = loadConfig(root);
	} catch (err) {
		// An old config is reported by session-start and wc.mjs; it must not fail every reply.
		if (err instanceof UnsupportedVersionError) return 0;
		throw err;
	}
	if (!config) return 0;

	const model = buildModel(root, config);
	// Only the files this session edited count; a session that edited nothing has nothing to verify.
	let only = null;
	if (payload.session_id) {
		only = sessionFiles(model, payload.session_id);
		if (!only) return 0;
	}
	const report = await runChecks(model, { stop: true, only });
	const failed = report.units.flatMap(unit => unit.checks).filter(c => c.status === 'fail');

	if (failed.length === 0) {
		const parts = [];
		if (report.missing.length) parts.push(`skipped checks — ${report.missing.join('; ')}`);
		if (report.warnings.length) parts.push(`warnings — ${report.warnings.join('; ')}`);
		if (parts.length)
			console.log(JSON.stringify({ systemMessage: `verify-changed: ${parts.join('. ')}` }));
		return 0;
	}

	const notes = [...report.missing, ...report.warnings];
	const skipped = notes.length ? `\n## skipped\n${notes.map(item => `- ${item}`).join('\n')}` : '';
	process.stderr.write(
		`verify-changed hook found problems in changed apps:${failed.map(section).join('')}${skipped}\n`
	);
	return 2;
}

main().then(
	code => {
		process.exitCode = code;
	},
	err => {
		process.stderr.write(`${err.message}\n`);
		process.exitCode = 1;
	}
);
