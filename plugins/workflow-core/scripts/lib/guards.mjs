import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { git, toplevel } from './git.mjs';

const SPECIAL = /[.+^${}()|[\]\\]/g;

export function globToRegExp(glob) {
	let re = '';
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === '*' && glob[i + 1] === '*') {
			const atStart = i === 0 || glob[i - 1] === '/';
			const next = glob[i + 2];
			if (atStart && next === '/') {
				re += '(?:.*/)?';
				i += 2;
			} else if (atStart && next === undefined && re.endsWith('/')) {
				re = `${re.slice(0, -1)}(?:/.*)?`;
				i += 1;
			} else {
				re += '.*';
				i += 1;
			}
		} else if (c === '*') re += '[^/]*';
		else if (c === '?') re += '[^/]';
		else re += c.replace(SPECIAL, '\\$&');
	}
	return new RegExp(`^${re}$`);
}

export const matchesGlob = (path, glob) => globToRegExp(glob).test(path);

function realish(abs) {
	const rest = [];
	let dir = abs;
	while (!existsSync(dir)) {
		rest.unshift(basename(dir));
		const parent = dirname(dir);
		if (parent === dir) return abs;
		dir = parent;
	}
	return join(realpathSync(dir), ...rest);
}

const inside = rel => rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);

export function projectPath(root, file) {
	const abs = resolve(root, file);
	const plain = relative(root, abs);
	if (inside(plain)) return plain.split(sep).join('/');
	const real = relative(realpathSync(root), realish(abs));
	return inside(real) ? real.split(sep).join('/') : null;
}

function isTracked(root, path) {
	const abs = realish(resolve(root, path));
	let dir = dirname(abs);
	while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
	const repo = toplevel(dir);
	if (!repo) return false;
	return git(repo, ['ls-files', '--error-unmatch', '--', relative(repo, abs)]) !== null;
}

export function protectedRule(root, guards, file) {
	const path = projectPath(root, file);
	if (path === null) return null;
	for (const rule of guards.protectedPaths) {
		if (!matchesGlob(path, rule.glob)) continue;
		if (rule.when === 'tracked' && !isTracked(root, path)) continue;
		return rule;
	}
	return null;
}

export function splitSegments(command) {
	const segments = [];
	let current = '';
	let quote = null;
	const push = () => {
		if (current.trim()) segments.push(current.trim());
		current = '';
	};
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (quote) {
			current += c;
			if (c === '\\' && quote === '"') current += command[++i] ?? '';
			else if (c === quote) quote = null;
		} else if (c === "'" || c === '"') {
			quote = c;
			current += c;
		} else if (c === '\\') {
			current += c + (command[++i] ?? '');
		} else if ('\n;&|()'.includes(c)) {
			push();
			if ((c === '&' || c === '|') && command[i + 1] === c) i++;
		} else current += c;
	}
	push();
	return segments;
}

const unquote = token => token.replace(/^(['"])(.*)\1$/, '$2');

function tokens(segment) {
	return segment.split(/\s+/).filter(Boolean).map(unquote);
}

function normalizeDir(dir) {
	const d = posix.normalize(dir).replace(/\/+$/, '');
	return d === '' || d === './' ? '.' : d;
}

const under = (path, dir) => path === dir || dir === '.' || path.startsWith(`${dir}/`);

function projectDir(root, dir) {
	const abs = resolve(root, dir);
	if (abs === resolve(root) || realish(abs) === realpathSync(root)) return '.';
	return projectPath(root, dir);
}

function joinCwd(root, cwd, target) {
	if (isAbsolute(target)) return projectDir(root, target);
	return cwd === null ? null : normalizeDir(posix.join(cwd, target));
}

function mentions(root, segment, cwd, dir) {
	return tokens(segment).some(token => {
		const value = token.includes('=') ? token.slice(token.indexOf('=') + 1) : token;
		if (!value || value.startsWith('-')) return false;
		const path = joinCwd(root, cwd ?? '.', value);
		return path !== null && path !== '.' && under(path, dir);
	});
}

export function blockedCommand(root, guards, command, hookCwd) {
	if (guards.blockedCommands.length === 0) return null;
	const rules = guards.blockedCommands.map(rule => ({
		...rule,
		re: new RegExp(rule.regex),
		dir: rule.cwd === undefined ? null : normalizeDir(rule.cwd),
	}));
	let cwd = hookCwd ? projectDir(root, hookCwd) : '.';
	for (const segment of splitSegments(command)) {
		for (const rule of rules) {
			if (!rule.re.test(segment)) continue;
			if (rule.dir === null) return rule;
			if ((cwd !== null && under(cwd, rule.dir)) || mentions(root, segment, cwd, rule.dir)) {
				return rule;
			}
		}
		const cd = segment.match(/^cd(?:\s+(\S+))?\s*$/);
		if (cd) cwd = cd[1] ? joinCwd(root, cwd, unquote(cd[1])) : null;
	}
	return null;
}
