import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRow, legacyTotal } from '../src/report.mjs';

test('formatRow shows name, quantity and status', () => {
	assert.equal(formatRow({ name: 'Tea', qty: 2, status: 'late' }), '| Tea | 2 | late |');
});

test('legacyTotal sums the quantities', () => {
	assert.equal(legacyTotal([{ qty: 2 }, { qty: 3 }]), 5);
});
