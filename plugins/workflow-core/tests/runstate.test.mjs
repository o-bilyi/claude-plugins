import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { planPaths } from '../scripts/lib/scope.mjs';
import {
	cleanup,
	createProject,
	createWorkspace,
	readLog,
	runScript,
	writeFile,
} from './helpers.mjs';

after(cleanup);

const APP = {
	version: 1,
	app: {
		checks: [
			{ kind: 'typecheck', run: './node_modules/.bin/tsc --noEmit' },
			{ kind: 'test', run: './node_modules/.bin/vitest run' },
		],
	},
};

const wc = (p, args, input) => runScript('wc.mjs', args, { root: p.root, input });
const json = r => JSON.parse(r.stdout);

const finding = (over = {}) => ({
	reviewer: 'reviewer',
	id: 'reviewer B1',
	severity: 'blocking',
	category: 'correctness',
	path: 'a.ts:3',
	summary: "the user's input is not checked",
	...over,
});
const review = (p, findings) => wc(p, ['state', 'review', '-', '--json'], JSON.stringify(findings));

describe('wc.mjs state', () => {
	test('set several pairs, get and clear', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		assert.deepEqual(json(wc(p, ['state', '--json'])), {});
		assert.equal(wc(p, ['state', 'set', 'phase=implement', 'round=2']).status, 0);
		const run = json(wc(p, ['state', '--json']));
		assert.equal(run.phase, 'implement');
		assert.equal(run.round, 2);
		assert.equal(wc(p, ['state', 'get', 'phase']).stdout, 'implement\n');
		assert.equal(wc(p, ['state', 'get', 'missing']).status, 1);
		assert.equal(wc(p, ['state', 'set', 'phase']).status, 2);
		wc(p, ['state', 'clear']);
		assert.deepEqual(json(wc(p, ['state', '--json'])), {});
	});

	test('start keeps the mode, the branch and a copy of the plan', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		const plan = '## Steps\n- S1 edit `a.ts`\n## Execution\nMode: quick\n';
		const run = json(wc(p, ['state', 'start', '--plan', '-', '--json'], plan));
		assert.equal(run.mode, 'quick');
		assert.equal(run.phase, 'preflight');
		assert.equal(run.round, 0);
		assert.deepEqual(Object.keys(run.branches), ['.']);
		assert.equal(json(wc(p, ['state', 'start', 'full', '--json'])).mode, 'full');
		assert.equal(wc(p, ['state', 'start', 'slow']).status, 2);
	});

	test('preflight moves the run to implement', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		wc(p, ['state', 'start', 'full']);
		wc(p, ['preflight', '--json']);
		assert.equal(wc(p, ['state', 'get', 'phase']).stdout, 'implement\n');
	});

	test('round counts up to process.maxRounds, then exits 1', () => {
		const p = createProject({
			config: { ...APP, process: { maxRounds: 2 } },
			files: { 'a.ts': '' },
		});
		wc(p, ['state', 'start', 'full']);
		assert.match(wc(p, ['state', 'round']).stdout, /round 1 of 2/);
		assert.equal(wc(p, ['state', 'round']).status, 0);
		const r = wc(p, ['state', 'round']);
		assert.equal(r.status, 1);
		assert.match(r.stdout, /NEXT: ask \(no round left/);
		assert.equal(wc(p, ['state', 'get', 'phase']).stdout, 'fix\n');
	});

	test('review decides the next step from the findings', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		wc(p, ['state', 'start', 'full']);
		const first = json(
			review(p, [finding(), finding({ id: 'reviewer F1', severity: 'should-fix' })])
		);
		assert.equal(first.pass, 1);
		assert.equal(first.blocking, 1);
		assert.equal(first.shouldFix, 1);
		assert.equal(first.next, 'fix');
		wc(p, ['state', 'round']);
		assert.equal(json(review(p, [])).next, 'report');
		assert.equal(wc(p, ['state', 'get', 'phase']).stdout, 'report\n');
		const run = json(wc(p, ['state', '--json']));
		assert.equal(run.findings.length, 2);
		assert.equal(run.findings[0].pass, 1);
	});

	test('review asks the user when the same blocking finding is in three passes', () => {
		const p = createProject({
			config: { ...APP, process: { maxRounds: 5 } },
			files: { 'a.ts': '' },
		});
		wc(p, ['state', 'start', 'full']);
		assert.equal(json(review(p, [finding()])).next, 'fix');
		wc(p, ['state', 'round']);
		assert.equal(json(review(p, [finding({ id: 'reviewer B2', path: 'a.ts:9' })])).next, 'fix');
		wc(p, ['state', 'round']);
		const r = review(p, [finding({ id: 'reviewer B1', summary: 'other words' })]);
		assert.equal(json(r).next, 'ask');
		assert.deepEqual(json(r).repeated, ['reviewer | a.ts | correctness']);
		const text = wc(p, ['state', 'review', '-'], '[]');
		assert.match(text.stdout, /NEXT: report/);
	});

	test('review asks the user when no round is left', () => {
		const p = createProject({
			config: { ...APP, process: { maxRounds: 1 } },
			files: { 'a.ts': '' },
		});
		wc(p, ['state', 'start', 'full']);
		wc(p, ['state', 'round']);
		const r = json(review(p, [finding()]));
		assert.equal(r.next, 'ask');
		assert.match(r.reason, /no round left/);
	});

	test('review rejects findings without the needed fields, and a value that is not stdin', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		wc(p, ['state', 'start', 'full']);
		assert.equal(review(p, [{ id: 'B1' }]).status, 2);
		assert.equal(wc(p, ['state', 'review', '-'], 'not json').status, 2);
		assert.equal(wc(p, ['state', 'review', '[]']).status, 2);
	});

	test('a workspace keeps the state in the first repo', () => {
		const p = createWorkspace({
			config: { version: 1, units: { a: { dir: 'a' }, b: { dir: 'b' } } },
			repos: { a: { 'x.ts': '' }, b: { 'y.ts': '' } },
		});
		wc(p, ['state', 'set', 'phase=review']);
		assert.equal(wc(p, ['state', 'get', 'phase']).stdout, 'review\n');
	});

	test('session start reports a run in progress, and the branch of another run', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		wc(p, ['state', 'start', 'full']);
		wc(p, ['state', 'set', 'phase=review', 'round=1']);
		const r = runScript('session-start.mjs', [], { root: p.root });
		assert.match(r.stdout, /workflow run in progress: mode=full phase=review round=1/);
		wc(p, ['state', 'set', 'branches={".":"feature/old"}']);
		assert.match(
			runScript('session-start.mjs', [], { root: p.root }).stdout,
			/in progress on another branch \(\.: feature\/old\)/
		);
		wc(p, ['state', 'set', 'phase=done']);
		assert.doesNotMatch(runScript('session-start.mjs', [], { root: p.root }).stdout, /in progress/);
	});

	test('an unknown action is a usage error', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		assert.equal(wc(p, ['state', 'drop', 'x']).status, 2);
	});
});

