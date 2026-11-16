import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clamp, lerp } from '../src/math.mjs';

test('clamp keeps values inside the range', () => {
	assert.equal(clamp(5, 0, 10), 5);
	assert.equal(clamp(-1, 0, 10), 0);
	assert.equal(clamp(11, 0, 10), 10);
});

test('lerp interpolates between two numbers', () => {
	assert.equal(lerp(0, 10, 0.5), 5);
	assert.equal(lerp(2, 4, 0), 2);
});
