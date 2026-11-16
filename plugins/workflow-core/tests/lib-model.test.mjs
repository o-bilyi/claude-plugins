import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { normalizeConfig } from '../scripts/lib/config.mjs';
import { buildModel, formatFor } from '../scripts/lib/model.mjs';
import { cleanup, createWorkspace, git, writeFile } from './helpers.mjs';

after(cleanup);

const REPOS = {
	be: {
		'src/a.ts': 'export const a = 1;\n',
		'api/x.ts': 'export const x = 1;\n',
		'README.md': '# be\n',
	},
	ui: { 'src/b.ts': 'export const b = 1;\n', 'styles.css': 'a {}\n' },
	mobile: { 'app.ts': 'export const m = 1;\n' },
};

function workspace(config) {
	const w = createWorkspace({ config, repos: REPOS, files: { 'docs/notes.md': '# docs\n' } });
	git(join(w.root, 'be'), ['update-ref', 'refs/remotes/origin/trunk', 'HEAD']);
	git(join(w.root, 'be'), [
		'symbolic-ref',
		'refs/remotes/origin/HEAD',
		'refs/remotes/origin/trunk',
	]);
	return { ...w, model: buildModel(w.root, normalizeConfig(config)) };
}

const UNITS = {
	be: { dir: 'be' },
	ui: { dir: 'ui' },
	mobile: { dir: 'mobile' },
	docs: { dir: 'docs' },
};

describe('repos in a multi-repo workspace', () => {
	test('units are grouped by their git work tree; a unit outside git is an orphan', () => {
		const { model, realRoot } = workspace({ version: 1, units: UNITS });
		assert.deepEqual(Object.keys(model.repos).sort(), ['be', 'mobile', 'ui']);
		assert.equal(model.repos.be.path, join(realRoot, 'be'));
		assert.deepEqual(model.repos.be.units, ['be']);
		assert.deepEqual(model.orphans, ['docs']);
		assert.equal(model.units.docs.repo, null);
		assert.equal(model.units.ui.repo, 'ui');
	});

	test('baseBranch comes from origin/HEAD, else main; prTarget falls back to it', () => {
		const { model } = workspace({ version: 1, units: UNITS });
		assert.equal(model.repos.be.baseBranch, 'trunk');
		assert.equal(model.repos.be.baseSource, 'origin/HEAD');
		assert.equal(model.repos.be.prTarget, 'trunk');
		assert.equal(model.repos.ui.baseBranch, 'main');
		assert.equal(model.repos.ui.baseSource, 'default');
		assert.equal(model.repos.ui.prTarget, 'main');
	});

	test('repos overrides beat top-level values, which beat origin/HEAD', () => {
		const { model } = workspace({
			version: 1,
			baseBranch: 'develop',
			prTarget: 'staging',
			repos: { './mobile/': { baseBranch: 'trunk', prTarget: 'main' } },
			units: UNITS,
		});
		assert.equal(model.repos.be.baseBranch, 'develop');
		assert.equal(model.repos.be.baseSource, 'config');
		assert.equal(model.repos.be.prTarget, 'staging');
		assert.equal(model.repos.mobile.baseBranch, 'trunk');
		assert.equal(model.repos.mobile.baseSource, 'repos');
		assert.equal(model.repos.mobile.prTarget, 'main');
	});

	test('a repo override with only prTarget keeps the resolved base branch', () => {
		const { model } = workspace({
			version: 1,
			repos: { be: { prTarget: 'staging' } },
			units: UNITS,
		});
		assert.equal(model.repos.be.baseBranch, 'trunk');
		assert.equal(model.repos.be.prTarget, 'staging');
	});

	test('the state dir is the absolute git-path of each repo', () => {
		const { model, realRoot } = workspace({ version: 1, units: UNITS });
		assert.equal(model.repos.be.state, join(realRoot, 'be', '.git', 'workflow-core'));
	});

	test('a root repo gets the key "."', () => {
		const w = createWorkspace({ repos: { '.': { 'a.ts': '' } } });
		const model = buildModel(w.root, normalizeConfig({ version: 1, app: {} }));
		assert.deepEqual(Object.keys(model.repos), ['.']);
		assert.equal(model.units.app.repo, '.');
	});
});

describe('formatFor', () => {
	const top = runFrom => ({ command: 'topfmt', extensions: ['ts'], runFrom });

	test('runFrom root runs from the project root with a root-relative path', () => {
		const { model, realRoot } = workspace({ version: 1, units: UNITS, format: top('root') });
		assert.deepEqual(model.formatFor('be/src/a.ts'), {
			command: 'topfmt',
			cwd: realRoot,
			file: 'be/src/a.ts',
		});
	});

	test('runFrom repo runs from the file repo', () => {
		const { model, realRoot } = workspace({ version: 1, units: UNITS, format: top('repo') });
		assert.deepEqual(model.formatFor('be/src/a.ts'), {
			command: 'topfmt',
			cwd: join(realRoot, 'be'),
			file: 'src/a.ts',
		});
	});

	test('runFrom unit runs from the most specific unit dir', () => {
		const units = { ...UNITS, api: { dir: 'be/api' } };
		const { model, realRoot } = workspace({ version: 1, units, format: top('unit') });
		assert.deepEqual(model.formatFor('be/api/x.ts'), {
			command: 'topfmt',
			cwd: join(realRoot, 'be/api'),
			file: 'x.ts',
		});
		assert.equal(model.formatFor('be/src/a.ts').cwd, join(realRoot, 'be'));
	});

	test('unit format beats repo format, which beats the top-level one', () => {
		const units = {
			...UNITS,
			api: { dir: 'be/api', format: { command: 'unitfmt', extensions: ['ts'], runFrom: 'unit' } },
		};
		const { model, root, realRoot } = workspace({
			version: 1,
			units,
			format: top('root'),
			repos: { ui: { format: { command: 'uifmt', extensions: ['*'], runFrom: 'repo' } } },
		});
		assert.equal(model.formatFor(join(root, 'be/api/x.ts')).command, 'unitfmt');
		assert.deepEqual(model.formatFor('ui/styles.css'), {
			command: 'uifmt',
			cwd: join(realRoot, 'ui'),
			file: 'styles.css',
		});
		assert.equal(model.formatFor('be/src/a.ts').command, 'topfmt');
	});

	test('skips other extensions, missing files and files outside the project', () => {
		const w = workspace({ version: 1, units: UNITS, format: top('root') });
		writeFile(w.sandbox, 'outside.ts', '');
		assert.equal(w.model.formatFor('be/README.md'), null);
		assert.equal(w.model.formatFor('be/src/missing.ts'), null);
		assert.equal(w.model.formatFor(join(w.sandbox, 'outside.ts')), null);
		assert.equal(formatFor(w.root, normalizeConfig({ version: 1 }), 'be/src/a.ts'), null);
	});

	test('runFrom repo for a file outside any repo falls back to the project root', () => {
		const { model, realRoot } = workspace({
			version: 1,
			units: UNITS,
			format: { command: 'f', extensions: ['md'], runFrom: 'repo' },
		});
		assert.deepEqual(model.formatFor('docs/notes.md'), {
			command: 'f',
			cwd: realRoot,
			file: 'docs/notes.md',
		});
	});
});
