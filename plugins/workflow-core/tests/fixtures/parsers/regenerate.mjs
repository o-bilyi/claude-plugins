#!/usr/bin/env node
// Usage: node regenerate.mjs tsc=<bin> eslint=<bin> oxlint=<bin> ...
// Runs each binary on synthetic sources in a temp dir and writes <tool>-<version>/ next to this file.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLACEHOLDER = '__UNIT__';

const TSCONFIG = {
	compilerOptions: {
		strict: true,
		noEmit: true,
		target: 'es2022',
		module: 'esnext',
		moduleResolution: 'bundler',
		skipLibCheck: true,
		types: [],
	},
	include: ['src'],
};

const SOURCES = {
	tsc: {
		'tsconfig.json': `${JSON.stringify(TSCONFIG, null, 2)}\n`,
		'src/a.ts': [
			"export const count: number = 'one';",
			"export const again: number = 'one';",
			'missingFn();',
			'',
		].join('\n'),
		'src/nested/deep/b.ts': [
			"interface Options { mode: { kind: 'a' | 'b' } }",
			"const raw = { mode: { kind: 'c' } };",
			'export const options: Options = raw;',
			'',
		].join('\n'),
		'src/ok.ts': 'export const fine = 1;\n',
	},
	eslint: {
		'src/a.js': ['var unused = 1;', 'debugger;', ''].join('\n'),
		'src/nested/b.js': ['function f(x) {', '  var y = 2;', '  return 1;', '}', 'f();', ''].join(
			'\n'
		),
		'src/broken.js': 'var a = (;\n',
		'src/ok.js': 'var fine = 1;\nconsole.log(fine);\n',
	},
	oxlint: {
		'src/a.js': ['const unused = 1;', 'debugger;', ''].join('\n'),
		'src/nested/b.js': ['export function f(x) {', '  const y = 2;', '  return 1;', '}', ''].join(
			'\n'
		),
		'src/broken.js': 'const a = (;\n',
		'src/ok.js': 'export const fine = 1;\n',
	},
};

const ESLINT_RULES = '{"no-unused-vars":"error","no-debugger":"error"}';

function cases(tool, major) {
	if (tool === 'tsc') {
		return {
			default: ['--noEmit', '-p', 'tsconfig.json'],
			pretty: ['--noEmit', '-p', 'tsconfig.json', '--pretty'],
			plain: ['--noEmit', '-p', 'tsconfig.json', '--pretty', 'false'],
			global: ['--noEmit', 'src/ok.ts'],
			clean: ['--noEmit', '--ignoreConfig', 'src/ok.ts'],
		};
	}
	if (tool === 'eslint') {
		const noConfig = major >= 9 ? '--no-config-lookup' : '--no-eslintrc';
		return {
			default: [noConfig, '--rule', ESLINT_RULES, '-f', 'json', 'src'],
			clean: [noConfig, '--rule', ESLINT_RULES, '-f', 'json', 'src/ok.js'],
		};
	}
	return {
		default: ['-f', 'unix', 'src'],
		'deny-warnings': ['-f', 'unix', '--deny-warnings', 'src'],
		'deny-debugger': ['-f', 'unix', '-D', 'no-debugger', 'src'],
		clean: ['-f', 'unix', 'src/ok.js'],
	};
}

function version(bin) {
	const out = spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout;
	return out.match(/\d+\.\d+\.\d+/)[0];
}

function writeSources(dir, files, shift) {
	for (const [path, content] of Object.entries(files)) {
		const file = join(dir, path);
		mkdirSync(dirname(file), { recursive: true });
		const shifted = shift && !path.endsWith('.json') ? `\n// shifted\n${content}` : content;
		writeFileSync(file, shifted);
	}
}

function capture(tool, bin) {
	const v = version(bin);
	const out = join(HERE, `${tool}-${v}`);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	const meta = {};
	for (const shift of [false, true]) {
		const dir = mkdtempSync(join(tmpdir(), 'wc-parser-'));
		const real = realpathSync(dir);
		writeSources(dir, SOURCES[tool], shift);
		for (const [name, args] of Object.entries(cases(tool, Number(v.split('.')[0])))) {
			const variant = shift ? `${name}-shifted` : name;
			const r = spawnSync(bin, args, {
				cwd: dir,
				encoding: 'utf8',
				env: { ...process.env, FORCE_COLOR: '0' },
			});
			const stdout = r.stdout.replaceAll(real, PLACEHOLDER).replaceAll(dir, PLACEHOLDER);
			writeFileSync(join(out, `${variant}.stdout`), stdout);
			meta[variant] = { args, exitCode: r.status };
		}
		rmSync(dir, { recursive: true, force: true });
	}
	writeFileSync(
		join(out, 'cases.json'),
		`${JSON.stringify({ version: v, cases: meta }, null, '\t')}\n`
	);
	console.log(`${tool} ${v} -> ${out}`);
}

for (const arg of process.argv.slice(2)) {
	const [tool, bin] = arg.split('=');
	if (!SOURCES[tool] || !bin) {
		console.error('usage: node regenerate.mjs tsc=<bin> eslint=<bin> oxlint=<bin> ...');
		process.exit(1);
	}
	capture(tool, bin);
}
