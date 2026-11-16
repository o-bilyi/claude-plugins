import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { cleanup, createProject, readLog, runScript, writeFile } from './helpers.mjs';

after(cleanup);

const HOOK = 'verify-changed.mjs';

// Each stub logs "<cwd> <name> <args>". `calls` strips the physical root so lines read "./apps/web tsc ...".
function calls(p) {
	return readLog(p.log)
		.trim()
		.split('\n')
		.filter(Boolean)
		.map(line => line.replace(p.realRoot, '.'));
}

function stop(p, { env = {}, input = '{}' } = {}) {
	return runScript(HOOK, [], { root: p.root, input, env: { STUB_LOG: p.log, ...env } });
}

const REACT = {
	version: 1,
	baseBranch: 'main',
	app: {
		checks: [
			{ kind: 'typecheck', run: './node_modules/.bin/tsc -b' },
			{
				kind: 'lint',
				run: './node_modules/.bin/oxlint .',
				changed: './node_modules/.bin/oxlint {code}',
			},
			{
				kind: 'test',
				run: './node_modules/.bin/vitest run',
				related: './node_modules/.bin/vitest related --run --passWithNoTests {files}',
			},
		],
	},
};

const REACT_FILES = {
	'package.json': '{}\n',
	'tsconfig.json': '{ "files": [], "references": [] }\n',
	'vite.config.ts': 'export default {};\n',
	'src/App.jsx': 'export const App = () => null;\n',
};

const REACT_CHECKS = [
	'. tsc -b',
	'. oxlint src/App.jsx',
	'. vitest related --run --passWithNoTests src/App.jsx',
];

function reactProject(bins = ['tsc', 'oxlint', 'vitest']) {
	return createProject({ config: REACT, files: REACT_FILES, stubs: { '': bins } });
}

