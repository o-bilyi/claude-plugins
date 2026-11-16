import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
	cleanup,
	createProject,
	createWorkspace,
	git,
	readLog,
	runScript,
	stubOutput,
	writeFile,
} from './helpers.mjs';

after(cleanup);

const BIN = './node_modules/.bin';
const CONFIG = {
	version: 1,
	baseBranch: 'main',
	app: {
		triggers: ['src/'],
		checks: [
			{ kind: 'typecheck', run: `${BIN}/tsc --noEmit`, parser: 'tsc' },
			{
				kind: 'lint',
				run: `${BIN}/eslint -f json src`,
				changed: `${BIN}/eslint -f json {code}`,
				parser: 'eslint-json',
			},
			{
				kind: 'test',
				run: `${BIN}/vitest run`,
				related: `${BIN}/vitest related {files}`,
				fullWhen: ['src/shared/'],
			},
		],
	},
};
const FILES = {
	'src/a.ts': 'export const a = 1;\n',
	'src/b.ts': 'export const b = 1;\n',
	'src/shared/s.ts': 'export const s = 1;\n',
};
const OLD = "src/b.ts(3,1): error TS2304: Cannot find name 'old'.\n";
const NEW = "src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.\n";
const OLD_LINE = "tsc: src/b.ts: TS2304: Cannot find name 'old'.";
const NEW_LINE = "tsc: src/a.ts: TS2322: Type 'string' is not assignable to type 'number'.";

function project(config = CONFIG) {
	const p = createProject({ config, files: FILES, stubs: { '': ['tsc', 'eslint', 'vitest'] } });
	stubOutput(p, 'eslint', '[]\n');
	return p;
}

const env = p => ({ STUB_LOG: p.log, STUB_DIR: join(p.sandbox, 'out') });
const wc = (p, args) => runScript('wc.mjs', args, { root: p.root, env: env(p) });
const stop = (p, input = '{}') =>
	runScript('verify-changed.mjs', [], { root: p.root, input, env: env(p) });

function check(p, args = []) {
	const r = wc(p, ['check', ...args, '--json']);
	const report = JSON.parse(r.stdout);
	const byName = Object.fromEntries(report.units.flatMap(u => u.checks).map(c => [c.name, c]));
	return { status: r.status, report, ...byName };
}

const calls = p =>
	readLog(p.log)
		.trim()
		.split('\n')
		.filter(Boolean)
		.map(line => line.replace(p.realRoot, '.'));

