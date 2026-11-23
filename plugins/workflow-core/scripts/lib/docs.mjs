import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { git, gitList, refExists, toplevel } from './git.mjs';
import { matchesGlob } from './guards.mjs';
import { touched } from './touched.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const LIST_LIMIT = 5;

export function parseCodePaths(text) {
	const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!fm) return [];
	const lines = fm[1].split(/\r?\n/);
	const at = lines.findIndex(line => /^code_paths:/.test(line));
	if (at === -1) return [];
	const unquote = v => v.trim().replace(/^(['"])(.*)\1$/, '$2');
	const inline = lines[at].match(/^code_paths:\s*\[(.*)\]\s*$/);
	if (inline) return inline[1].split(',').map(unquote).filter(Boolean);
	const paths = [];
	for (const line of lines.slice(at + 1)) {
		const item = line.match(/^\s+-\s+(.+?)\s*(?:#.*)?$/);
		if (!item) break;
		paths.push(unquote(item[1]));
	}
	return paths;
}

function staticPrefix(glob) {
	const parts = glob.split('/');
	const fixed = [];
	for (const part of parts.slice(0, -1)) {
		if (/[*?]/.test(part)) break;
		fixed.push(part);
	}
	return fixed.join('/');
}

function walk(root, dir, out) {
	const abs = join(root, dir);
	if (!existsSync(abs)) return out;
	for (const entry of readdirSync(abs, { withFileTypes: true })) {
		const path = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name)) walk(root, path, out);
		} else out.push(path);
	}
	return out;
}

export function globFiles(root, glob) {
	return walk(root, staticPrefix(glob), []).filter(path => matchesGlob(path, glob));
}

function currentAreas(root, docs) {
	return new Map(
		globFiles(root, docs.areas).map(path => [
			path,
			parseCodePaths(readFileSync(join(root, path), 'utf8')),
		])
	);
}

function areasAt(root, docs, ref) {
	if (!ref) return null;
	const listed = git(root, [
		'ls-tree',
		'-r',
		'--name-only',
		ref,
		'--',
		staticPrefix(docs.areas) || '.',
	]);
	if (listed === null) return null;
	const areas = new Map();
	for (const path of listed.split('\n').filter(p => p && matchesGlob(p, docs.areas))) {
		areas.set(path, parseCodePaths(git(root, ['show', `${ref}:./${path}`]) ?? ''));
	}
	return areas;
}

const covers = (codePaths, file) => codePaths.some(glob => matchesGlob(file, glob));
const coveredBy = (areas, file) => [...areas.values()].some(paths => covers(paths, file));

export function isDocFile(docs, file) {
	return (
		matchesGlob(file, docs.areas) ||
		(docs.changes !== undefined && file.startsWith(`${docs.changes}/`)) ||
		file === docs.guide ||
		docs.ignore.some(glob => matchesGlob(file, glob))
	);
}

function changeFolders(root, docs, files) {
	if (docs.changes === undefined) return [];
	const slugs = new Set(
		files
			.filter(f => f.startsWith(`${docs.changes}/`))
			.map(f => f.slice(docs.changes.length + 1).split('/')[0])
			.filter(slug => slug && !slug.includes('.'))
	);
	return [...slugs].map(slug => {
		const dir = `${docs.changes}/${slug}`;
		const missing = docs.newChange.filter(glob => globFiles(root, `${dir}/${glob}`).length === 0);
		return { dir, missing };
	});
}

// Pure: decides what the change still needs, from the changed files and the area docs now and before.
export function evaluateDocs(docs, { files, current, before, folders }) {
	const changed = new Set(files);
	const relevant = files.filter(f => !isDocFile(docs, f));

	const stale = [];
	for (const [area, codePaths] of current) {
		const hit = relevant.filter(f => covers(codePaths, f));
		if (hit.length && !changed.has(area)) stale.push({ area, files: hit });
	}
	const uncovered = docs.requireCoverage ? relevant.filter(f => !coveredBy(current, f)) : [];
	const scopeFiles =
		before === null ? [] : relevant.filter(f => coveredBy(current, f) && !coveredBy(before, f));
	const complete = folders.find(folder => folder.missing.length === 0) ?? null;
	const newScope = {
		files: scopeFiles,
		needsChange: scopeFiles.length > 0 && docs.changes !== undefined && complete === null,
		folders,
	};

	const ok = stale.length === 0 && uncovered.length === 0 && !newScope.needsChange;
	return { checked: relevant.length, stale, uncovered, newScope, ok };
}

function projectFiles(model, repoFiles) {
	return repoFiles.flatMap(([repo, files]) => files.map(f => relative(model.root, join(repo, f))));
}

function repoPaths(model) {
	const paths = Object.values(model.repos).map(repo => repo.path);
	const rootRepo = toplevel(model.root);
	if (rootRepo && !paths.includes(rootRepo)) paths.push(rootRepo);
	return paths;
}

export function stagedFiles(model, { all = false } = {}) {
	return projectFiles(
		model,
		repoPaths(model).map(path => {
			const staged = gitList(path, ['diff', '--cached', '--name-only']);
			const tracked = all ? gitList(path, ['diff', '--name-only']) : [];
			return [path, [...new Set([...staged, ...tracked])]];
		})
	);
}

function rootBase(model) {
	const rootRepo = toplevel(model.root);
	const repo = Object.values(model.repos).find(r => r.path === rootRepo);
	if (!rootRepo || !repo) return null;
	const base = refExists(rootRepo, repo.baseBranch) ? repo.baseBranch : `origin/${repo.baseBranch}`;
	return git(rootRepo, ['merge-base', 'HEAD', base])?.trim() || null;
}

export function branchSkip(model, trailer) {
	const ref = rootBase(model);
	if (!ref) return null;
	const log = git(model.root, ['log', '--format=%B', `${ref}..HEAD`]) ?? '';
	return skipReason(log, trailer);
}

export function skipReason(text, trailer) {
	const m = text.match(new RegExp(`(?:^|[\\n"'\\s])${trailer}:[ \\t]*([^\\n"']+)`));
	return m ? m[1].trim() || trailer : null;
}

// staged: the files of the commit about to be made; otherwise the branch since its base plus the
// working tree. `skip` is a reason taken from the commit message, when the caller has one.
export function checkDocs(model, docs, { staged = false, all = false, skip = null } = {}) {
	const files = staged ? stagedFiles(model, { all }) : touched(model, { sinceBase: true }).files;
	const reason = skip ?? (staged ? null : branchSkip(model, docs.skipTrailer));
	const ref = staged ? (refExists(model.root, 'HEAD') ? 'HEAD' : null) : rootBase(model);
	const result = evaluateDocs(docs, {
		files,
		current: currentAreas(model.root, docs),
		before: areasAt(model.root, docs, ref),
		folders: changeFolders(model.root, docs, files),
	});
	return {
		mode: docs.mode,
		enforceAt: docs.enforceAt,
		scope: staged ? 'commit' : 'branch',
		skipped: reason,
		...result,
		ok: reason !== null || result.ok,
	};
}

function sample(files) {
	const shown = files.slice(0, LIST_LIMIT).join(', ');
	return files.length > LIST_LIMIT ? `${shown} (+${files.length - LIST_LIMIT} more)` : shown;
}

export function renderDocs(report, docs) {
	if (report.skipped) return `Docs: skipped (${docs.skipTrailer}: ${report.skipped})`;
	if (report.checked === 0) return 'Docs: no changed code to document';
	if (report.ok) return `Docs: up to date (${report.checked} changed file(s) checked)`;
	const lines = [`Docs: not up to date for this ${report.scope} (mode ${report.mode})`];
	for (const { area, files } of report.stale) {
		lines.push(`- ${area} covers changed files but was not updated: ${sample(files)}`);
	}
	if (report.uncovered.length) {
		lines.push(
			`- Not covered by any area doc (add them to an area's code_paths, or start a new area): ${sample(report.uncovered)}`
		);
	}
	if (report.newScope.needsChange) {
		const wants = docs.newChange.join(', ');
		const partial = report.newScope.folders.filter(f => f.missing.length);
		const detail = partial.length
			? ` Missing: ${partial.map(f => `${f.dir}/{${f.missing.join(', ')}}`).join('; ')}.`
			: '';
		lines.push(
			`- New scope (no area covered these files before): ${sample(report.newScope.files)}. Record the change in ${docs.changes}/<slug>/ with ${wants}.${detail}`
		);
	}
	lines.push(
		`Update them with /workflow-core:docs, or put "${docs.skipTrailer}: <reason>" in the commit message when no doc change is needed.`
	);
	return lines.join('\n');
}
