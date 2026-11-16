import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { cleanup, createProject, readLog, runScript, writeFile } from './helpers.mjs';

after(cleanup);

const HOOK = 'format-file.mjs';
const FORMAT = {
	command: 'node_modules/.bin/prettier --write --log-level warn',
	extensions: ['ts', 'md'],
};
const config = format => ({ version: 1, app: {}, format });
const FILES = { 'src/a.ts': 'export const a = 1;\n', 'notes.md': '# notes\n', 'data.json': '{}\n' };

function edit(p, filePath, env = {}) {
	const input = JSON.stringify({ tool_input: { file_path: filePath } });
	return runScript(HOOK, [], { root: p.root, input, env: { STUB_LOG: p.log, ...env } });
}

describe('format-file hook', () => {
	test('formats a configured extension inside the project', () => {
		const p = createProject({ config: config(FORMAT), files: FILES, stubs: { '': ['prettier'] } });
		const r = edit(p, join(p.root, 'src/a.ts'));
		assert.equal(r.status, 0, r.stderr);
		assert.ok(readLog(p.log).includes(' prettier --write --log-level warn src/a.ts'));
	});

	test('a relative file path is resolved against the project root', () => {
		const p = createProject({ config: config(FORMAT), files: FILES, stubs: { '': ['prettier'] } });
		edit(p, 'notes.md');
		assert.ok(readLog(p.log).includes(' prettier --write --log-level warn notes.md'));
	});

	test('skips extensions that are not configured', () => {
		const p = createProject({ config: config(FORMAT), files: FILES, stubs: { '': ['prettier'] } });
		const r = edit(p, join(p.root, 'data.json'));
		assert.equal(r.status, 0);
		assert.equal(readLog(p.log), '');
	});

	test('skips files outside the project', () => {
		const p = createProject({ config: config(FORMAT), files: FILES, stubs: { '': ['prettier'] } });
		writeFile(p.sandbox, 'outside.ts', 'export const o = 1;\n');
		const r = edit(p, join(p.sandbox, 'outside.ts'));
		assert.equal(r.status, 0);
		assert.equal(readLog(p.log), '');
	});

	test('a bare format command (no slash) runs from PATH', () => {
		const bare = { ...FORMAT, command: 'prettier --write' };
		const p = createProject({ config: config(bare), files: FILES, stubs: { '': ['prettier'] } });
		const env = { PATH: `${join(p.root, 'node_modules/.bin')}${delimiter}${process.env.PATH}` };
		const r = edit(p, join(p.root, 'src/a.ts'), env);
		assert.equal(r.status, 0, r.stderr);
		assert.ok(readLog(p.log).includes(' prettier --write src/a.ts'));
	});

	test('always exits 0, even when the formatter fails or the input is not JSON', () => {
		const p = createProject({ config: config(FORMAT), files: FILES, stubs: { '': ['prettier'] } });
		const failed = edit(p, join(p.root, 'src/a.ts'), { STUB_FAIL: 'prettier' });
		assert.equal(failed.status, 0);

		const garbage = runScript(HOOK, [], { root: p.root, input: '{not json' });
		assert.equal(garbage.status, 0);

		const noProject = runScript(HOOK, [], { root: '', input: '{}' });
		assert.equal(noProject.status, 0);
	});

	test('a config without version 1 formats nothing', () => {
		const { version, ...unversioned } = config(FORMAT);
		const p = createProject({ config: unversioned, files: FILES, stubs: { '': ['prettier'] } });
		const r = edit(p, join(p.root, 'src/a.ts'));
		assert.equal(r.status, 0);
		assert.equal(readLog(p.log), '');
	});
});
