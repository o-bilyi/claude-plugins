import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { cleanup, createProject, createWorkspace, runScript, writeFile } from './helpers.mjs';

after(cleanup);

const CLI = 'wc.mjs';
const MONOREPO = {
	version: 1,
	baseBranch: 'main',
	units: {
		web: {
			dir: 'apps/web',
			triggers: ['apps/web/', 'packages/shared/'],
			checks: [
				{ kind: 'typecheck', run: './node_modules/.bin/tsc --noEmit' },
				{
					kind: 'lint',
					run: './node_modules/.bin/eslint .',
					changed: './node_modules/.bin/eslint {code}',
				},
				{ kind: 'test', run: './node_modules/.bin/vitest run' },
			],
		},
		backend: {
			dir: 'apps/backend',
			stopHook: false,
			notes: 'Also verify web when an API response type changes.',
			checks: [
				{ kind: 'typecheck', run: './node_modules/.bin/tsc --noEmit' },
				{ kind: 'lint', name: 'api audit', run: 'node scripts/api-audit.mjs' },
				{ kind: 'test', run: './node_modules/.bin/jest' },
			],
		},
	},
	reviewers: [{ agent: 'api-reviewer', paths: ['apps/backend/src/api/'] }],
};

const MONOREPO_TABLE = `| App | Dir | Typecheck | Lint | Tests |
| --- | --- | --- | --- | --- |
| web | apps/web | \`./node_modules/.bin/tsc --noEmit\` | \`./node_modules/.bin/eslint .\` | \`./node_modules/.bin/vitest run\` |
| backend | apps/backend | \`./node_modules/.bin/tsc --noEmit\` | \`node scripts/api-audit.mjs\` | \`./node_modules/.bin/jest\` |

Notes:
- backend: Also verify web when an API response type changes.
`;

const monorepoProject = () =>
	createProject({ config: MONOREPO, files: { 'apps/web/src/a.ts': 'export const a = 1;\n' } });

describe('wc.mjs exit codes', () => {
	test('exits 3 with a hint when the config is missing', () => {
		const p = createProject({ files: { 'a.ts': '' } });
		const r = runScript(CLI, ['units'], { root: p.root });
		assert.equal(r.status, 3);
		assert.equal(
			r.stderr,
			'No .claude/workflow.config.json found. Run /workflow-core:init to create one.\n'
		);
	});

	test('exits 3 with the init hint when the config has no version', () => {
		const p = createProject({ config: { baseBranch: 'main', apps: {} } });
		const r = runScript(CLI, ['doctor'], { root: p.root });
		assert.equal(r.status, 3);
		assert.match(r.stderr, /unsupported config version; run \/workflow-core:init/);
	});

	test('exits 2 for an invalid config and for invalid JSON', () => {
		const p = createProject({ config: { version: 1, pr: { titleFormat: 'x' } } });
		const r = runScript(CLI, ['doctor'], { root: p.root });
		assert.equal(r.status, 2);
		assert.match(r.stderr, /pr\.titleFormat/);

		writeFile(p.root, '.claude/workflow.config.json', '{ nope');
		assert.equal(runScript(CLI, ['units'], { root: p.root }).status, 2);
	});

	test('exits 2 for usage errors and 1 for an unset value', () => {
		const p = monorepoProject();
		assert.equal(runScript(CLI, ['nope'], { root: p.root }).status, 2);
		assert.equal(runScript(CLI, ['units', '--bogus'], { root: p.root }).status, 2);
		assert.equal(runScript(CLI, ['baseline', 'nope'], { root: p.root }).status, 2);
		const unknown = runScript(CLI, ['check', 'nope'], { root: p.root });
		assert.equal(unknown.status, 2);
		assert.match(unknown.stderr, /Unknown unit: nope/);
		assert.equal(runScript(CLI, ['get', 'prTarget'], { root: p.root }).status, 1);
		assert.equal(runScript(CLI, ['get', 'planner.extraChecklist'], { root: p.root }).status, 0);
	});
});

