import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const DIR = 'sessions';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const safeId = id => (typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null);
const sessionFile = (repo, id) => join(repo.state, DIR, id);
const isInside = rel =>
	rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);

function realFile(file) {
	if (existsSync(file)) return realpathSync(file);
	const dir = dirname(file);
	return existsSync(dir) ? join(realpathSync(dir), basename(file)) : file;
}

function repoFor(model, abs) {
	let best = null;
	for (const repo of Object.values(model.repos)) {
		if (!repo.state || !isInside(relative(repo.path, abs))) continue;
		if (!best || repo.path.length > best.path.length) best = repo;
	}
	return best;
}

function prune(dir, now) {
	for (const name of readdirSync(dir)) {
		const file = join(dir, name);
		try {
			if (now - statSync(file).mtimeMs > MAX_AGE_MS) rmSync(file, { force: true });
		} catch {
			// Another session may have removed it.
		}
	}
}

// Records that session `id` edited `file`, as a path relative to the file's repo.
export function recordEdit(model, id, file, now = Date.now()) {
	const sid = safeId(id);
	if (!sid || typeof file !== 'string' || file === '') return null;
	const abs = realFile(resolve(model.root, file));
	const repo = repoFor(model, abs);
	if (!repo) return null;
	const rel = relative(repo.path, abs).split(sep).join('/');
	const dir = join(repo.state, DIR);
	mkdirSync(dir, { recursive: true });
	prune(dir, now);
	const target = sessionFile(repo, sid);
	const known = existsSync(target) ? readFileSync(target, 'utf8').split('\n') : [];
	if (!known.includes(rel)) appendFileSync(target, `${rel}\n`);
	return { repo: repo.key, path: rel };
}

// Map of repo key → Set of repo-relative paths session `id` edited; null when it edited nothing.
export function sessionFiles(model, id) {
	const sid = safeId(id);
	if (!sid) return null;
	const result = {};
	let any = false;
	for (const [key, repo] of Object.entries(model.repos)) {
		const file = repo.state && sessionFile(repo, sid);
		const paths =
			file && existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
		result[key] = new Set(paths);
		any ||= paths.length > 0;
	}
	return any ? result : null;
}
