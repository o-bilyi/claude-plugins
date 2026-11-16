import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normalizeTrigger } from './config.mjs';
import { gitList, hashObject, refExists } from './git.mjs';
import { hasExt, matchesAny } from './shell.mjs';

export const DIRTY_FILE = 'baseline/dirty';

export const entryPath = entry => entry.slice(entry.indexOf(' ') + 1);

function workingTreeFiles(repoPath) {
	if (!refExists(repoPath, 'HEAD')) {
		return [
			...new Set(gitList(repoPath, ['ls-files', '--cached', '--others', '--exclude-standard'])),
		];
	}
	const status = gitList(repoPath, ['diff', '--name-status', '--no-renames', 'HEAD']);
	const changed = status.filter((_, i) => i % 2 === 1);
	const untracked = gitList(repoPath, ['ls-files', '--others', '--exclude-standard']);
	return [...new Set([...changed, ...untracked])];
}

export function entriesFor(repoPath, files) {
	const kinds = files.map(file => {
		const abs = join(repoPath, file);
		if (!existsSync(abs)) return 'deleted';
		return statSync(abs).isFile() ? 'file' : 'other';
	});
	const regular = files.filter((_, i) => kinds[i] === 'file');
	const shas = hashObject(repoPath, regular);
	const hashes = new Map(regular.map((file, i) => [file, shas[i]]));
	return files.map((file, i) => {
		if (kinds[i] === 'file') return `${hashes.get(file) ?? 'unknown'} ${file}`;
		return `${kinds[i]} ${file}`;
	});
}

export function readDirty(state) {
	const file = state && join(state, DIRTY_FILE);
	if (!file || !existsSync(file)) return null;
	return new Set(readFileSync(file, 'utf8').split('\n').filter(Boolean));
}

function sinceBaseFiles(repoPath, base) {
	const ref = refExists(repoPath, base) ? base : `origin/${base}`;
	return gitList(repoPath, ['diff', '--name-only', `${ref}...HEAD`]);
}

export function currentEntries(repo) {
	return entriesFor(repo.path, workingTreeFiles(repo.path));
}

// `only`: a Set of repo-relative paths; when given, other changes in the repo are ignored.
export function repoTouched(repo, { sinceBase = false, only = null } = {}) {
	const all = currentEntries(repo);
	const dirty = readDirty(repo.state);
	const entries = all.filter(entry => !dirty?.has(entry) && (!only || only.has(entryPath(entry))));
	const base = sinceBase ? sinceBaseFiles(repo.path, repo.baseBranch) : [];
	return { entries, files: [...new Set([...base, ...entries.map(entryPath)])] };
}

export function touched(model, options = {}) {
	const repos = {};
	const files = [];
	for (const [key, repo] of Object.entries(model.repos)) {
		const only = options.only ? (options.only[key] ?? new Set()) : null;
		const result = repoTouched(repo, { ...options, only });
		const project = f => relative(model.root, join(repo.path, f));
		const projectFiles = result.files.map(project);
		const projectEntries = result.entries.map(
			e => `${e.slice(0, e.indexOf(' '))} ${project(entryPath(e))}`
		);
		repos[key] = { ...result, projectFiles, projectEntries };
		files.push(...projectFiles);
	}
	const units = Object.values(model.units)
		.filter(unit => unit.repo !== null && files.some(f => matchesAny(f, unit.triggers)))
		.map(unit => unit.name);
	return { repos, files, units };
}

export function unitPaths(model, touchedResult, name) {
	const unit = model.units[name];
	const prefix = unit.dir === '.' ? '' : `${unit.dir}/`;
	return touchedResult.files.filter(f => f.startsWith(prefix)).map(f => f.slice(prefix.length));
}

export function unitFiles(model, touchedResult, name) {
	const { changed, code } = model.config.extensions;
	const dir = join(model.root, model.units[name].dir);
	const files = unitPaths(model, touchedResult, name).filter(
		f => hasExt(f, changed) && existsSync(join(dir, f))
	);
	return { files, code: files.filter(f => hasExt(f, code)) };
}

export function checkApplies(check, files) {
	return !check.paths || files.some(f => matchesAny(f, check.paths.map(normalizeTrigger)));
}
