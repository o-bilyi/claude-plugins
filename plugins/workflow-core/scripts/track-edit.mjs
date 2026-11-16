#!/usr/bin/env node
import { findRoot, loadConfig } from './lib/config.mjs';
import { buildModel } from './lib/model.mjs';
import { recordEdit } from './lib/session.mjs';

function readStdin() {
	return new Promise(done => {
		if (process.stdin.isTTY) return done('');
		const chunks = [];
		process.stdin.on('data', chunk => chunks.push(chunk));
		process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
	});
}

try {
	const payload = JSON.parse((await readStdin()) || '{}') ?? {};
	const file = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path;
	const root = findRoot();
	const config = loadConfig(root);
	if (config && payload.session_id && file) {
		recordEdit(buildModel(root, config), payload.session_id, file);
	}
} catch {
	// Tracking must never block an edit.
}
