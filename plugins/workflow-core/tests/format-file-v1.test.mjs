import assert from 'node:assert/strict';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { cleanup, createWorkspace, readLog, runScript, writeFile } from './helpers.mjs';

after(cleanup);

const STUB = '#!/bin/sh\necho "$(pwd -P) $(basename "$0") $*" >> "$STUB_LOG"\n';

describe('format-file hook with a v1 config', () => {
	test('runFrom repo runs the repo formatter with a repo-relative path', () => {
		const config = {
			version: 1,
			format: {
				command: './node_modules/.bin/prettier --write',
				extensions: ['*'],
				runFrom: 'repo',
			},
			units: { ui: { dir: 'ui' }, be: { dir: 'be' } },
		};
		const w = createWorkspace({
			config,
			repos: { ui: { 'src/a.css': 'a {}\n' }, be: { 'b.ts': '' } },
		});
		writeFile(w.root, 'ui/node_modules/.bin/prettier', STUB);
		chmodSync(join(w.root, 'ui/node_modules/.bin/prettier'), 0o755);
		const log = join(w.sandbox, 'stub.log');
		const edit = file =>
			runScript('format-file.mjs', [], {
				root: w.root,
				input: JSON.stringify({ tool_input: { file_path: join(w.root, file) } }),
				env: { STUB_LOG: log },
			});

		assert.equal(edit('ui/src/a.css').status, 0);
		assert.equal(readLog(log), `${join(w.realRoot, 'ui')} prettier --write src/a.css\n`);

		assert.equal(edit('be/b.ts').status, 0);
		assert.equal(readFileSync(log, 'utf8').split('\n').filter(Boolean).length, 1);
	});
});
