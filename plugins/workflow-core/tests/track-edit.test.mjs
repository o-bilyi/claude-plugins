import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { cleanup, createProject, createWorkspace, runScript, writeFile } from './helpers.mjs';

after(cleanup);

const CONFIG = { version: 1, units: { app: { dir: '.' } } };

const track = (root, payload) =>
	runScript('track-edit.mjs', [], { root, input: JSON.stringify(payload) });
const sessions = repo => join(repo, '.git', 'workflow-core', 'sessions');

describe('track-edit hook', () => {
	test('records each edited file once, relative to its repo', () => {
		const p = createProject({ config: CONFIG, files: { 'src/a.ts': '' } });
		const edit = file => ({ session_id: 's1', tool_input: { file_path: join(p.root, file) } });
		assert.equal(track(p.root, edit('src/a.ts')).status, 0);
		track(p.root, edit('src/a.ts'));
		track(p.root, { session_id: 's1', tool_input: { notebook_path: join(p.root, 'n.ipynb') } });
		assert.equal(readFileSync(join(sessions(p.root), 's1'), 'utf8'), 'src/a.ts\nn.ipynb\n');
	});

	test('in a workspace the file goes to the repo that holds it', () => {
		const w = createWorkspace({
			config: { version: 1, units: { ui: { dir: 'ui' }, be: { dir: 'be' } } },
			repos: { ui: { 'src/a.ts': '' }, be: { 'b.ts': '' } },
		});
		track(w.root, { session_id: 's1', tool_input: { file_path: join(w.root, 'ui/src/a.ts') } });
		track(w.root, { session_id: 's1', tool_input: { file_path: join(w.root, 'notes.md') } });
		assert.equal(readFileSync(join(sessions(join(w.root, 'ui')), 's1'), 'utf8'), 'src/a.ts\n');
		assert.ok(!existsSync(sessions(join(w.root, 'be'))));
	});

	test('ignores a missing or unsafe session id and never fails', () => {
		const p = createProject({ config: CONFIG, files: { 'a.ts': '' } });
		const file = join(p.root, 'a.ts');
		assert.equal(track(p.root, { tool_input: { file_path: file } }).status, 0);
		assert.equal(track(p.root, { session_id: '../x', tool_input: { file_path: file } }).status, 0);
		assert.equal(runScript('track-edit.mjs', [], { root: p.root, input: 'not json' }).status, 0);
		assert.ok(!existsSync(sessions(p.root)));
	});

	test('drops session files older than a week', () => {
		const p = createProject({ config: CONFIG, files: { 'a.ts': '' } });
		writeFile(sessions(p.root), 'old', 'a.ts\n');
		const weekAgo = Date.now() / 1000 - 8 * 24 * 3600;
		utimesSync(join(sessions(p.root), 'old'), weekAgo, weekAgo);
		track(p.root, { session_id: 'new', tool_input: { file_path: join(p.root, 'a.ts') } });
		assert.deepEqual(readdirSync(sessions(p.root)), ['new']);
	});
});
