#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { loadConfig } from './lib/config.mjs';
import { formatFor } from './lib/model.mjs';
import { missingTool, shellQuote } from './lib/shell.mjs';

function readStdin() {
	return new Promise(done => {
		if (process.stdin.isTTY) return done('');
		const chunks = [];
		process.stdin.on('data', chunk => chunks.push(chunk));
		process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
	});
}

function formatFile(root, file) {
	const config = loadConfig(root);
	if (!config) return;
	const target = formatFor(root, config, file);
	if (!target || missingTool(target.command, target.cwd)) return;

	spawnSync('sh', ['-c', `${target.command} ${shellQuote(target.file)}`], {
		cwd: target.cwd,
		stdio: 'ignore',
	});
}

try {
	const root = process.env.CLAUDE_PROJECT_DIR;
	if (root) {
		const payload = JSON.parse((await readStdin()) || '{}');
		formatFile(root, payload?.tool_input?.file_path);
	}
} catch {
	// A failed format must never block an edit.
}
