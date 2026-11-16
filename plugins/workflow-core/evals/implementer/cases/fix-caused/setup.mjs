import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STATS = `export function sum(nums) {
	let total = 0;
	for (let i = 0; i < nums.length; i++) total += nums[i];
	return total;
}

export function average(nums) {
	if (nums.length === 0) return 0;
	let total = 0;
	for (let i = 1; i < nums.length; i++) total += nums[i];
	return total / nums.length;
}
`;

const TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { average, sum } from '../src/stats.mjs';

test('sum adds all numbers', () => {
	assert.equal(sum([1, 2, 3, 4]), 10);
});

test('sum of an empty list is 0', () => {
	assert.equal(sum([]), 0);
});

test('average is the mean of all numbers', () => {
	assert.equal(average([2, 4, 6, 8]), 5);
});

test('average of an empty list is 0', () => {
	assert.equal(average([]), 0);
});
`;

export async function setup(dir) {
	writeFileSync(join(dir, 'src/stats.mjs'), STATS);
	writeFileSync(join(dir, 'test/stats.test.mjs'), TEST);
}
