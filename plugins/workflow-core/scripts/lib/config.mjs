import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toplevel } from './git.mjs';
import { PARSER_NAMES } from './parsers.mjs';

export const CONFIG_PATH = '.claude/workflow.config.json';
export const MISSING_MESSAGE = `No ${CONFIG_PATH} found. Run /workflow-core:init to create one.`;
export const DEFAULT_CHANGED_EXTENSIONS = [
	'ts',
	'tsx',
	'mts',
	'cts',
	'js',
	'jsx',
	'mjs',
	'cjs',
	'json',
];
export const DEFAULT_CODE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];
export const KINDS = ['typecheck', 'lint', 'test', 'other'];
const RUN_FROM = ['root', 'repo', 'unit'];
const WHOLE_REPO_TRIGGERS = ['', '.', './'];

export class ConfigError extends Error {}
export class UnsupportedVersionError extends ConfigError {}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = v => typeof v === 'string';
const isNonEmptyString = v => isString(v) && v.trim() !== '';
const isStringArray = v => Array.isArray(v) && v.every(isString);
const isNonEmptyStringArray = v => isStringArray(v) && v.length > 0;
const isBoolean = v => typeof v === 'boolean';
const optional = (v, predicate) => v === undefined || predicate(v);

export const normalizeTrigger = t => (WHOLE_REPO_TRIGGERS.includes(t) ? '' : t);

export function normalizeDir(dir) {
	const d = dir.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
	return d === '' ? '.' : d;
}

function compact(obj) {
	return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function deepFreeze(value) {
	if (value && typeof value === 'object') {
		Object.values(value).forEach(deepFreeze);
		Object.freeze(value);
	}
	return value;
}

function validRegex(source, flags) {
	try {
		void new RegExp(source, flags);
		return true;
	} catch {
		return false;
	}
}

function collector() {
	const errors = [];
	const check = (ok, message) => {
		if (!ok) errors.push(message);
		return ok;
	};
	const fail = () => {
		if (errors.length) {
			throw new ConfigError(`${CONFIG_PATH} is invalid:\n${errors.map(e => `- ${e}`).join('\n')}`);
		}
	};
	return { errors, check, fail };
}

export function findRoot() {
	return process.env.CLAUDE_PROJECT_DIR || toplevel(process.cwd()) || process.cwd();
}

export function readRawConfig(root) {
	const file = join(root, CONFIG_PATH);
	if (!existsSync(file)) return null;
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		throw new ConfigError(`${CONFIG_PATH} is not valid JSON: ${err.message}`);
	}
}

function validatePr(pr, check) {
	check(isObject(pr), 'pr must be an object');
	check(
		isString(pr?.titleFormat) && pr.titleFormat.includes('{summary}'),
		'pr.titleFormat must be a string containing {summary}'
	);
	const needsTicket = isString(pr?.titleFormat) && pr.titleFormat.includes('{ticket}');
	const validTicketPattern = v => isNonEmptyString(v) && validRegex(v, 'i');
	check(
		needsTicket
			? validTicketPattern(pr?.ticketPattern)
			: optional(pr?.ticketPattern, validTicketPattern),
		'pr.ticketPattern must be a valid regular expression string (required when pr.titleFormat contains {ticket})'
	);
	check(optional(pr?.titleExample, isString), 'pr.titleExample must be a string');
	return compact({
		titleFormat: pr?.titleFormat,
		ticketPattern: pr?.ticketPattern,
		titleExample: pr?.titleExample,
	});
}

function validateReviewers(reviewers, check) {
	check(
		Array.isArray(reviewers) &&
			reviewers.every(r => isObject(r) && isNonEmptyString(r.agent) && isStringArray(r.paths)),
		'reviewers must be an array of {agent: string, paths: string[]}'
	);
	return Array.isArray(reviewers) ? reviewers : [];
}

