#!/usr/bin/env node
import { findRoot, normalizeConfig, readRawConfig } from './lib/config.mjs';
import { blockedCommand } from './lib/guards.mjs';

function readStdin() {
	return new Promise(done => {
		if (process.stdin.isTTY) return done('');
		const chunks = [];
		process.stdin.on('data', chunk => chunks.push(chunk));
		process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
	});
}

async function main() {
	const payload = JSON.parse((await readStdin()) || '{}');
	const command = payload?.tool_input?.command;
	if (typeof command !== 'string' || command.trim() === '') return 0;
	const root = findRoot();
	let guards;
	try {
		const raw = readRawConfig(root);
		if (raw === null) return 0;
		guards = normalizeConfig(raw).guards;
	} catch {
		return 0;
	}
	if (!guards?.blockedCommands.length) return 0;
	const rule = blockedCommand(root, guards, command, payload.cwd);
	if (!rule) return 0;
	process.stderr.write(`Blocked: ${rule.message}\n`);
	return 2;
}

main().then(
	code => {
		process.exitCode = code;
	},
	() => {
		process.exitCode = 0;
	}
);