describe('baseline and caused errors', () => {
	test('pre-existing errors do not fail; a new one is caused; a shifted old one is not', () => {
		const p = project();
		stubOutput(p, 'tsc', OLD, 2);
		const saved = JSON.parse(wc(p, ['baseline', 'save', '--json']).stdout);
		assert.deepEqual(saved.repos['.'].units.app, { typecheck: { count: 1 }, lint: { count: 0 } });

		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		const clean = check(p);
		assert.equal(clean.status, 0);
		assert.equal(clean.typecheck.status, 'pass');
		assert.equal(clean.typecheck.preExisting, 1);
		assert.equal(clean.typecheck.mode, 'run');
		assert.equal(clean.lint.command, `${BIN}/eslint -f json src`);

		stubOutput(p, 'tsc', OLD + NEW, 2);
		const failed = check(p);
		assert.equal(failed.status, 1);
		assert.deepEqual(failed.typecheck.caused, [NEW_LINE]);
		assert.equal(failed.typecheck.preExisting, 1);

		stubOutput(p, 'tsc', "src/b.ts(9,4): error TS2304: Cannot find name 'old'.\n", 2);
		assert.equal(check(p).typecheck.status, 'pass');
	});

	test('the baseline is a multiset: a third identical error is caused, one fewer is not', () => {
		const p = project();
		const same = n =>
			Array.from(
				{ length: n },
				(_, i) => `src/b.ts(${i + 1},1): ${OLD.split(': ').slice(1).join(': ')}`
			).join('');
		stubOutput(p, 'tsc', same(2), 2);
		const saved = JSON.parse(wc(p, ['baseline', 'save', '--json']).stdout);
		assert.deepEqual(saved.repos['.'].units.app.typecheck, { count: 2 });
		const file = join(p.realRoot, '.git/workflow-core/baseline/app/typecheck.errors');
		assert.equal(readFileSync(file, 'utf8'), `2\t${OLD_LINE}\n`);

		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		stubOutput(p, 'tsc', same(3), 2);
		const more = check(p);
		assert.equal(more.status, 1);
		assert.deepEqual(more.typecheck.caused, [OLD_LINE]);
		assert.equal(more.typecheck.preExisting, 2);

		stubOutput(p, 'tsc', same(5), 2);
		assert.deepEqual(check(p).typecheck.caused, [`${OLD_LINE} (+3)`]);

		stubOutput(p, 'tsc', same(1), 2);
		const fewer = check(p);
		assert.equal(fewer.status, 0);
		assert.equal(fewer.typecheck.preExisting, 1);
	});

	test('without a baseline only errors in touched files are caused, and changed is used', () => {
		const p = project();
		stubOutput(p, 'tsc', OLD + NEW, 2);
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		const r = check(p);
		assert.equal(r.status, 1);
		assert.deepEqual(r.typecheck.caused, [NEW_LINE]);
		assert.equal(r.typecheck.preExisting, 1);
		assert.equal(r.lint.command, `${BIN}/eslint -f json src/a.ts`);

		stubOutput(p, 'tsc', OLD, 2);
		assert.equal(check(p).status, 0);
	});

	test('without a baseline, errors in untouched files are returned as untouched lines', () => {
		const p = project();
		stubOutput(p, 'tsc', OLD + OLD.replace('(3,1)', '(8,1)') + NEW, 2);
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		const r = check(p);
		assert.deepEqual(r.typecheck.caused, [NEW_LINE]);
		assert.deepEqual(r.typecheck.untouched, [OLD_LINE]);
		assert.equal(r.typecheck.untouchedTruncated, 0);
		assert.equal(r.typecheck.preExisting, 2);

		const many = Array.from(
			{ length: 205 },
			(_, i) => `src/b.ts(1,1): error TS2304: Cannot find name 'x${i}'.\n`
		);
		stubOutput(p, 'tsc', many.join(''), 2);
		const capped = check(p);
		assert.equal(capped.typecheck.status, 'pass');
		assert.equal(capped.typecheck.untouched.length, 200);
		assert.equal(capped.typecheck.untouchedTruncated, 5);
	});

	test('with a baseline there are no untouched lines', () => {
		const p = project();
		stubOutput(p, 'tsc', OLD, 2);
		wc(p, ['baseline', 'save']);
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		assert.equal(check(p).typecheck.untouched, undefined);
	});

	test('simple tsc gets incremental flags in the repo state dir', () => {
		const p = project();
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		const state = join(p.realRoot, '.git/workflow-core');
		assert.equal(
			check(p).typecheck.command,
			`${BIN}/tsc --noEmit --incremental --tsBuildInfoFile ${state}/tsbuildinfo/app/typecheck`
		);
	});

	test('a file dirty at baseline is not touched until it is edited again', () => {
		const p = project();
		writeFile(p.root, 'src/b.ts', 'export const b = 2;\n');
		wc(p, ['baseline', 'save']);
		assert.equal(wc(p, ['check']).stdout.trim(), 'No units to check.');
		writeFile(p.root, 'src/b.ts', 'export const b = 3;\n');
		assert.deepEqual(
			check(p).report.units.map(u => u.name),
			['app']
		);
	});

	test('unparseable output falls back to the exit code with a warning', () => {
		const p = project();
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		stubOutput(p, 'tsc', 'Segmentation fault\n', 1);
		const r = check(p);
		assert.equal(r.typecheck.status, 'fail');
		assert.equal(r.typecheck.raw, 'Segmentation fault');
		assert.match(r.typecheck.warning, /app typecheck: unparseable output, judged by exit code/);

		stubOutput(p, 'tsc', '', 2);
		assert.equal(check(p).typecheck.status, 'fail');

		stubOutput(p, 'tsc', 'Segmentation fault\n', 0);
		const s = stop(p);
		assert.equal(s.status, 0, s.stderr);
		assert.match(JSON.parse(s.stdout).systemMessage, /warnings — app typecheck: unparseable/);
	});

	test('baseline off saves nothing unless forced', () => {
		const p = project({ ...CONFIG, process: { preflight: { baseline: 'off' } } });
		stubOutput(p, 'tsc', OLD, 2);
		assert.match(wc(p, ['baseline', 'save']).stdout, /Baseline is off/);
		assert.ok(!existsSync(join(p.root, '.git/workflow-core/baseline')));
		assert.match(wc(p, ['baseline', 'save', '--force']).stdout, /app: typecheck 1 errors/);
		const status = JSON.parse(wc(p, ['baseline', 'status', '--json']).stdout);
		assert.equal(status['.'].present, true);
		assert.equal(status['.'].stale, false);
		git(p.root, ['commit', '-q', '--allow-empty', '-m', 'next']);
		assert.match(wc(p, ['baseline', 'status']).stdout, /stale/);
		wc(p, ['baseline', 'clear']);
		assert.match(wc(p, ['baseline', 'status']).stdout, /no baseline/);
	});
});