function validatePlanner(planner, check) {
	check(
		isObject(planner) && optional(planner.extraChecklist, isStringArray),
		'planner must be an object with optional extraChecklist (string[])'
	);
	return { extraChecklist: planner?.extraChecklist ?? [] };
}

function validateFormat(f, at, check) {
	const ok = check(
		isObject(f) &&
			isNonEmptyString(f.command) &&
			isStringArray(f.extensions) &&
			optional(f.runFrom, v => RUN_FROM.includes(v)),
		`${at} must have command (string), extensions (string[]) and optional runFrom (root | repo | unit)`
	);
	return ok
		? { command: f.command, extensions: f.extensions, runFrom: f.runFrom ?? 'root' }
		: undefined;
}

function validateCheck(c, at, check) {
	if (!check(isObject(c), `${at} must be an object`)) return null;
	check(KINDS.includes(c.kind), `${at}.kind must be one of ${KINDS.join(', ')}`);
	check(optional(c.name, isNonEmptyString), `${at}.name must be a non-empty string`);
	check(isNonEmptyString(c.run), `${at}.run must be a non-empty string`);
	check(optional(c.changed, isNonEmptyString), `${at}.changed must be a non-empty string`);
	for (const key of ['related', 'fullWhen']) {
		check(c[key] === undefined || c.kind === 'test', `${at}.${key} is only allowed on test checks`);
	}
	check(optional(c.related, isNonEmptyString), `${at}.related must be a non-empty string`);
	check(optional(c.fullWhen, isStringArray), `${at}.fullWhen must be an array of strings`);
	check(
		optional(c.parser, v => PARSER_NAMES.includes(v)),
		`${at}.parser must be one of ${PARSER_NAMES.join(', ')}`
	);
	check(optional(c.stopHook, isBoolean), `${at}.stopHook must be a boolean`);
	return compact({
		name: c.name ?? c.kind,
		kind: c.kind,
		run: c.run,
		changed: c.changed,
		related: c.related,
		fullWhen: c.fullWhen,
		parser: c.parser,
		stopHook: c.stopHook ?? c.kind !== 'other',
	});
}

function validateUnit(name, u, check) {
	const at = `units.${name}`;
	if (!check(isObject(u), `${at} must be an object`)) return null;
	check(isNonEmptyString(u.dir), `${at}.dir must be a non-empty string`);
	const dir = isNonEmptyString(u.dir) ? normalizeDir(u.dir) : '.';
	const triggers = u.triggers ?? [dir === '.' ? '' : `${dir}/`];
	check(isNonEmptyStringArray(triggers), `${at}.triggers must be a non-empty array of strings`);
	check(optional(u.stopHook, isBoolean), `${at}.stopHook must be a boolean`);
	check(optional(u.notes, isString), `${at}.notes must be a string`);
	const format =
		u.format === undefined ? undefined : validateFormat(u.format, `${at}.format`, check);

	const checks = [];
	if (check(optional(u.checks, Array.isArray), `${at}.checks must be an array`)) {
		const names = new Set();
		(u.checks ?? []).forEach((c, i) => {
			const normalized = validateCheck(c, `${at}.checks[${i}]`, check);
			if (!normalized) return;
			check(!names.has(normalized.name), `${at}.checks: duplicate check name "${normalized.name}"`);
			names.add(normalized.name);
			checks.push(normalized);
		});
	}

	return compact({
		dir,
		triggers: isStringArray(triggers) ? triggers.map(normalizeTrigger) : [],
		checks,
		stopHook: u.stopHook ?? true,
		notes: u.notes,
		format,
	});
}

