import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { firstToken, shellQuote } from './shell.mjs';

export const LINE_LIMIT = 40;
export const PLACEHOLDER = /\{(code|files)\}/;

export const safeName = name => name.replaceAll('/', '_');

export function runCommand(command, cwd) {
	return new Promise(done => {
		const stdout = [];
		const output = [];
		const child = spawn('sh', ['-c', command], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
		child.stdout.on('data', chunk => {
			stdout.push(chunk);
			output.push(chunk);
		});
		child.stderr.on('data', chunk => output.push(chunk));
		child.on('error', err => done({ code: 1, stdout: '', output: err.message }));
		child.on('close', code =>
			done({
				code: code ?? 1,
				stdout: Buffer.concat(stdout).toString('utf8'),
				output: Buffer.concat(output).toString('utf8'),
			})
		);
	});
}

export function isSimpleTsc(command) {
	return (
		basename(firstToken(command)) === 'tsc' &&
		!/&&|\|\||;|\|/.test(command) &&
		!/(^|\s)(-b|--build)(\s|$)/.test(command)
	);
}

export function withIncremental(command, buildInfo) {
	if (!isSimpleTsc(command)) return command;
	mkdirSync(dirname(buildInfo), { recursive: true });
	return `${command} --incremental --tsBuildInfoFile ${shellQuote(buildInfo)}`;
}

export function excerpt(output, keep) {
	const lines = output.replace(/\n+$/, '').split('\n');
	return (keep === 'tail' ? lines.slice(-LINE_LIMIT) : lines.slice(0, LINE_LIMIT)).join('\n');
}
