import { relative, resolve } from 'node:path';

export const PARSER_NAMES = ['tsc', 'eslint-json', 'oxlint'];

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const TSC_PLAIN = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const TSC_PRETTY = /^(.+?):(\d+):(\d+) - error (TS\d+): (.*)$/;
const TSC_GLOBAL = /^error (TS\d+): (.*)$/;
const OXLINT_LINE = /^(.+?):(\d+):(\d+): (.*) \[(?:Warning|Error|Advice)(?:\/(.+))?\]$/;
const OXLINT_SUMMARY = /^\d+ problems?$/;
const NO_FILE = '-';

const squeeze = s => s.replace(/\s+/g, ' ').trim();
const unreadable = reason => ({ ok: false, reason });
const done = lines => ({ ok: true, lines: lines.map(squeeze) });

function unitPath(file, unitDir) {
	return unitDir ? relative(unitDir, resolve(unitDir, file)) : file;
}

function errorLine(tool, path, rule, message) {
	return `${tool}: ${path}: ${rule}: ${message}`;
}

function textLines(stdout) {
	return stdout.replace(ANSI, '').split(/\r?\n/);
}

function tsc(stdout, unitDir) {
	const lines = [];
	let other = false;
	for (const line of textLines(stdout)) {
		const file = line.match(TSC_PLAIN) ?? line.match(TSC_PRETTY);
		const global = !file && line.match(TSC_GLOBAL);
		if (file) lines.push(errorLine('tsc', unitPath(file[1], unitDir), file[4], file[5]));
		else if (global) lines.push(errorLine('tsc', NO_FILE, global[1], global[2]));
		else if (line.trim()) other = true;
	}
	if (other && lines.length === 0) return unreadable('no tsc diagnostics found in the output');
	return done(lines);
}

function eslintJson(stdout, unitDir) {
	const text = stdout.trim();
	if (!text) return unreadable('empty output (eslint -f json always prints an array)');
	let results;
	try {
		results = JSON.parse(text);
	} catch {
		const start = text.indexOf('[');
		try {
			results = JSON.parse(text.slice(start, text.lastIndexOf(']') + 1));
		} catch {
			return unreadable('output is not JSON (does the command use -f json?)');
		}
	}
	const valid =
		Array.isArray(results) &&
		results.every(r => typeof r?.filePath === 'string' && Array.isArray(r.messages));
	if (!valid) return unreadable('output is not an ESLint JSON result array');
	const lines = results.flatMap(r =>
		r.messages.map(m =>
			errorLine('eslint', unitPath(r.filePath, unitDir), m.ruleId ?? 'fatal', String(m.message))
		)
	);
	return done(lines);
}

function oxlint(stdout, unitDir) {
	const lines = [];
	for (const line of textLines(stdout)) {
		const text = line.trim();
		if (!text || OXLINT_SUMMARY.test(text)) continue;
		const m = text.match(OXLINT_LINE);
		if (!m) return unreadable(`unexpected oxlint line (does the command use -f unix?): ${text}`);
		lines.push(errorLine('oxlint', unitPath(m[1], unitDir), m[5] ?? 'fatal', m[4]));
	}
	return done(lines);
}

const PARSERS = { tsc, 'eslint-json': eslintJson, oxlint };

function parseLines(name, stdout, unitDir) {
	const parser = PARSERS[name];
	if (!parser) return unreadable(`unknown parser ${name}`);
	return parser(String(stdout ?? ''), unitDir);
}

export function parse(name, stdout, { unitDir } = {}) {
	const result = parseLines(name, stdout, unitDir);
	return result.ok ? { ok: true, errors: [...new Set(result.lines)].sort() } : result;
}

export function parseCounted(name, stdout, { unitDir } = {}) {
	const result = parseLines(name, stdout, unitDir);
	if (!result.ok) return result;
	const counts = new Map();
	for (const line of result.lines) counts.set(line, (counts.get(line) ?? 0) + 1);
	return { ok: true, errors: [...counts.keys()].sort(), counts };
}

export function compareCounts(current, baseline) {
	const caused = [];
	let preExisting = 0;
	for (const line of [...current.keys()].sort()) {
		const now = current.get(line);
		const before = baseline.get(line) ?? 0;
		preExisting += Math.min(now, before);
		if (now > before) caused.push(now - before > 1 ? `${line} (+${now - before})` : line);
	}
	return { caused, preExisting };
}

export function errorPath(line) {
	const start = line.indexOf(': ') + 2;
	return line.slice(start, line.indexOf(': ', start));
}

export function filterToFiles(errors, files) {
	const keep = new Set(files);
	return errors.filter(line => keep.has(errorPath(line)));
}
