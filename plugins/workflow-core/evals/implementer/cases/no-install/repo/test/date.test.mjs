import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate } from '../src/date.mjs';

test('formatDate pads month and day', () => {
	assert.equal(formatDate(new Date(Date.UTC(2024, 0, 5, 12))), '2024-01-05');
});

test('formatDate uses the UTC date', () => {
	assert.equal(formatDate(new Date(Date.UTC(2023, 11, 31, 23, 30))), '2023-12-31');
});