describe('test checks', () => {
	test('related for touched files, run when fullWhen matches, tail of the output kept', () => {
		const p = project();
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		assert.equal(check(p).test.command, `${BIN}/vitest related src/a.ts`);

		writeFile(p.root, 'src/shared/s.ts', 'export const s = 2;\n');
		const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
		stubOutput(p, 'vitest', `${lines.join('\n')}\n`, 1);
		const r = check(p);
		assert.equal(r.test.command, `${BIN}/vitest run`);
		assert.equal(r.test.status, 'fail');
		assert.equal(r.test.raw, lines.slice(20).join('\n'));
	});

	test('the Stop hook labels related and full test runs', () => {
		const p = project();
		stubOutput(p, 'vitest', 'boom\n', 1);
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		assert.match(stop(p).stderr, /## app tests \(related\)\nboom/);
		writeFile(p.root, 'src/shared/s.ts', 'export const s = 2;\n');
		assert.match(stop(p).stderr, /## app tests\nboom/);
	});
});

describe('Stop hook cache', () => {
	test('skips an unchanged unit; edits and config changes invalidate it', () => {
		const p = project();
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		assert.equal(stop(p).status, 0);
		const first = readLog(p.log);
		assert.equal(stop(p).status, 0);
		assert.equal(readLog(p.log), first);

		writeFile(p.root, 'src/a.ts', 'export const a = 3;\n');
		stop(p);
		const second = readLog(p.log);
		assert.notEqual(second, first);

		writeFile(
			p.root,
			'.claude/workflow.config.json',
			JSON.stringify({ ...CONFIG, app: { ...CONFIG.app, notes: 'changed' } })
		);
		stop(p);
		assert.notEqual(readLog(p.log), second);
	});

	test('saving a baseline invalidates the cache', () => {
		const p = project();
		const stopCheck = () => wc(p, ['check', 'app', '--stop']);
		stubOutput(p, 'tsc', OLD, 2);
		wc(p, ['baseline', 'save']);
		stopCheck();
		const first = readLog(p.log);
		stopCheck();
		assert.equal(readLog(p.log), first);

		stubOutput(p, 'tsc', OLD + OLD.replace('b.ts', 'c.ts'), 2);
		wc(p, ['baseline', 'save']);
		const saved = readLog(p.log);
		stopCheck();
		assert.notEqual(readLog(p.log), saved);
	});

	test('a caused error exits 2 with the caused lines only', () => {
		const p = project();
		stubOutput(p, 'tsc', OLD, 2);
		wc(p, ['baseline', 'save']);
		stubOutput(p, 'tsc', OLD + NEW, 2);
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		const r = stop(p);
		assert.equal(r.status, 2);
		assert.equal(
			r.stderr,
			`verify-changed hook found problems in changed apps:\n## app typecheck\n${NEW_LINE}\n(1 pre-existing errors not shown)\n`
		);
	});

	test('a passing non-stop check also primes the cache', () => {
		const p = project();
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		check(p);
		const before = readLog(p.log);
		stop(p);
		assert.equal(readLog(p.log), before);
		check(p);
		assert.notEqual(readLog(p.log), before);
	});
});

describe('multi-repo workspace', () => {
	const config = {
		version: 1,
		units: {
			be: { dir: 'be', checks: [{ kind: 'typecheck', run: `${BIN}/tsc --noEmit`, parser: 'tsc' }] },
			ui: { dir: 'ui', checks: [{ kind: 'typecheck', run: `${BIN}/tsc --noEmit`, parser: 'tsc' }] },
		},
	};
	const workspace = () =>
		createWorkspace({
			config,
			repos: { be: { 'a.ts': '' }, ui: { 'b.ts': '' } },
			stubs: { be: ['tsc'], ui: ['tsc'] },
		});

	test('the Stop hook checks only the touched repo; state lands in its git dir', () => {
		const w = workspace();
		writeFile(w.root, 'ui/b.ts', 'export const b = 1;\n');
		const r = runScript('verify-changed.mjs', [], {
			root: w.root,
			input: '{}',
			env: { STUB_LOG: w.log },
		});
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(
			calls(w).map(line => line.split(' --incremental')[0]),
			['./ui tsc --noEmit']
		);
		assert.ok(existsSync(join(w.root, 'ui/.git/workflow-core/checked/ui.fp')));
		assert.ok(!existsSync(join(w.root, 'be/.git/workflow-core')));
	});

	test('session-start prints one line per repo', () => {
		const w = workspace();
		writeFile(w.root, 'ui/b.ts', 'export const b = 1;\n');
		const r = runScript('session-start.mjs', [], { root: w.root });
		assert.equal(
			r.stdout,
			'be: branch=main changed=0 baseline=no\nui: branch=main changed=1 baseline=no\n'
		);
	});
});

describe('preflight', () => {
	const TICKETS = {
		...CONFIG,
		pr: { titleFormat: '{summary}: {ticket}', ticketPattern: 'PROJ-[0-9]+' },
	};

	test('reports the branch ticket, dirty files, and saves the baseline', () => {
		const p = project(TICKETS);
		writeFile(p.root, 'src/b.ts', 'export const b = 2;\n');
		stubOutput(p, 'tsc', OLD, 2);
		const missing = wc(p, ['preflight']);
		assert.equal(missing.status, 0);
		assert.match(missing.stdout, /branch: main\nticket: missing\ndirty files \(1\):\n- src\/b\.ts/);
		assert.match(missing.stdout, /- \.\/app: typecheck 1 errors/);
		assert.ok(existsSync(join(p.root, '.git/workflow-core/baseline/dirty')));

		git(p.root, ['checkout', '-q', '-b', 'feature/proj-12-login']);
		const found = JSON.parse(wc(p, ['preflight', '--json']).stdout);
		assert.equal(found.repos['.'].ticket, 'PROJ-12');
		assert.equal(found.repos['.'].branch, 'feature/proj-12-login');
	});

	test('branchTicket false skips the ticket line', () => {
		const p = project({ ...TICKETS, process: { preflight: { branchTicket: false } } });
		assert.doesNotMatch(wc(p, ['preflight']).stdout, /ticket:/);
	});
});

describe('session-start', () => {
	test('silent without a config', () => {
		const p = createProject({ files: FILES });
		const r = runScript('session-start.mjs', [], { root: p.root });
		assert.equal(r.status, 0);
		assert.equal(r.stdout, '');
	});

	test('reports the baseline error count', () => {
		const p = project();
		stubOutput(p, 'tsc', OLD, 2);
		wc(p, ['baseline', 'save']);
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		const r = runScript('session-start.mjs', [], { root: p.root });
		assert.equal(r.stdout, '.: branch=main changed=1 baseline=yes (1 errors)\n');
	});
});

describe('wc.mjs check output', () => {
	test('markdown shows icons, caused lines and pre-existing counts', () => {
		const p = project();
		stubOutput(p, 'tsc', OLD + NEW, 2);
		writeFile(p.root, 'src/a.ts', 'export const a = 2;\n');
		rmSync(join(p.sandbox, 'out/eslint.out'));
		const r = wc(p, ['check']);
		assert.equal(r.status, 1);
		assert.match(
			r.stdout,
			/## app\n- ❌ typecheck \(1 in untouched files\)\n- ✅ lint\n- ✅ tests \(related\)/
		);
		assert.match(r.stdout, /### app typecheck\n`[^`]+`\n```\ntsc: src\/a\.ts: TS2322/);
		assert.match(r.stdout, /untouched-file errors: 1 \(see --json\)/);
		assert.match(r.stdout, /Warnings:\n- app lint: unparseable output/);
	});
});
