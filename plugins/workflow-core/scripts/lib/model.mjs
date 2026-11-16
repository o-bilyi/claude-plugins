import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { git, gitPath, toplevel } from './git.mjs';
import { hasExt } from './shell.mjs';

const DEFAULT_BASE = 'main';

const isInside = rel => rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);

function repoKey(root, top) {
	return relative(root, top) || '.';
}

function originHead(repoPath) {
	const out = git(repoPath, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.trim();
	return out ? out.replace(/^origin\//, '') : null;
}

export function resolveBase(config, key, repoPath) {
	const override = config.repos[key] ?? {};
	if (override.baseBranch) return { baseBranch: override.baseBranch, baseSource: 'repos' };
	if (config.baseBranch) return { baseBranch: config.baseBranch, baseSource: 'config' };
	const origin = originHead(repoPath);
	if (origin) return { baseBranch: origin, baseSource: 'origin/HEAD' };
	return { baseBranch: DEFAULT_BASE, baseSource: 'default' };
}

function makeRepo(config, key, path) {
	const override = config.repos[key] ?? {};
	const base = resolveBase(config, key, path);
	return {
		key,
		path,
		...base,
		prTarget: override.prTarget ?? config.prTarget ?? base.baseBranch,
		format: override.format ?? config.format,
		state: gitPath(path, 'workflow-core'),
		units: [],
	};
}

export function buildModel(root, config) {
	const realRoot = realpathSync(root);
	const tops = new Map();
	const topOf = dir => {
		if (!tops.has(dir)) tops.set(dir, existsSync(dir) ? toplevel(dir) : null);
		return tops.get(dir);
	};

	const repos = {};
	const units = {};
	const orphans = [];
	for (const [name, unit] of Object.entries(config.units)) {
		const path = resolve(realRoot, unit.dir);
		const top = topOf(path);
		if (!top) {
			orphans.push(name);
			units[name] = { ...unit, name, path, repo: null };
			continue;
		}
		const key = repoKey(realRoot, top);
		repos[key] ??= makeRepo(config, key, top);
		repos[key].units.push(name);
		units[name] = { ...unit, name, path, repo: key };
	}

	return {
		root: realRoot,
		config,
		repos,
		units,
		orphans,
		formatFor: file => formatFor(realRoot, config, file),
	};
}

function unitForPath(config, rel) {
	let best = null;
	for (const [name, unit] of Object.entries(config.units)) {
		const inside = unit.dir === '.' || rel === unit.dir || rel.startsWith(`${unit.dir}/`);
		if (inside && (!best || unit.dir.length > best.dir.length)) best = { ...unit, name };
	}
	return best;
}

export function formatFor(root, config, file) {
	if (typeof file !== 'string' || file === '') return null;
	const realRoot = realpathSync(root);
	const given = resolve(root, file);
	if (!existsSync(given) || !statSync(given).isFile()) return null;
	const abs = realpathSync(given);
	const rel = relative(realRoot, abs);
	if (!rel || !isInside(rel)) return null;

	let repoTop;
	const repo = () => (repoTop === undefined ? (repoTop = toplevel(dirname(abs))) : repoTop);

	const unit = unitForPath(config, rel);
	let format = unit?.format;
	if (!format && Object.keys(config.repos).length && repo()) {
		format = config.repos[repoKey(realRoot, repo())]?.format;
	}
	format ??= config.format;
	if (!format || !hasExt(rel, format.extensions)) return null;

	let cwd = realRoot;
	if (format.runFrom === 'unit' && unit) cwd = resolve(realRoot, unit.dir);
	else if (format.runFrom !== 'root' && repo()) cwd = repo();
	return { command: format.command, cwd, file: relative(cwd, abs) };
}
