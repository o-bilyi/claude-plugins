import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { git, hashObject, refExists } from './git.mjs';
import { entryPath, readDirty } from './touched.mjs';

const OUT_OF_SCOPE = /^#{1,6}\s.*\b(out of scope|non-goals?)\b/i;
const HEADING = /^#{1,6}\s/;
const BOLD_OUT_OF_SCOPE = /^\s*[-*]?\s*\*\*(out of scope|non-goals?)\b/i;
const BOLD_PART = /^\s*[-*]?\s*\*\*[^*]+\*\*/;

// A backticked token is a path when it ends in / or has a lowercase extension. Tokens such as
// `Array.isArray`, globs and URLs are not paths.
export function asPath(raw) {
	const token = raw.replace(/^\.\//, '').replace(/[:,;]$/, '');
	if (/[*?{}<>()]/.test(token) || /^[a-z]+:\/\//i.test(token)) return null;
	if (token.endsWith('/')) return token;
	return /(^|\/)[\w.-]*[\w-]\.[a-z0-9]+$/.test(token) ? token : null;
}

// Splits a plan into the parts that name the work and the "Out of scope" part. The out-of-scope part
// is a heading (`## Out of scope`) or a bold list item (`- **Out of scope:**`), up to the next part.
function planParts(text) {
	const parts = { work: [], outOfScope: [] };
	let current = 'work';
	for (const line of text.split('\n')) {
		if (HEADING.test(line)) current = OUT_OF_SCOPE.test(line) ? 'outOfScope' : 'work';
		else if (BOLD_PART.test(line)) current = BOLD_OUT_OF_SCOPE.test(line) ? 'outOfScope' : 'work';
		parts[current].push(line);
	}
	return { work: parts.work.join('\n'), outOfScope: parts.outOfScope.join('\n') };
}

function pathsIn(text) {
	const paths = new Set();
	for (const m of text.matchAll(/`([^`\s]+)`/g)) {
		const path = asPath(m[1]);
		if (path) paths.add(path);
	}
	return [...paths];
}

// The paths that the plan names for the work, and the paths that its "Out of scope" part names and
// the work does not.
export function planPaths(text) {
	const { work, outOfScope } = planParts(text);
	const paths = pathsIn(work);
	return { paths, forbidden: pathsIn(outOfScope).filter(p => !paths.includes(p)) };
}

// A touched project-relative file is in the plan when a plan path names it, names it relative to its
// repo (multi-repo plans), or is a directory that holds it.
export function inPlan(file, paths, repoPrefix = '') {
	const repoRel = repoPrefix && file.startsWith(repoPrefix) ? file.slice(repoPrefix.length) : file;
	return paths.some(p =>
		p.endsWith('/') ? file.startsWith(p) || repoRel.startsWith(p) : file === p || repoRel === p
	);
}

export const QUICK_LIMITS = { units: 1, files: 3 };

export function scope(model, touchedResult, text, { mode } = {}) {
	const { paths, forbidden: forbiddenPaths } = planPaths(text);
	const planned = [];
	const extra = [];
	const forbidden = [];
	for (const [key, repo] of Object.entries(touchedResult.repos)) {
		const prefix = key === '.' ? '' : `${key}/`;
		for (const file of repo.projectFiles) {
			if (inPlan(file, forbiddenPaths, prefix) && !inPlan(file, paths, prefix))
				forbidden.push(file);
			else if (paths.length === 0 || inPlan(file, paths, prefix)) planned.push(file);
			else extra.push(file);
		}
	}
	const result = {
		ok: extra.length === 0 && forbidden.length === 0,
		paths,
		planned,
		extra,
		forbidden,
	};
	if (mode === 'quick') {
		const units = touchedResult.units.length;
		const files = touchedResult.files.length;
		if (units > QUICK_LIMITS.units || files > QUICK_LIMITS.files) {
			result.quickExceeded = { units, files };
		}
	}
	return result;
}

export function renderScope(result) {
	const lines = [];
	if (result.paths.length === 0) lines.push('The plan names no file paths: scope not checked.');
	else {
		lines.push(`in the plan: ${result.planned.length} file(s)`);
		if (result.extra.length) lines.push('not in the plan:', ...result.extra.map(f => `  ${f}`));
	}
	if (result.forbidden.length) {
		lines.push('out of scope in the plan:', ...result.forbidden.map(f => `  ${f}`));
	}
	if (result.paths.length && result.ok) lines.push('Every touched file is in the plan.');
	if (result.quickExceeded) {
		const { units, files } = result.quickExceeded;
		lines.push(
			`MODE: full (quick limits exceeded: ${units} unit(s), ${files} file(s); the limit is ${QUICK_LIMITS.units} unit and ${QUICK_LIMITS.files} files)`
		);
	}
	return lines.join('\n');
}

function countLines(abs) {
	try {
		if (!statSync(abs).isFile()) return null;
		const buf = readFileSync(abs);
		if (buf.includes(0)) return null;
		const text = buf.toString('utf8');
		return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
	} catch {
		return null;
	}
}

function baseRef(repo) {
	const ref = refExists(repo.path, repo.baseBranch) ? repo.baseBranch : `origin/${repo.baseBranch}`;
	return git(repo.path, ['merge-base', ref, 'HEAD'])?.trim() || null;
}

// The content of each file that was dirty at the baseline save: path → blob, or '' when the file was
// absent. A file without a stored blob (a baseline from before 0.14.0) is left out, so it falls back
// to HEAD.
function dirtyBlobs(repo) {
	const blobs = new Map();
	for (const entry of readDirty(repo.state) ?? []) {
		const sha = entry.slice(0, entry.indexOf(' '));
		if (sha === 'deleted') blobs.set(entryPath(entry), '');
		else if (git(repo.path, ['cat-file', '-e', sha]) !== null) blobs.set(entryPath(entry), sha);
	}
	return blobs;
}

// Lines from the baseline blob to the file now. The empty blob stands for an absent file.
function blobStat(repo, file, from) {
	const empty = git(repo.path, ['hash-object', '-w', '--stdin'], { input: '' })?.trim();
	const to = existsSync(join(repo.path, file))
		? hashObject(repo.path, [file], { write: true })[0]
		: empty;
	const line = git(repo.path, ['diff', '--numstat', from || empty, to])?.split('\n')[0];
	if (!line) return null;
	const [added, deleted] = line.split('\t');
	return {
		added: added === '-' ? null : Number(added),
		deleted: deleted === '-' ? null : Number(deleted),
	};
}

// Added and deleted lines per touched file, against HEAD (or the merge base with --since-base). A file
// that was dirty at the baseline save counts from that content, so changes from before the task are
// left out.
export function diffstat(model, touchedResult, { sinceBase = false } = {}) {
	const files = [];
	for (const [key, result] of Object.entries(touchedResult.repos)) {
		const repo = model.repos[key];
		if (result.files.length === 0) continue;
		const dirty = sinceBase ? new Map() : dirtyBlobs(repo);
		const from = sinceBase ? (baseRef(repo) ?? 'HEAD') : 'HEAD';
		const hasHead = refExists(repo.path, 'HEAD');
		const out = hasHead
			? (git(repo.path, ['diff', '--numstat', '--no-renames', from, '--', ...result.files]) ?? '')
			: '';
		const stats = new Map();
		for (const line of out.split('\n').filter(Boolean)) {
			const [added, deleted, ...rest] = line.split('\t');
			stats.set(rest.join('\t'), {
				added: added === '-' ? null : Number(added),
				deleted: deleted === '-' ? null : Number(deleted),
			});
		}
		for (const file of result.files) {
			const abs = join(repo.path, file);
			let stat = dirty.has(file) ? blobStat(repo, file, dirty.get(file)) : stats.get(file);
			if (!stat && !dirty.has(file) && existsSync(abs))
				stat = { added: countLines(abs), deleted: 0 };
			if (!stat) continue;
			files.push({ file: relative(model.root, abs), ...stat });
		}
	}
	const sum = key => files.reduce((n, f) => n + (f[key] ?? 0), 0);
	return { files, added: sum('added'), deleted: sum('deleted') };
}

export function renderDiffstat(result) {
	const lines = result.files.map(f => {
		const a = f.added === null ? 'bin' : `+${f.added}`;
		const d = f.deleted === null ? '' : ` -${f.deleted}`;
		return `${a}${d}\t${f.file}`;
	});
	lines.push(`total: +${result.added} -${result.deleted} in ${result.files.length} file(s)`);
	return lines.join('\n');
}
