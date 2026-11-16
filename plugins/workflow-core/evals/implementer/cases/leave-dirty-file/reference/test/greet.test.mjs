import assert from 'node:assert/strict';
import { test } from 'node:test';
import { greet } from '../src/greet.mjs';

test('greet says hi by name', () => {
	assert.equal(greet('Ada'), 'Hi, Ada!');
});

test('greet with formal: true uses the formal greeting', () => {
	assert.equal(greet('Ada', { formal: true }), 'Good day, Ada.');
});