describe('wc.mjs table', () => {
	test('renders one row per unit, then the notes', () => {
		const p = monorepoProject();
		const r = runScript(CLI, ['table'], { root: p.root });
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout, MONOREPO_TABLE);
	});

	test('v1 other checks are listed as extras run from the unit dir', () => {
		const config = {
			version: 1,
			app: {
				checks: [
					{ kind: 'typecheck', name: 'tsc app', run: 'tsc -p a.json' },
					{ kind: 'typecheck', name: 'tsc spec', run: 'tsc -p b.json' },
					{ kind: 'other', name: 'nx build', run: 'npx nx build parser' },
				],
			},
		};
		const r = runScript(CLI, ['table', '--json'], { root: createProject({ config }).root });
		assert.equal(
			JSON.parse(r.stdout).table,
			[
				'| App | Dir | Typecheck | Lint | Tests |',
				'| --- | --- | --- | --- | --- |',
				'| app | . | `tsc -p a.json` + `tsc -p b.json` | - | - |',
				'',
				'Extras:',
				'- app (nx build, from .): `npx nx build parser`',
			].join('\n')
		);
	});
});

describe('wc.mjs subcommands', () => {
	test('get reads normalized values, as text or JSON', () => {
		const p = monorepoProject();
		assert.equal(runScript(CLI, ['get', 'baseBranch'], { root: p.root }).stdout, 'main\n');
		const r = runScript(CLI, ['get', 'units.backend.stopHook', '--json'], { root: p.root });
		assert.equal(r.stdout, 'false\n');
	});

	test('touched and reviewers follow the changed files', () => {
		const p = monorepoProject();
		writeFile(p.root, 'apps/backend/src/api/x.ts', 'export const x = 1;\n');
		const t = JSON.parse(runScript(CLI, ['touched', '--json'], { root: p.root }).stdout);
		assert.deepEqual(t.files, ['apps/backend/src/api/x.ts']);
		assert.deepEqual(t.units, ['backend']);
		const r = runScript(CLI, ['reviewers'], { root: p.root });
		assert.equal(r.stdout, 'api-reviewer\n');
	});

	test('units and doctor in a multi-repo workspace', () => {
		const config = {
			version: 1,
			repos: { ui: { prTarget: 'staging' }, gone: { prTarget: 'x' } },
			units: {
				ui: { dir: 'ui', checks: [{ kind: 'lint', run: './node_modules/.bin/eslint .' }] },
				docs: { dir: 'docs' },
			},
		};
		const w = createWorkspace({
			config,
			repos: { ui: { 'a.ts': '' } },
			files: { 'docs/a.md': '' },
		});
		const units = JSON.parse(runScript(CLI, ['units', '--json'], { root: w.root }).stdout);
		assert.equal(units.repos.ui.prTarget, 'staging');
		assert.equal(units.units.ui.repo, 'ui');
		assert.deepEqual(units.orphans, ['docs']);

		const r = runScript(CLI, ['doctor', '--json'], { root: w.root });
		assert.equal(r.status, 0, r.stderr);
		const types = JSON.parse(r.stdout).problems.map(p => p.type);
		assert.deepEqual(types.sort(), ['binary', 'orphan', 'repo']);

		const text = runScript(CLI, ['doctor'], { root: w.root }).stdout;
		assert.match(text, /unit docs: docs is not inside a git work tree/);
		assert.match(text, /repos\.gone: no unit resolves/);
		assert.match(text, /unit ui, check lint: \.\/node_modules\/\.bin\/eslint not found/);
	});

	test('doctor reports a base branch that does not exist', () => {
		const p = createProject({ config: { version: 1, baseBranch: 'develop', app: {} } });
		const r = runScript(CLI, ['doctor'], { root: p.root });
		assert.equal(r.status, 0);
		assert.match(r.stdout, /repo \.: base branch develop not found/);
	});
});
