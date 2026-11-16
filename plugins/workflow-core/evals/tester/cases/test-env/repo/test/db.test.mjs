import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectionUrl } from '../src/db.mjs';

test('connection url points at postgres', () => {
	assert.equal(connectionUrl().protocol, 'postgres:');
});
