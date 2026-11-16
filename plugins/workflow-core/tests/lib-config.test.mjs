import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ConfigError, normalizeConfig, UnsupportedVersionError } from '../scripts/lib/config.mjs';

const unit = (checks, extra = {}) => ({
	version: 1,
	units: { web: { dir: 'web', checks, ...extra } },
});
const invalid = (raw, pattern) =>
	assert.throws(
		() => normalizeConfig(raw),
		err => err instanceof ConfigError && pattern.test(err.message)
	);

describe('v1 config defaults', () => {
	test('a minimal config gets every default', () => {
		const config = normalizeConfig({ version: 1 });
		assert.equal(config.configVersion, 1);
		assert.deepEqual(config.pr, { titleFormat: '{summary}' });
		assert.deepEqual(config.units, {});
		assert.deepEqual(config.repos, {});
		assert.deepEqual(config.extensions.code, [
			'ts',
			'tsx',
			'mts',
			'cts',
			'js',
			'jsx',
			'mjs',
			'cjs',
		]);
		assert.ok(config.extensions.changed.includes('json'));
		assert.deepEqual(config.process, {
			maxRounds: 3,
			preflight: { branchTicket: true, baseline: 'auto' },
		});
		assert.deepEqual(config.guards, { protectedPaths: [], blockedCommands: [] });
		assert.deepEqual(config.planner, { extraChecklist: [] });
		assert.equal(config.baseBranch, undefined);
	});

	test('unit defaults: triggers from dir, stopHook true, empty checks', () => {
		const config = normalizeConfig({ version: 1, units: { web: { dir: './apps/web/' } } });
		assert.deepEqual(config.units.web, {
			dir: 'apps/web',
			triggers: ['apps/web/'],
			checks: [],
			stopHook: true,
		});
	});

	test('check defaults: name from kind, stopHook true except for other', () => {
		const config = normalizeConfig(
			unit([
				{ kind: 'lint', run: 'eslint .' },
				{ kind: 'other', run: 'nx build' },
			])
		);
		assert.deepEqual(config.units.web.checks, [
			{ name: 'lint', kind: 'lint', run: 'eslint .', stopHook: true },
			{ name: 'other', kind: 'other', run: 'nx build', stopHook: false },
		]);
	});

	test('".", "./" and "" triggers normalize to the whole repo', () => {
		const config = normalizeConfig(unit([], { triggers: ['', '.', './', 'web/'] }));
		assert.deepEqual(config.units.web.triggers, ['', '', '', 'web/']);
	});

	test('format defaults runFrom to root and accepts "*"', () => {
		const config = normalizeConfig({
			version: 1,
			format: { command: 'prettier --write', extensions: ['*'] },
		});
		assert.deepEqual(config.format, {
			command: 'prettier --write',
			extensions: ['*'],
			runFrom: 'root',
		});
	});

	test('the result is deeply frozen', () => {
		const config = normalizeConfig(unit([{ kind: 'lint', run: 'eslint .' }]));
		assert.ok(Object.isFrozen(config));
		assert.ok(Object.isFrozen(config.units.web.checks[0]));
		assert.throws(() => config.units.web.checks.push({}));
	});
});

describe('app shorthand', () => {
	test('becomes a unit named app at "." with whole-repo triggers', () => {
		const config = normalizeConfig({
			version: 1,
			app: { checks: [{ kind: 'test', run: 'vitest run' }] },
		});
		assert.deepEqual(Object.keys(config.units), ['app']);
		assert.equal(config.units.app.dir, '.');
		assert.deepEqual(config.units.app.triggers, ['']);
		assert.equal(config.units.app.checks[0].name, 'test');
	});

	test('app and units together are rejected', () => {
		invalid({ version: 1, app: {}, units: {} }, /either app or units/);
	});
});

