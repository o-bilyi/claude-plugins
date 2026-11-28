import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../src/handlers/projects.mjs';

test('createProject saves a valid project', () => {
	const res = createProject({ name: 'Site', ownerId: 7 });
	assert.equal(res.status, 201);
	assert.equal(res.body.data.name, 'Site');
	assert.equal(res.body.data.ownerId, 7);
});

test('createProject rejects a missing name', () => {
	const res = createProject({ ownerId: 7 });
	assert.equal(res.status, 400);
	assert.equal(res.body.error.message, 'Missing fields: name');
});
