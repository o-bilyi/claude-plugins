import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { errorPath, filterToFiles, parse } from '../scripts/lib/parsers.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/parsers/', import.meta.url));
const UNIT = '/work/unit';
const PARSER = { tsc: 'tsc', eslint: 'eslint-json', oxlint: 'oxlint' };

const EXPECTED = {
	tsc: {
		errors: [
			"tsc: src/a.ts: TS2304: Cannot find name 'missingFn'.",
			"tsc: src/a.ts: TS2322: Type 'string' is not assignable to type 'number'.",
			"tsc: src/nested/deep/b.ts: TS2322: Type '{ mode: { kind: string; }; }' is not assignable to type 'Options'.",
		],
		global: [
			"tsc: -: TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig' to skip this error.",
		],
	},
	eslint: {
		errors: [
			"eslint: src/a.js: no-debugger: Unexpected 'debugger' statement.",
			"eslint: src/a.js: no-unused-vars: 'unused' is assigned a value but never used.",
			'eslint: src/broken.js: fatal: Parsing error: Unexpected token ;',
			"eslint: src/nested/b.js: no-unused-vars: 'x' is defined but never used.",
			"eslint: src/nested/b.js: no-unused-vars: 'y' is assigned a value but never used.",
		],
	},
	oxlint: {
		errors: [
			'oxlint: src/a.js: eslint(no-debugger): `debugger` statement is not allowed',
			"oxlint: src/a.js: eslint(no-unused-vars): Variable 'unused' is declared but never used. Unused variables should start with a '_'.",
			'oxlint: src/broken.js: fatal: Unexpected token',
			"oxlint: src/nested/b.js: eslint(no-unused-vars): Parameter 'x' is declared but never used. Unused parameters should start with a '_'.",
			"oxlint: src/nested/b.js: eslint(no-unused-vars): Variable 'y' is declared but never used. Unused variables should start with a '_'.",
		],
	},
};

function expected(tool, variant) {
	const name = variant.replace(/-shifted$/, '');
	if (name === 'clean') return [];
	return EXPECTED[tool][name] ?? EXPECTED[tool].errors;
}

const fixtureDirs = readdirSync(FIXTURES, { withFileTypes: true })
	.filter(d => d.isDirectory())
	.map(d => d.name);

describe('parsers on real tool output', () => {
	test('fixtures exist for every parser', () => {
		for (const tool of Object.keys(PARSER)) {
			assert.ok(
				fixtureDirs.some(d => d.startsWith(`${tool}-`)),
				`no fixture for ${tool}`
			);
		}
	});

	for (const dir of fixtureDirs) {
		const tool = dir.split('-')[0];
		const { cases } = JSON.parse(readFileSync(join(FIXTURES, dir, 'cases.json'), 'utf8'));
		for (const variant of Object.keys(cases)) {
			test(`${dir} ${variant}`, () => {
				const stdout = readFileSync(join(FIXTURES, dir, `${variant}.stdout`), 'utf8');
				const result = parse(PARSER[tool], stdout.replaceAll('__UNIT__', UNIT), {
					unitDir: UNIT,
				});
				assert.deepEqual(result, { ok: true, errors: expected(tool, variant) });
			});
		}
	}
});

describe('error identity', () => {
	test('moving an error to another line or column gives the same line', () => {
		const a = parse('tsc', "src/a.ts(1,14): error TS2322: Type 'string' is wrong.\n");
		const b = parse('tsc', "src/a.ts(7,3): error TS2322: Type 'string' is wrong.\n");
		assert.deepEqual(a, b);
		const c = parse('oxlint', 'src/a.js:1:1: Bad [Error/eslint(x)]\n');
		const d = parse('oxlint', 'src/a.js:9:4: Bad [Warning/eslint(x)]\n');
		assert.deepEqual(c, d);
	});

	test('whitespace is squeezed and duplicates removed', () => {
		const out = 'src/a.ts(1,1): error TS1:  two   spaces\nsrc/a.ts(2,1): error TS1: two spaces\n';
		assert.deepEqual(parse('tsc', out).errors, ['tsc: src/a.ts: TS1: two spaces']);
	});

	test('only the first line of a multi-line tsc message is kept', () => {
		const out = 'src/a.ts(1,1): error TS2322: First.\n  Second line.\n    Third.\n';
		assert.deepEqual(parse('tsc', out).errors, ['tsc: src/a.ts: TS2322: First.']);
	});

	test('paths with parentheses and absolute paths become unit-relative', () => {
		const out = [
			'app/(group)/page.tsx(3,4): error TS2304: Cannot find name x.',
			'/work/unit/lib/b.ts(1,1): error TS2304: Cannot find name y.',
			'../shared/c.ts(1,1): error TS2304: Cannot find name z.',
		].join('\n');
		assert.deepEqual(parse('tsc', out, { unitDir: UNIT }).errors, [
			'tsc: ../shared/c.ts: TS2304: Cannot find name z.',
			'tsc: app/(group)/page.tsx: TS2304: Cannot find name x.',
			'tsc: lib/b.ts: TS2304: Cannot find name y.',
		]);
	});

	test('errors are sorted by code unit order', () => {
		const out = 'b.ts(1,1): error TS1: x\nB.ts(1,1): error TS1: x\na.ts(1,1): error TS1: x\n';
		assert.deepEqual(parse('tsc', out).errors.map(errorPath), ['B.ts', 'a.ts', 'b.ts']);
	});
});

describe('unreadable output', () => {
	test('tsc output without diagnostics', () => {
		const r = parse('tsc', 'Segmentation fault\n    at something\n');
		assert.equal(r.ok, false);
		assert.match(r.reason, /no tsc diagnostics/);
		assert.deepEqual(parse('tsc', ''), { ok: true, errors: [] });
	});

	test('eslint output that is not a JSON result array', () => {
		assert.equal(parse('eslint-json', 'src/a.js:1:1: error').ok, false);
		assert.equal(parse('eslint-json', '').ok, false);
		assert.equal(parse('eslint-json', '{"a":1}').ok, false);
		assert.deepEqual(parse('eslint-json', '[]'), { ok: true, errors: [] });
	});

	test('eslint JSON after a stray line still parses', () => {
		const out =
			'Warning: something\n[{"filePath":"a.js","messages":[{"ruleId":"r","message":"m"}]}]\n';
		assert.deepEqual(parse('eslint-json', out).errors, ['eslint: a.js: r: m']);
	});

	test('oxlint output in another format', () => {
		const r = parse('oxlint', '  ! eslint(no-debugger): `debugger` statement is not allowed\n');
		assert.equal(r.ok, false);
		assert.match(r.reason, /-f unix/);
	});

	test('an unknown parser', () => {
		assert.deepEqual(parse('regex', 'x'), { ok: false, reason: 'unknown parser regex' });
	});
});

describe('filterToFiles', () => {
	test('keeps lines whose path is one of the files', () => {
		const errors = [
			'eslint: src/a.js: no-debugger: x',
			'eslint: src/b.js: fatal: y: with colon',
			'tsc: -: TS5112: global',
		];
		assert.deepEqual(filterToFiles(errors, ['src/b.js']), [
			'eslint: src/b.js: fatal: y: with colon',
		]);
		assert.deepEqual(filterToFiles(errors, []), []);
	});
});
