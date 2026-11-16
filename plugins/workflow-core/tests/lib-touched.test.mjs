import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { normalizeConfig } from '../scripts/lib/config.mjs';
import { buildModel } from '../scripts/lib/model.mjs';
import { touched, unitFiles } from '../scripts/lib/touched.mjs';
import { cleanup, createProject, createWorkspace, git, writeFile } from './helpers.mjs';

after(cleanup);

const CONFIG = {
	version: 1,
	baseBranch: 'main',
	units: {
		web: { dir: 'apps/web', triggers: ['apps/web/', 'packages/ui/'] },
		api: { dir: 'apps/api' },
	},
};
const FILES = {
	'apps/web/src/a.ts': 'export const a = 1;\n',
	'apps/web/src/b.ts': 'export const b = 1;\n',
	'apps/web/README.md': '# web\n',
	'apps/api/src/c.ts': 'export const c = 1;\n',
	'packages/ui/d.ts': 'export const d = 1;\n',
};

function project() {
	const p = createProject({ config: CONFIG, files: FILES });
	const model = buildModel(p.root, normalizeConfig(CONFIG));
	return { ...p, model, repo: model.repos['.'] };
}

const hash = (p, file) => git(p.root, ['hash-object', file]).trim();

function saveDirty(p, entries) {
	mkdirSync(join(p.repo.state, 'baseline'), { recursive: true });
	writeFileSync(join(p.repo.state, 'baseline', 'dirty'), `${entries.join('\n')}\n`);
}

describe('touched entries', () => {
	test('modified, deleted and untracked files are entries with their hash', () => {
		const p = project();
		writeFile(p.root, 'apps/web/src/a.ts', 'export const a = 2;\n');
		rmSync(join(p.root, 'apps/web/src/b.ts'));
		writeFile(p.root, 'apps/web/src/new.ts', 'export const n = 1;\n');

		const result = touched(p.model);
		assert.deepEqual(result.repos['.'].entries, [
			`${hash(p, 'apps/web/src/a.ts')} apps/web/src/a.ts`,
			'deleted apps/web/src/b.ts',
			`${hash(p, 'apps/web/src/new.ts')} apps/web/src/new.ts`,
		]);
		assert.deepEqual(result.files, [
			'apps/web/src/a.ts',
			'apps/web/src/b.ts',
			'apps/web/src/new.ts',
		]);
	});

	test('a file dirty at baseline stays out until it is edited again', () => {
		const p = project();
		writeFile(p.root, 'apps/api/src/c.ts', 'export const c = 2;\n');
		saveDirty(p, touched(p.model).repos['.'].entries);
		assert.deepEqual(touched(p.model).files, []);
		assert.deepEqual(touched(p.model).units, []);

		writeFile(p.root, 'apps/web/src/a.ts', 'export const a = 2;\n');
		assert.deepEqual(touched(p.model).files, ['apps/web/src/a.ts']);

		writeFile(p.root, 'apps/api/src/c.ts', 'export const c = 3;\n');
		assert.deepEqual(touched(p.model).files, ['apps/api/src/c.ts', 'apps/web/src/a.ts']);
	});

	test('a dirty file deleted during the task counts as touched', () => {
		const p = project();
		writeFile(p.root, 'apps/api/src/c.ts', 'export const c = 2;\n');
		saveDirty(p, touched(p.model).repos['.'].entries);
		rmSync(join(p.root, 'apps/api/src/c.ts'));
		assert.deepEqual(touched(p.model).repos['.'].entries, ['deleted apps/api/src/c.ts']);
	});

	test('--since-base adds files committed since the base branch', () => {
		const p = project();
		git(p.root, ['checkout', '-q', '-b', 'feature']);
		writeFile(p.root, 'apps/api/src/c.ts', 'export const c = 2;\n');
		git(p.root, ['commit', '-qam', 'change']);
		assert.deepEqual(touched(p.model).files, []);
		assert.deepEqual(touched(p.model, { sinceBase: true }).files, ['apps/api/src/c.ts']);
		assert.deepEqual(touched(p.model, { sinceBase: true }).units, ['api']);
	});

	test('--since-base ignores a base that does not resolve', () => {
		const p = project();
		const model = buildModel(p.root, normalizeConfig({ ...CONFIG, baseBranch: 'nope' }));
		writeFile(p.root, 'apps/web/src/a.ts', 'export const a = 2;\n');
		assert.deepEqual(touched(model, { sinceBase: true }).files, ['apps/web/src/a.ts']);
	});
});

describe('touched units and unit files', () => {
	test('a unit is touched when a file starts with one of its triggers', () => {
		const p = project();
		writeFile(p.root, 'packages/ui/d.ts', 'export const d = 2;\n');
		assert.deepEqual(touched(p.model).units, ['web']);
	});

	test('unitFiles are relative to the unit dir, exist on disk and match the extensions', () => {
		const p = project();
		writeFile(p.root, 'apps/web/src/a.ts', 'export const a = 2;\n');
		writeFile(p.root, 'apps/web/README.md', '# changed\n');
		writeFile(p.root, 'apps/web/data.json', '{}\n');
		rmSync(join(p.root, 'apps/web/src/b.ts'));
		writeFile(p.root, 'packages/ui/d.ts', 'export const d = 2;\n');
		const result = touched(p.model);
		assert.deepEqual(unitFiles(p.model, result, 'web'), {
			files: ['src/a.ts', 'data.json'],
			code: ['src/a.ts'],
		});
	});

	test('in a workspace, files are mapped to project-root paths per repo', () => {
		const w = createWorkspace({
			repos: { be: { 'a.ts': '' }, ui: { 'b.ts': '' } },
		});
		const model = buildModel(
			w.root,
			normalizeConfig({ version: 1, units: { be: { dir: 'be' }, ui: { dir: 'ui' } } })
		);
		writeFile(w.root, 'ui/b.ts', 'x\n');
		const result = touched(model);
		assert.deepEqual(result.repos.ui.files, ['b.ts']);
		assert.deepEqual(result.repos.ui.projectFiles, ['ui/b.ts']);
		assert.deepEqual(result.repos.be.files, []);
		assert.deepEqual(result.units, ['ui']);
	});
});