describe('wc.mjs metrics', () => {
	test('record adds what the run and the diff know, and ends the run', () => {
		const p = createProject({ config: APP, files: { 'a.ts': 'one\n' } });
		assert.match(wc(p, ['metrics']).stdout, /No workflow runs recorded/);
		wc(p, ['state', 'start', 'quick']);
		writeFile(p.root, 'a.ts', 'one\ntwo\n');
		review(p, [finding({ category: 'reuse' })]);
		wc(p, ['state', 'round']);
		review(p, []);
		const entry = json(
			wc(p, ['metrics', 'record', '-', '--json'], '{"result":"PASS","caused":3,"estimate":5}')
		);
		assert.equal(entry.mode, 'quick');
		assert.equal(entry.rounds, 1);
		assert.equal(entry.passes, 2);
		assert.equal(entry.added, 1);
		assert.equal(entry.findings.length, 1);
		assert.match(entry.findings[0].summary, /user's input/);
		assert.equal(wc(p, ['state', 'get', 'phase']).stdout, 'done\n');

		assert.equal(wc(p, ['metrics', 'record', '-'], '').status, 2);
		wc(p, ['state', 'clear']);
		wc(p, ['metrics', 'record', '-'], '');
		const out = json(wc(p, ['metrics', '--json']));
		assert.equal(out.entries.length, 2);
		assert.equal(out.summary.meanRounds, 0.5);
		assert.equal(out.summary.caused, 3);
		assert.deepEqual(out.summary.blockingByReviewer, { reviewer: 1 });
		assert.deepEqual(out.summary.categories, { reuse: 1 });
		assert.match(wc(p, ['metrics']).stdout, /mean rounds: 0\.5/);
	});

	test('record takes only the fields that the script does not know', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		assert.equal(wc(p, ['metrics', 'record', '-'], 'oops').status, 2);
		assert.equal(wc(p, ['metrics', 'record', '-'], '{"rounds":9}').status, 2);
		assert.equal(wc(p, ['metrics', 'record', '{}']).status, 2);
	});
});

