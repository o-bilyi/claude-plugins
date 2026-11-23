#!/usr/bin/env node
import { findRoot, normalizeConfig, readRawConfig } from './lib/config.mjs';
import { checkDocs, renderDocs, skipReason } from './lib/docs.mjs';
import { blockedCommand, splitSegments } from './lib/guards.mjs';
import { buildModel } from './lib/model.mjs';

const COMMIT = /^git(?:\s+-[Cc]\s+\S+)*\s+commit(?:\s|$)/;
const ALL_FLAG = /\s(?:--all|-[A-Za-z]*a[A-Za-z]*)(?=\s|$)/;

function docsGate(root, config, command) {
	const docs = config.docs;
	if (!docs) return 0;
	const commit = splitSegments(command).find(segment => COMMIT.test(segment));
	if (!commit) return 0;
	const all = ALL_FLAG.test(commit.replace(/(["'])[\s\S]*?\1/g, ''));
	const report = checkDocs(buildModel(root, config), docs, {
		staged: true,
		all,
		skip: skipReason(command, docs.skipTrailer),
	});
	if (report.ok) return 0;
	const text = renderDocs(report, docs);
	if (docs.mode === 'require' && docs.enforceAt === 'commit') {
		process.stderr.write(`Blocked: ${text}\n`);
		return 2;
	}
	process.stdout.write(`${JSON.stringify({ systemMessage: text })}\n`);
	return 0;
}

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
	let config;
	try {
		const raw = readRawConfig(root);
		if (raw === null) return 0;
		config = normalizeConfig(raw);
	} catch {
		return 0;
	}
	const rule = config.guards.blockedCommands.length
		? blockedCommand(root, config.guards, command, payload.cwd)
		: null;
	if (rule) {
		process.stderr.write(`Blocked: ${rule.message}\n`);
		return 2;
	}
	return docsGate(root, config, command);
}

main().then(
	code => {
		process.exitCode = code;
	},
	() => {
		process.exitCode = 0;
	}
);
