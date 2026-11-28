import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { lintProse } from '../scripts/lib/prose.mjs';
import { cleanup, createProject, runScript, writeFile } from './helpers.mjs';

after(cleanup);

const rules = text => lintProse(text).map(i => i.rule);
const long = n => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('lintProse', () => {
	test('a clean text has no issues', () => {
		assert.deepEqual(lintProse('Run the tests. The tester reads the output.\n'), []);
	});

	test('an instruction has at most 20 words, a description 25', () => {
		assert.deepEqual(rules(`Run ${long(19)}.`), []);
		assert.deepEqual(rules(`Run ${long(20)}.`), ['length']);
		assert.deepEqual(rules(`The ${long(24)}.`), []);
		assert.deepEqual(rules(`The ${long(25)}.`), ['length']);
	});

	test('inline code counts as one word', () => {
		assert.deepEqual(rules(`Run \`${long(30)}\` now.`), []);
	});

	test('passive voice', () => {
		assert.deepEqual(rules('The checks are run by the tester.'), ['passive']);
		assert.deepEqual(rules('The file was written.'), ['passive']);
		assert.deepEqual(rules('The file is unchanged.'), []);
	});

	test('words with a simpler replacement', () => {
		const issues = lintProse('Utilize the cache in order to start.');
		assert.deepEqual(
			issues.map(i => i.message),
			['"utilize": use "use"', '"in order to": use "to"']
		);
	});

	test('a paragraph has at most six sentences; list items do not count', () => {
		assert.deepEqual(rules('A b. '.repeat(7)), ['paragraph']);
		assert.deepEqual(rules('- A b. A b. A b. A b. A b. A b. A b.\n'), []);
	});

	test('skips frontmatter, code fences, headings, tables and ignored blocks', () => {
		const text = [
			'---',
			'description: The checks are run by the tool.',
			'---',
			'# The checks are run',
			'```',
			'The checks are run.',
			'```',
			'| The checks are run. |',
			'<!-- prose-ignore -->',
			'The checks are run.',
			'',
			'Run the checks.',
		].join('\n');
		assert.deepEqual(lintProse(text), []);
	});

	test('reports the first line of the block', () => {
		const issues = lintProse('Run it.\n\nThe file\nwas written.\n');
		assert.deepEqual(
			issues.map(i => i.line),
			[3]
		);
	});
});

describe('wc.mjs prose', () => {
	test('works without a config, warns with exit 0, and --strict exits 1', () => {
		const p = createProject({ files: { 'a.md': 'The file was written.\n' } });
		const warn = runScript('wc.mjs', ['prose', join(p.root, 'a.md')], { root: p.root });
		assert.equal(warn.status, 0, warn.stderr);
		assert.match(warn.stdout, /a\.md:1: passive/);
		const strict = runScript('wc.mjs', ['prose', join(p.root, 'a.md'), '--strict'], {
			root: p.root,
		});
		assert.equal(strict.status, 1);
	});

	test('reads stdin with - and prints JSON', () => {
		const p = createProject({ files: {} });
		const r = runScript('wc.mjs', ['prose', '-', '--json'], {
			root: p.root,
			input: 'Utilize it.\n',
		});
		assert.equal(r.status, 0, r.stderr);
		assert.equal(JSON.parse(r.stdout)[0].issues[0].rule, 'word');
	});

	test('--rules prints the STE rules', () => {
		const p = createProject({ files: {} });
		writeFile(p.root, 'x', '');
		const r = runScript('wc.mjs', ['prose', '--rules'], { root: p.root });
		assert.equal(r.status, 0);
		assert.match(r.stdout, /ASD-STE100/);
	});

	test('without a file it is a usage error', () => {
		const p = createProject({ files: {} });
		assert.equal(runScript('wc.mjs', ['prose'], { root: p.root }).status, 2);
	});
});

test('an ignore marker before a code fence does not skip the block after the fence', () => {
	const text = '<!-- prose-ignore -->\n\n```\nx\n```\n\nThe file was written.\n';
	assert.deepEqual(rules(text), ['passive']);
});
