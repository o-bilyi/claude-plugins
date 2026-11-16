import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../src/errors.mjs';
import { parseUsername } from '../src/username.mjs';

test('parseUsername trims and lowercases', () => {
	assert.equal(parseUsername('  Ada_99 '), 'ada_99');
});

test('parseUsername throws AppError on invalid input', () => {
	assert.throws(
		() => parseUsername('a!'),
		err => err instanceof AppError && err.code === 'INVALID_USERNAME'
	);
});