describe('v1 validation', () => {
	test('a config without version 1 asks to re-run init', () => {
		for (const raw of [{ baseBranch: 'main', apps: {} }, { version: 2 }]) {
			assert.throws(
				() => normalizeConfig(raw),
				err =>
					err instanceof UnsupportedVersionError &&
					/unsupported config version; run \/workflow-core:init/.test(err.message)
			);
		}
	});

	test('unit dir is required', () =>
		invalid({ version: 1, units: { web: {} } }, /units\.web\.dir/));

	test('triggers must be a non-empty string array', () => {
		invalid(unit([], { triggers: [] }), /units\.web\.triggers/);
		invalid(unit([], { triggers: [1] }), /units\.web\.triggers/);
	});

	test('check kind must be known and run is required', () => {
		invalid(unit([{ kind: 'build', run: 'x' }]), /checks\[0\]\.kind/);
		invalid(unit([{ kind: 'lint' }]), /checks\[0\]\.run/);
	});

	test('check names must be unique per unit', () => {
		const checks = [
			{ kind: 'lint', run: 'eslint .' },
			{ kind: 'lint', run: 'depcruise' },
		];
		invalid(unit(checks), /duplicate check name "lint"/);
		assert.doesNotThrow(() =>
			normalizeConfig(unit([checks[0], { ...checks[1], name: 'boundaries' }]))
		);
	});

	test('related and fullWhen are only allowed on test checks', () => {
		invalid(unit([{ kind: 'lint', run: 'x', related: 'y {files}' }]), /related is only allowed/);
		invalid(unit([{ kind: 'lint', run: 'x', fullWhen: ['a/'] }]), /fullWhen is only allowed/);
		assert.doesNotThrow(() =>
			normalizeConfig(unit([{ kind: 'test', run: 'x', related: 'y {files}', fullWhen: ['a/'] }]))
		);
	});

	test('parser must be tsc, eslint-json or oxlint', () => {
		invalid(unit([{ kind: 'lint', run: 'x', parser: 'regex' }]), /parser must be one of/);
		for (const parser of ['tsc', 'eslint-json', 'oxlint']) {
			assert.doesNotThrow(() => normalizeConfig(unit([{ kind: 'lint', run: 'x', parser }])));
		}
	});

	test('titleFormat must contain {summary}', () => {
		invalid({ version: 1, pr: { titleFormat: 'fixed' } }, /\{summary\}/);
	});

	test('ticketPattern is required with {ticket} and must be a valid regex', () => {
		invalid({ version: 1, pr: { titleFormat: '{summary}: {ticket}' } }, /pr\.ticketPattern/);
		invalid(
			{ version: 1, pr: { titleFormat: '{summary}: {ticket}', ticketPattern: '([' } },
			/pr\.ticketPattern/
		);
		const config = normalizeConfig({
			version: 1,
			pr: { titleFormat: '{summary}: {ticket}', ticketPattern: 'PROJ-[0-9]+' },
		});
		assert.equal(config.pr.ticketPattern, 'PROJ-[0-9]+');
	});

	test('format runFrom must be root, repo or unit', () => {
		invalid(
			{ version: 1, format: { command: 'p', extensions: ['ts'], runFrom: 'cwd' } },
			/^- format/m
		);
		invalid(unit([], { format: { command: 'p' } }), /units\.web\.format/);
		invalid({ version: 1, repos: { ui: { format: { extensions: [] } } } }, /repos\.ui\.format/);
	});

	test('process values are checked', () => {
		invalid({ version: 1, process: { maxRounds: 0 } }, /maxRounds/);
		invalid({ version: 1, process: { preflight: { baseline: 'always' } } }, /baseline/);
		invalid({ version: 1, process: { preflight: { branchTicket: 'yes' } } }, /branchTicket/);
	});

	test('guards: protectedPaths shape and blockedCommands regexes', () => {
		invalid(
			{ version: 1, guards: { protectedPaths: [{ glob: 'a/**', when: 'always', message: 'm' }] } },
			/protectedPaths\[0\]/
		);
		invalid(
			{ version: 1, guards: { blockedCommands: [{ regex: '(', message: 'm' }] } },
			/blockedCommands\[0\]\.regex is not a valid regular expression/
		);
		const config = normalizeConfig({
			version: 1,
			guards: {
				protectedPaths: [{ glob: 'be/migrations/*.js', when: 'tracked', message: 'm' }],
				blockedCommands: [{ regex: '^npm start', cwd: 'ui', message: 'm' }],
			},
		});
		assert.equal(config.guards.blockedCommands[0].cwd, 'ui');
	});

	test('all errors are reported together', () => {
		assert.throws(
			() => normalizeConfig({ version: 1, pr: { titleFormat: 'x' }, process: { maxRounds: -1 } }),
			err => err.message.includes('{summary}') && err.message.includes('maxRounds')
		);
	});
});
