import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { ConfigError, normalizeConfig } from '../scripts/lib/config.mjs';
import { evaluateDocs, parseCodePaths, skipReason } from '../scripts/lib/docs.mjs';
import { cleanup, createProject, git, runScript, writeFile } from './helpers.mjs';

after(cleanup);

const AREA = `---
area: billing
code_paths:
  - src/billing/**
  - src/shared/money.ts
---

# Billing
`;

const DOCS = {
	areas: 'docs/areas/*.md',
	changes: 'docs/features',
	newChange: ['README.md', 'adr/*.md'],
	ignore: ['**/*.test.ts'],
	guide: 'docs/README.md',
};

const config = docs => ({ version: 1, baseBranch: 'main', app: { checks: [] }, docs });

function project(docs = { ...DOCS, mode: 'require' }) {
	const p = createProject({
		config: config(docs),
		files: {
			'docs/areas/billing.md': AREA,
			'docs/README.md': '# Docs\n',
			'src/billing/pay.ts': 'export const pay = 1;\n',
			'src/billing/pay.test.ts': 'test\n',
			'src/other/x.ts': 'export const x = 1;\n',
		},
	});
	git(p.root, ['switch', '-q', '-c', 'feature']);
	return p;
}

const docsCli = (p, args = []) => runScript('wc.mjs', ['docs', ...args], { root: p.root });
const docsJson = (p, args = []) => JSON.parse(docsCli(p, [...args, '--json']).stdout);
const bashHook = (p, command) =>
	runScript('guard-bash.mjs', [], {
		root: p.root,
		input: JSON.stringify({ tool_input: { command }, cwd: p.root }),
	});

describe('docs config', () => {
	test('a config without docs has no docs section', () => {
		assert.equal(normalizeConfig(config(undefined)).docs, undefined);
	});

	test('defaults: warn, enforced at pr, README for a new change', () => {
		const { docs } = normalizeConfig(
			config({ areas: 'docs/areas/*.md', changes: './docs/features/' })
		);
		assert.equal(docs.mode, 'warn');
		assert.equal(docs.enforceAt, 'pr');
		assert.equal(docs.changes, 'docs/features');
		assert.deepEqual(docs.newChange, ['README.md']);
		assert.equal(docs.requireCoverage, true);
		assert.equal(docs.skipTrailer, 'Docs-Skip');
	});

	test('rejects bad values', () => {
		assert.throws(
			() => normalizeConfig(config({ areas: 'a/*.md', mode: 'block', newChange: ['README.md'] })),
			err =>
				err instanceof ConfigError &&
				/docs.mode must be one of/.test(err.message) &&
				/docs.newChange requires docs.changes/.test(err.message)
		);
		assert.throws(() => normalizeConfig(config({})), /docs.areas must be a glob/);
	});
});

describe('parseCodePaths', () => {
	test('reads a block list and an inline list', () => {
		assert.deepEqual(parseCodePaths(AREA), ['src/billing/**', 'src/shared/money.ts']);
		assert.deepEqual(parseCodePaths("---\ncode_paths: ['a/**', b.ts]\n---\n"), ['a/**', 'b.ts']);
		assert.deepEqual(parseCodePaths('# no frontmatter\n'), []);
	});
});

describe('skipReason', () => {
	test('finds the trailer in a commit command', () => {
		assert.equal(
			skipReason('git commit -m "Fix typo\n\nDocs-Skip: typo only"', 'Docs-Skip'),
			'typo only'
		);
		assert.equal(skipReason('git commit -m "Docs-Skip: rename"', 'Docs-Skip'), 'rename');
		assert.equal(skipReason('git commit -m "no trailer"', 'Docs-Skip'), null);
	});
});

describe('evaluateDocs', () => {
	const docs = normalizeConfig(config(DOCS)).docs;
	const current = new Map([['docs/areas/billing.md', ['src/billing/**']]]);

	test('an area covering changed code must change too', () => {
		const r = evaluateDocs(docs, {
			files: ['src/billing/pay.ts'],
			current,
			before: current,
			folders: [],
		});
		assert.equal(r.ok, false);
		assert.deepEqual(r.stale, [{ area: 'docs/areas/billing.md', files: ['src/billing/pay.ts'] }]);
	});

	test('ignored files and doc files need nothing', () => {
		const r = evaluateDocs(docs, {
			files: ['src/billing/pay.test.ts', 'docs/README.md', 'docs/features/x/README.md'],
			current,
			before: current,
			folders: [],
		});
		assert.equal(r.checked, 0);
		assert.equal(r.ok, true);
	});

	test('uncovered code fails only with requireCoverage', () => {
		const files = ['src/other/x.ts'];
		assert.deepEqual(
			evaluateDocs(docs, { files, current, before: current, folders: [] }).uncovered,
			files
		);
		const loose = { ...docs, requireCoverage: false };
		assert.equal(evaluateDocs(loose, { files, current, before: current, folders: [] }).ok, true);
	});

	test('new scope needs a complete change folder', () => {
		const now = new Map([['docs/areas/new.md', ['src/new/**']]]);
		const input = { files: ['src/new/a.ts', 'docs/areas/new.md'], current: now, before: new Map() };
		const missing = [{ dir: 'docs/features/new', missing: ['adr/*.md'] }];
		assert.equal(evaluateDocs(docs, { ...input, folders: missing }).newScope.needsChange, true);
		const done = [{ dir: 'docs/features/new', missing: [] }];
		assert.equal(evaluateDocs(docs, { ...input, folders: done }).ok, true);
	});
});