function validateGuards(g, check) {
	if (!check(isObject(g), 'guards must be an object')) {
		return { protectedPaths: [], blockedCommands: [] };
	}
	const protectedPaths = g.protectedPaths ?? [];
	const blockedCommands = g.blockedCommands ?? [];
	if (check(Array.isArray(protectedPaths), 'guards.protectedPaths must be an array')) {
		protectedPaths.forEach((p, i) =>
			check(
				isObject(p) &&
					isNonEmptyString(p.glob) &&
					optional(p.when, v => v === 'tracked') &&
					isNonEmptyString(p.message),
				`guards.protectedPaths[${i}] must be {glob: string, when?: "tracked", message: string}`
			)
		);
	}
	if (check(Array.isArray(blockedCommands), 'guards.blockedCommands must be an array')) {
		blockedCommands.forEach((b, i) => {
			const at = `guards.blockedCommands[${i}]`;
			const ok = check(
				isObject(b) &&
					isNonEmptyString(b.regex) &&
					optional(b.cwd, isString) &&
					isNonEmptyString(b.message),
				`${at} must be {regex: string, cwd?: string, message: string}`
			);
			if (ok) check(validRegex(b.regex), `${at}.regex is not a valid regular expression`);
		});
	}
	return {
		protectedPaths: Array.isArray(protectedPaths) ? protectedPaths : [],
		blockedCommands: Array.isArray(blockedCommands) ? blockedCommands : [],
	};
}

function validateProcess(p, check) {
	if (!check(isObject(p), 'process must be an object')) p = {};
	const maxRounds = p.maxRounds ?? 3;
	check(
		Number.isInteger(maxRounds) && maxRounds > 0,
		'process.maxRounds must be a positive integer'
	);
	let preflight = p.preflight ?? {};
	if (!check(isObject(preflight), 'process.preflight must be an object')) preflight = {};
	const branchTicket = preflight.branchTicket ?? true;
	check(isBoolean(branchTicket), 'process.preflight.branchTicket must be a boolean');
	const baseline = preflight.baseline ?? 'auto';
	check(['auto', 'off'].includes(baseline), 'process.preflight.baseline must be "auto" or "off"');
	return { maxRounds, preflight: { branchTicket, baseline } };
}

const DOCS_MODES = ['warn', 'require'];
const DOCS_ENFORCE_AT = ['commit', 'pr'];

function validateDocs(d, check) {
	if (!check(isObject(d), 'docs must be an object')) return undefined;
	check(isNonEmptyString(d.areas), 'docs.areas must be a glob string (e.g. "docs/areas/*.md")');
	check(
		optional(d.mode, v => DOCS_MODES.includes(v)),
		`docs.mode must be one of ${DOCS_MODES.join(', ')}`
	);
	check(
		optional(d.enforceAt, v => DOCS_ENFORCE_AT.includes(v)),
		`docs.enforceAt must be one of ${DOCS_ENFORCE_AT.join(', ')}`
	);
	check(optional(d.changes, isNonEmptyString), 'docs.changes must be a non-empty string');
	check(
		optional(d.newChange, isNonEmptyStringArray),
		'docs.newChange must be a non-empty array of glob strings'
	);
	check(
		d.newChange === undefined || d.changes !== undefined,
		'docs.newChange requires docs.changes'
	);
	check(optional(d.ignore, isStringArray), 'docs.ignore must be an array of glob strings');
	check(optional(d.guide, isNonEmptyString), 'docs.guide must be a non-empty string');
	check(optional(d.requireCoverage, isBoolean), 'docs.requireCoverage must be a boolean');
	check(
		optional(d.skipTrailer, v => isNonEmptyString(v) && /^[A-Za-z][\w-]*$/.test(v)),
		'docs.skipTrailer must be a trailer name like "Docs-Skip"'
	);
	const dir = v => (isNonEmptyString(v) ? normalizeDir(v) : undefined);
	return compact({
		mode: d.mode ?? 'warn',
		enforceAt: d.enforceAt ?? 'pr',
		areas: d.areas,
		changes: dir(d.changes),
		newChange: d.changes === undefined ? undefined : (d.newChange ?? ['README.md']),
		ignore: d.ignore ?? [],
		guide: d.guide,
		requireCoverage: d.requireCoverage ?? true,
		skipTrailer: d.skipTrailer ?? 'Docs-Skip',
	});
}

const WRITING_STYLES = ['plain', 'ste100'];