describe('wc.mjs scope', () => {
	test('planPaths takes backticked files and dirs, and not identifiers', () => {
		assert.deepEqual(
			planPaths(
				'Edit `src/a.ts`, `./lib/` and `README.md` with `Array.isArray`; run `npm test` and `src/*.ts`.'
			),
			{ paths: ['src/a.ts', 'lib/', 'README.md'], forbidden: [] }
		);
	});

	test('planPaths keeps the out-of-scope paths apart', () => {
		const plan = [
			'## Steps',
			'- S1 edit `src/a.ts`',
			'## Out of scope',
			'- do not touch `src/config.ts` or `src/a.ts`',
			'## Tests',
			'- `test/a.test.ts`',
		].join('\n');
		assert.deepEqual(planPaths(plan), {
			paths: ['src/a.ts', 'test/a.test.ts'],
			forbidden: ['src/config.ts'],
		});
		assert.deepEqual(
			planPaths('- **Steps:** `a.ts`\n- **Out of scope:** `b.ts`\n- **Tests:** `c.ts`'),
			{
				paths: ['a.ts', 'c.ts'],
				forbidden: ['b.ts'],
			}
		);
	});

	test('lists touched files outside the plan and in its out of scope, and exits 1', () => {
		const p = createProject({
			config: APP,
			files: { 'src/a.ts': '', 'src/b.ts': '', 'lib/c.ts': '', 'src/config.ts': '' },
		});
		for (const f of ['src/a.ts', 'src/b.ts', 'lib/c.ts', 'src/config.ts'])
			writeFile(p.root, f, 'x\n');
		const r = wc(
			p,
			['scope', '--plan', '-', '--json'],
			'Change `src/a.ts` and the files in `lib/`.\n## Out of scope\n- `src/config.ts`'
		);
		assert.equal(r.status, 1);
		assert.deepEqual(json(r).extra, ['src/b.ts']);
		assert.deepEqual(json(r).forbidden, ['src/config.ts']);
		assert.deepEqual(json(r).planned.sort(), ['lib/c.ts', 'src/a.ts']);
	});

	test('without --plan it uses the plan of the run', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		assert.equal(wc(p, ['scope']).status, 2);
		assert.equal(wc(p, ['scope', '--plan']).status, 2);
		wc(p, ['state', 'start', 'full', '--plan', '-'], 'Edit `a.ts`.');
		writeFile(p.root, 'a.ts', 'x\n');
		const r = wc(p, ['scope']);
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /Every touched file is in the plan/);
	});

	test('a quick run past the limits changes to full mode', () => {
		const p = createProject({
			config: APP,
			files: { 'a.ts': '', 'b.ts': '', 'c.ts': '', 'd.ts': '' },
		});
		wc(p, ['state', 'start', 'quick', '--plan', '-'], 'Edit `a.ts`.');
		writeFile(p.root, 'a.ts', 'x\n');
		assert.doesNotMatch(wc(p, ['scope']).stdout, /MODE/);
		for (const f of ['b.ts', 'c.ts', 'd.ts']) writeFile(p.root, f, 'x\n');
		assert.match(
			wc(p, ['scope']).stdout,
			/MODE: full \(quick limits exceeded: 1 unit\(s\), 4 file/
		);
		assert.equal(wc(p, ['state', 'get', 'mode']).stdout, 'full\n');
	});

	test('accepts repo-relative plan paths in a workspace', () => {
		const p = createWorkspace({
			config: { version: 1, units: { api: { dir: 'api' } } },
			repos: { api: { 'src/x.ts': '' } },
		});
		writeFile(p.root, 'api/src/x.ts', 'y\n');
		writeFile(p.root, 'plan.md', 'Edit `src/x.ts`.');
		const r = wc(p, ['scope', '--plan', join(p.root, 'plan.md')]);
		assert.equal(r.status, 0, r.stdout);
		assert.match(r.stdout, /Every touched file is in the plan/);
	});
});

