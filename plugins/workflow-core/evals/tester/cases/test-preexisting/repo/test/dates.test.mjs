import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWeekend } from '../src/dates.mjs';

test('Saturday and Sunday are weekend days', () => {
	assert.equal(isWeekend(new Date('2026-11-14T12:00:00Z')), true);
	assert.equal(isWeekend(new Date('2026-11-15T12:00:00Z')), true);
});

test('Friday is not a weekend day', () => {
	assert.equal(isWeekend(new Date('2026-11-13T12:00:00Z')), false);
});