describe('single app (React-like)', () => {
	test('an edited source file runs typecheck, lint on that file and related tests', () => {
		const p = reactProject();
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');
		const r = stop(p);
		assert.equal(r.status, 0, r.stderr);
		assert.deepEqual(calls(p), REACT_CHECKS);
	});

	test('a change to a root config file triggers the whole-repo app', () => {
		const p = reactProject();
		writeFile(p.root, 'vite.config.ts', 'export default { server: {} };\n');
		const r = stop(p);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(calls(p).includes('. tsc -b'));
		assert.ok(calls(p).includes('. oxlint vite.config.ts'));
	});

	test('a failing check exits 2; after a fix it passes and the next run is cached', () => {
		const p = reactProject();
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');

		const failed = stop(p, { env: { STUB_FAIL: 'tsc' } });
		assert.equal(failed.status, 2);
		assert.match(failed.stderr, /## app typecheck/);

		const fixed = stop(p);
		assert.equal(fixed.status, 0, fixed.stderr);
		const afterFix = readLog(p.log);

		const cached = stop(p);
		assert.equal(cached.status, 0, cached.stderr);
		assert.equal(readLog(p.log), afterFix);
	});

	test('a missing lint binary is reported once as a system message', () => {
		const p = reactProject(['tsc', 'vitest']);
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');

		const first = stop(p);
		assert.equal(first.status, 0, first.stderr);
		const message = JSON.parse(first.stdout);
		assert.match(message.systemMessage, /app lint: \.\/node_modules\/\.bin\/oxlint not found/);
		assert.deepEqual(calls(p), [
			'. tsc -b',
			'. vitest related --run --passWithNoTests src/App.jsx',
		]);

		const second = stop(p);
		assert.equal(second.status, 0);
		assert.equal(second.stdout, '');
	});

	test('stop_hook_active exits 0 without running anything', () => {
		const p = reactProject();
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');
		const r = stop(p, { input: JSON.stringify({ stop_hook_active: true }) });
		assert.equal(r.status, 0);
		assert.equal(readLog(p.log), '');
	});

	test('a config without version 1 exits 0 without running anything', () => {
		const { version, ...unversioned } = REACT;
		const p = createProject({
			config: unversioned,
			files: REACT_FILES,
			stubs: { '': ['tsc', 'oxlint', 'vitest'] },
		});
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');
		const r = stop(p);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(readLog(p.log), '');
	});

	test('no config exits 0 without running anything', () => {
		const p = createProject({ files: REACT_FILES, stubs: { '': ['tsc', 'oxlint', 'vitest'] } });
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');
		const r = stop(p);
		assert.equal(r.status, 0);
		assert.equal(readLog(p.log), '');
	});
});

const typecheck = { kind: 'typecheck', run: './node_modules/.bin/tsc --noEmit' };
const eslint = (extra = '') => ({
	kind: 'lint',
	run: `./node_modules/.bin/eslint .${extra}`,
	changed: `./node_modules/.bin/eslint {code}${extra}`,
});

const MONO = {
	version: 1,
	baseBranch: 'master',
	pr: { titleFormat: '{summary}: {ticket}', ticketPattern: 'TICKET-[0-9]+' },
	units: {
		web: {
			dir: 'apps/web',
			triggers: ['apps/web/', 'packages/ui/'],
			checks: [
				typecheck,
				eslint(),
				{
					kind: 'test',
					run: './node_modules/.bin/vitest run',
					related: './node_modules/.bin/vitest related --run --passWithNoTests {files}',
				},
			],
		},
		api: { dir: 'apps/api', checks: [typecheck, eslint()] },
		ui: { dir: 'packages/ui', stopHook: false, checks: [eslint(' --max-warnings 0')] },
	},
};

const MONO_FILES = {
	'apps/web/src/a.ts': 'export const a = 1;\n',
	'apps/api/src/b.ts': 'export const b = 1;\n',
	'packages/ui/src/c.ts': 'export const c = 1;\n',
};

const MONO_STUBS = {
	'apps/web': ['tsc', 'eslint', 'vitest'],
	'apps/api': ['tsc', 'eslint'],
	'packages/ui': ['eslint'],
};

function monoProject() {
	return createProject({ config: MONO, files: MONO_FILES, stubs: MONO_STUBS });
}

describe('monorepo', () => {
	test('a change in a shared package triggers the apps that list it, not the others', () => {
		const p = monoProject();
		writeFile(p.root, 'packages/ui/src/c.ts', 'export const c = 2;\n');
		const r = stop(p);
		assert.equal(r.status, 0, r.stderr);
		const lines = calls(p);
		assert.equal(lines.length, 1);
		assert.ok(lines[0].startsWith('./apps/web tsc --noEmit'));
	});

	test('an app with stopHook false is never run by the Stop hook', () => {
		const p = monoProject();
		writeFile(p.root, 'packages/ui/src/c.ts', 'export const c = 2;\n');
		stop(p);
		assert.ok(!calls(p).some(line => line.includes('packages/ui')));
	});

	test('a change in one app runs only that app', () => {
		const p = monoProject();
		writeFile(p.root, 'apps/api/src/b.ts', 'export const b = 2;\n');
		const r = stop(p);
		assert.equal(r.status, 0, r.stderr);
		const lines = calls(p);
		assert.ok(lines.every(line => line.startsWith('./apps/api ')));
		assert.ok(lines.includes('./apps/api eslint src/b.ts'));
	});

	test('{files} is relative to the app directory', () => {
		const p = monoProject();
		writeFile(p.root, 'apps/web/src/a.ts', 'export const a = 2;\n');
		const r = stop(p);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(calls(p).includes('./apps/web vitest related --run --passWithNoTests src/a.ts'));
		assert.ok(calls(p).includes('./apps/web eslint src/a.ts'));
	});
});

describe('session scope', () => {
	const SESSION = 'sess-1';
	const track = (p, file, session = SESSION) =>
		runScript('track-edit.mjs', [], {
			root: p.root,
			input: JSON.stringify({ session_id: session, tool_input: { file_path: join(p.root, file) } }),
		});
	const stopAs = (p, session = SESSION, env = {}) =>
		stop(p, { input: JSON.stringify({ session_id: session }), env });

	test('a session that edited nothing runs no checks, even with a dirty working tree', () => {
		const p = reactProject();
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');
		const r = stopAs(p, SESSION, { STUB_FAIL: 'tsc' });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(readLog(p.log), '');
	});

	test('only the files the session edited reach {files} and {code}', () => {
		const p = monoProject();
		writeFile(p.root, 'apps/web/src/a.ts', 'export const a = 2;\n');
		writeFile(p.root, 'apps/web/src/mine.ts', 'export const m = 1;\n');
		assert.equal(track(p, 'apps/web/src/mine.ts').status, 0);

		const r = stopAs(p);
		assert.equal(r.status, 0, r.stderr);
		const lines = calls(p);
		assert.ok(lines.includes('./apps/web eslint src/mine.ts'), lines.join('\n'));
		assert.ok(lines.includes('./apps/web vitest related --run --passWithNoTests src/mine.ts'));
	});

	test('a change outside the session does not trigger another unit', () => {
		const p = monoProject();
		writeFile(p.root, 'apps/api/src/b.ts', 'export const b = 2;\n');
		writeFile(p.root, 'apps/web/src/a.ts', 'export const a = 2;\n');
		track(p, 'apps/web/src/a.ts');
		stopAs(p);
		assert.ok(!calls(p).some(line => line.startsWith('./apps/api ')));
	});

	test('edits are kept per session', () => {
		const p = reactProject();
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');
		track(p, 'src/App.jsx', 'other');
		const r = stopAs(p, SESSION, { STUB_FAIL: 'tsc' });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(readLog(p.log), '');

		const other = stopAs(p, 'other', { STUB_FAIL: 'tsc' });
		assert.equal(other.status, 2);
	});

	test('an edited file reverted to HEAD has nothing left to check', () => {
		const p = reactProject();
		writeFile(p.root, 'src/App.jsx', 'export const App = () => 1;\n');
		track(p, 'src/App.jsx');
		writeFile(p.root, 'src/App.jsx', 'export const App = () => null;\n');
		const r = stopAs(p);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(readLog(p.log), '');
	});
});