describe('wc.mjs writing', () => {
	test('prints the STE rules and the project guide in one call', () => {
		const p = createProject({
			config: { ...APP, writing: { style: 'ste100', guide: 'docs/writing.md' } },
			files: { 'a.ts': '', 'docs/writing.md': 'Say "sign in", not "log in".\n' },
		});
		const out = wc(p, ['writing']).stdout;
		assert.match(out, /Simplified Technical English|STE/);
		assert.match(out, /Project writing guide \(docs\/writing\.md\)/);
		assert.match(out, /sign in/);
	});

	test('plain style and no config print one line', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		assert.equal(wc(p, ['writing']).stdout, 'Writing style: plain. No extra rules.\n');
		const none = createProject({ files: { 'a.ts': '' } });
		assert.equal(wc(none, ['writing']).status, 0);
	});
});

describe('wc.mjs diffstat', () => {
	test('counts added and deleted lines, untracked files included', () => {
		const p = createProject({ config: APP, files: { 'a.ts': 'one\ntwo\nthree\n' } });
		writeFile(p.root, 'a.ts', 'one\nTWO\nthree\nfour\n');
		writeFile(p.root, 'b.ts', 'x\ny\n');
		const out = json(wc(p, ['diffstat', '--json']));
		assert.deepEqual(
			out.files.sort((x, y) => x.file.localeCompare(y.file)),
			[
				{ file: 'a.ts', added: 2, deleted: 1 },
				{ file: 'b.ts', added: 2, deleted: 0 },
			]
		);
		assert.equal(out.added, 4);
		assert.match(wc(p, ['diffstat']).stdout, /total: \+4 -1 in 2 file\(s\)/);
	});

	test('a file dirty before the task counts from the baseline content', () => {
		const p = createProject({ config: APP, files: { 'a.ts': 'one\ntwo\n' } });
		writeFile(p.root, 'a.ts', 'one\ntwo\nthree\n');
		writeFile(p.root, 'c.ts', 'x\n');
		assert.equal(wc(p, ['baseline', 'save', '--force']).status, 0);
		writeFile(p.root, 'a.ts', 'one\nTWO\nthree\n');
		writeFile(p.root, 'c.ts', 'x\ny\n');
		const out = json(wc(p, ['diffstat', '--json']));
		assert.deepEqual(
			out.files.sort((x, y) => x.file.localeCompare(y.file)),
			[
				{ file: 'a.ts', added: 1, deleted: 1 },
				{ file: 'c.ts', added: 1, deleted: 0 },
			]
		);
	});
});

describe('wc.mjs check --kind', () => {
	test('runs only the checks of that kind', () => {
		const p = createProject({
			config: APP,
			files: { 'a.ts': '' },
			stubs: { '.': ['tsc', 'vitest'] },
		});
		writeFile(p.root, 'a.ts', 'x\n');
		const r = runScript('wc.mjs', ['check', '--kind', 'test', '--json'], {
			root: p.root,
			env: { STUB_LOG: p.log },
		});
		assert.equal(r.status, 0, r.stderr);
		const log = readLog(p.log);
		assert.match(log, /vitest/);
		assert.doesNotMatch(log, /tsc/);
		assert.deepEqual(
			json(r).units[0].checks.map(c => c.kind),
			['test']
		);
	});

	test('--retry runs a failed test check one more time', () => {
		const p = createProject({
			config: APP,
			files: { 'a.ts': '' },
			stubs: { '.': ['tsc', 'vitest'] },
		});
		writeFile(p.root, 'a.ts', 'x\n');
		const r = runScript('wc.mjs', ['check', '--kind', 'test', '--retry', '--json'], {
			root: p.root,
			env: { STUB_LOG: p.log, STUB_FAIL: 'vitest' },
		});
		assert.equal(r.status, 1);
		const check = json(r).units[0].checks[0];
		assert.equal(check.status, 'fail');
		assert.equal(check.retry, 'fail');
		assert.equal(readLog(p.log).match(/vitest/g).length, 2);
	});

	test('rejects an unknown kind', () => {
		const p = createProject({ config: APP, files: { 'a.ts': '' } });
		assert.equal(wc(p, ['check', '--kind', 'build']).status, 2);
	});
});

describe('config writing section', () => {
	test('accepts style and guide, rejects other styles', () => {
		const ok = createProject({
			config: { ...APP, writing: { style: 'ste100', guide: 'docs/writing.md' } },
			files: { 'a.ts': '' },
		});
		assert.equal(wc(ok, ['get', 'writing.style']).stdout, 'ste100\n');
		const bad = createProject({ config: { ...APP, writing: { style: 'fancy' } }, files: {} });
		const r = wc(bad, ['doctor']);
		assert.equal(r.status, 2);
		assert.match(r.stderr, /writing\.style must be one of plain, ste100/);
	});
});
