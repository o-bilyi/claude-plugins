import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, extname, join, resolve } from 'node:path';

const SAFE_SHELL_WORD = /^[\w@%+=:,./-]+$/;
const SHELL_BUILTINS = new Set([
	'.',
	':',
	'[',
	'cd',
	'echo',
	'exec',
	'exit',
	'export',
	'false',
	'test',
	'true',
]);

export function shellQuote(value) {
	const s = String(value);
	return SAFE_SHELL_WORD.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
}

export function expand(command, { files = [], code = [] } = {}) {
	return command
		.replaceAll('{files}', files.map(shellQuote).join(' '))
		.replaceAll('{code}', code.map(shellQuote).join(' '));
}

export const hasExt = (file, exts) => exts.includes('*') || exts.includes(extname(file).slice(1));

export const matchesAny = (file, prefixes) => prefixes.some(p => file.startsWith(p));

export const firstToken = command => command.trim().split(/\s+/)[0];

export function isExecutable(file) {
	try {
		accessSync(file, constants.X_OK);
		return statSync(file).isFile();
	} catch {
		return false;
	}
}

export function missingTool(command, cwd) {
	const token = firstToken(command);
	return token.includes('/') && !isExecutable(resolve(cwd, token)) ? token : null;
}

export function missingOnPath(command) {
	const token = firstToken(command);
	if (!token || token.includes('/') || token.includes('=') || SHELL_BUILTINS.has(token))
		return null;
	const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
	return dirs.some(dir => isExecutable(join(dir, token))) ? null : token;
}
