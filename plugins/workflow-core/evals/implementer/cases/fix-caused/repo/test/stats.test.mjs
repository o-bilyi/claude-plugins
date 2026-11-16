import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sum } from '../src/stats.mjs';

test('sum adds all numbers', () => {
	assert.equal(sum([1, 2, 3, 4]), 10);
});

test('sum of an empty list is 0', () => {
	assert.equal(sum([]), 0);
});
