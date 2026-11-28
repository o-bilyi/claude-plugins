import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export function git(cwd, args, { input } = {}) {
	try {
		return execFileSync('git', args, {
			cwd,
			input,
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
			stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'],
		});
	} catch {
		return null;
	}
}

export function gitList(cwd, args) {
	return (git(cwd, [...args, '-z']) ?? '').split('\0').filter(Boolean);
}

export function toplevel(dir) {
	const out = git(dir, ['rev-parse', '--show-toplevel'])?.trim();
	if (!out) return null;
	try {
		return realpathSync(out);
	} catch {
		return null;
	}
}

export function gitPath(repo, name) {
	const out = git(repo, ['rev-parse', '--git-path', name])?.trim();
	return out ? resolve(repo, out) : null;
}

export function refExists(repo, ref) {
	return Boolean(git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])?.trim());
}

// `write`: also store the blobs in the object database, so that a later diff can read them.
export function hashObject(repo, files, { write = false } = {}) {
	if (files.length === 0) return [];
	const flags = write ? ['-w'] : [];
	const out = git(repo, ['hash-object', ...flags, '--stdin-paths'], {
		input: `${files.join('\n')}\n`,
	});
	const hashes = (out ?? '').split('\n').filter(Boolean);
	if (hashes.length === files.length) return hashes;
	return files.map(file => git(repo, ['hash-object', ...flags, '--', file])?.trim() || null);
}