describe('wc.mjs docs', () => {
	test('says when docs are not configured', () => {
		const p = createProject({ config: config(undefined) });
		const r = docsCli(p);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /not configured/);
	});

	test('require mode fails until the area doc changes', () => {
		const p = project();
		writeFile(p.root, 'src/billing/pay.ts', 'export const pay = 2;\n');
		const r = docsCli(p);
		assert.equal(r.status, 1, r.stdout);
		assert.match(r.stdout, /docs\/areas\/billing\.md covers changed files/);

		writeFile(p.root, 'docs/areas/billing.md', `${AREA}\nPay is 2.\n`);
		assert.equal(docsCli(p).status, 0);
	});

	test('warn mode reports but exits 0', () => {
		const p = project({ ...DOCS, mode: 'warn' });
		writeFile(p.root, 'src/billing/pay.ts', 'export const pay = 2;\n');
		const r = docsCli(p);
		assert.equal(r.status, 0);
		assert.match(r.stdout, /not up to date/);
	});

	test('new scope needs a new area and a change folder with README and ADR', () => {
		const p = project({ ...DOCS, mode: 'require' });
		writeFile(p.root, 'src/other/x.ts', 'export const x = 2;\n');
		assert.deepEqual(docsJson(p).uncovered, ['src/other/x.ts']);

		writeFile(p.root, 'docs/areas/other.md', '---\ncode_paths: [src/other/**]\n---\n# Other\n');
		const scoped = docsJson(p);
		assert.deepEqual(scoped.newScope.files, ['src/other/x.ts']);
		assert.equal(scoped.ok, false);

		writeFile(p.root, 'docs/features/other/README.md', '# Other\n');
		assert.equal(docsJson(p).ok, false);
		writeFile(p.root, 'docs/features/other/adr/0001-x.md', '# ADR\n');
		assert.equal(docsJson(p).ok, true);
	});

	test('a skip trailer on the branch skips the check', () => {
		const p = project();
		writeFile(p.root, 'src/billing/pay.ts', 'export const pay = 2;\n');
		git(p.root, ['add', '-A']);
		git(p.root, ['commit', '-q', '-m', 'Rename\n\nDocs-Skip: rename only']);
		const report = docsJson(p);
		assert.equal(report.ok, true);
		assert.equal(report.skipped, 'rename only');
	});

	test('--staged checks only the staged files', () => {
		const p = project();
		writeFile(p.root, 'src/billing/pay.ts', 'export const pay = 2;\n');
		assert.equal(docsJson(p, ['--staged']).checked, 0);
		git(p.root, ['add', 'src/billing/pay.ts']);
		assert.equal(docsJson(p, ['--staged']).stale.length, 1);
	});
});

describe('guard-bash docs gate', () => {
	const staged = docs => {
		const p = project(docs);
		writeFile(p.root, 'src/billing/pay.ts', 'export const pay = 2;\n');
		git(p.root, ['add', 'src/billing/pay.ts']);
		return p;
	};

	test('blocks a commit without docs when enforced at commit', () => {
		const r = bashHook(
			staged({ ...DOCS, mode: 'require', enforceAt: 'commit' }),
			'git commit -m "Pay 2"'
		);
		assert.equal(r.status, 2);
		assert.match(r.stderr, /^Blocked: Docs: not up to date/);
	});

	test('lets the commit through with the skip trailer', () => {
		const p = staged({ ...DOCS, mode: 'require', enforceAt: 'commit' });
		const r = bashHook(p, 'git commit -m "Pay 2\n\nDocs-Skip: constant only"');
		assert.equal(r.status, 0, r.stderr);
	});

	test('only warns when enforced at pr', () => {
		const r = bashHook(staged({ ...DOCS, mode: 'require' }), 'git add -A && git commit -m "wip"');
		assert.equal(r.status, 0);
		assert.match(JSON.parse(r.stdout).systemMessage, /billing\.md covers changed files/);
	});

	test('ignores other commands and projects without docs', () => {
		const p = staged({ ...DOCS, mode: 'require', enforceAt: 'commit' });
		assert.equal(bashHook(p, 'git status').status, 0);
		const plain = createProject({ config: config(undefined) });
		assert.equal(bashHook(plain, 'git commit -m x').status, 0);
	});
});
