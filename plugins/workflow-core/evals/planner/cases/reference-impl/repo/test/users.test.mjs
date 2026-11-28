import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUser } from '../src/handlers/users.mjs';

test('createUser saves a valid user', () => {
	const res = createUser({ email: 'a@b.co', name: 'Ann' });
	assert.equal(res.status, 201);
	assert.equal(res.body.data.name, 'Ann');
});

test('createUser rejects missing fields', () => {
	const res = createUser({ name: 'Ann' });
	assert.equal(res.status, 400);
	assert.equal(res.body.error.message, 'Missing fields: email');
});