function validateWriting(w, check) {
	if (!check(isObject(w), 'writing must be an object')) return undefined;
	check(
		optional(w.style, v => WRITING_STYLES.includes(v)),
		`writing.style must be one of ${WRITING_STYLES.join(', ')}`
	);
	check(optional(w.guide, isNonEmptyString), 'writing.guide must be a non-empty string');
	return compact({ style: w.style ?? 'plain', guide: w.guide });
}

export function normalizeConfig(raw) {
	if (!isObject(raw)) {
		throw new ConfigError(`${CONFIG_PATH} is invalid:\n- top level must be a JSON object`);
	}
	if (raw.version !== 1) {
		throw new UnsupportedVersionError(
			`${CONFIG_PATH}: unsupported config version; run /workflow-core:init.`
		);
	}
	const { check, fail } = collector();

	check(optional(raw.baseBranch, isNonEmptyString), 'baseBranch must be a non-empty string');
	check(optional(raw.prTarget, isNonEmptyString), 'prTarget must be a non-empty string');
	const pr = validatePr(raw.pr ?? { titleFormat: '{summary}' }, check);
	const format = raw.format === undefined ? undefined : validateFormat(raw.format, 'format', check);

	const repos = {};
	if (check(optional(raw.repos, isObject), 'repos must be an object')) {
		for (const [key, r] of Object.entries(raw.repos ?? {})) {
			const at = `repos.${key}`;
			if (!check(isObject(r), `${at} must be an object`)) continue;
			check(
				optional(r.baseBranch, isNonEmptyString),
				`${at}.baseBranch must be a non-empty string`
			);
			check(optional(r.prTarget, isNonEmptyString), `${at}.prTarget must be a non-empty string`);
			repos[normalizeDir(key)] = compact({
				baseBranch: r.baseBranch,
				prTarget: r.prTarget,
				format:
					r.format === undefined ? undefined : validateFormat(r.format, `${at}.format`, check),
			});
		}
	}

	const extensions = raw.extensions ?? {};
	check(isObject(extensions), 'extensions must be an object');
	const changed = extensions.changed ?? DEFAULT_CHANGED_EXTENSIONS;
	const code = extensions.code ?? DEFAULT_CODE_EXTENSIONS;
	check(isStringArray(changed), 'extensions.changed must be an array of strings');
	check(isStringArray(code), 'extensions.code must be an array of strings');

	check(raw.app === undefined || raw.units === undefined, 'use either app or units, not both');
	let rawUnits = raw.units ?? {};
	if (raw.app !== undefined)
		rawUnits = { app: isObject(raw.app) ? { dir: '.', ...raw.app } : raw.app };
	const units = {};
	if (check(isObject(rawUnits), 'units must be an object')) {
		for (const [name, u] of Object.entries(rawUnits)) {
			const unit = validateUnit(name, u, check);
			if (unit) units[name] = unit;
		}
	}

	const processConfig = validateProcess(raw.process ?? {}, check);
	const reviewers = validateReviewers(raw.reviewers ?? [], check);
	const planner = validatePlanner(raw.planner ?? {}, check);
	const guards = validateGuards(raw.guards ?? {}, check);
	const docs = raw.docs === undefined ? undefined : validateDocs(raw.docs, check);
	const writing = raw.writing === undefined ? undefined : validateWriting(raw.writing, check);

	fail();

	return deepFreeze(
		compact({
			configVersion: 1,
			baseBranch: raw.baseBranch,
			prTarget: raw.prTarget,
			pr,
			repos,
			units,
			format,
			extensions: { changed, code },
			process: processConfig,
			reviewers,
			planner,
			guards,
			docs,
			writing,
		})
	);
}

export function loadConfig(root) {
	const raw = readRawConfig(root);
	return raw === null ? null : normalizeConfig(raw);
}

export function getValue(config, path) {
	return path
		.split('.')
		.reduce((node, key) => (isObject(node) || Array.isArray(node) ? node[key] : undefined), config);
}
