import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceNumber } from '../src/invoice.mjs';
import { roundMoney } from '../src/money/index.mjs';

test('invoice numbers are zero-padded', () => {
	assert.equal(invoiceNumber(2026, 42), 'INV-2026-00042');
});

test('invoice amounts are rounded to cents', () => {
	assert.equal(roundMoney(19.994), 19.99);
});
