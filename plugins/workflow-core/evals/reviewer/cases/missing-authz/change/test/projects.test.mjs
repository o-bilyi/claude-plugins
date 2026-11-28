import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deleteProject } from '../src/projects.mjs';

test('the owner deletes a project', () => {
	assert.deepEqual(deleteProject({ id: 10 }, 1), { deleted: 1 });
});

test('a missing project is 404', () => {
	assert.throws(() => deleteProject({ id: 10 }, 99), /Not found/);
});
