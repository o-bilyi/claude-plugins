import assert from 'node:assert/strict';
import { test } from 'node:test';
import { receiptLine } from '../src/receipt.mjs';

test('receiptLine shows name, quantity and line total', () => {
	assert.equal(receiptLine({ name: 'Tea', priceCents: 450, qty: 3 }), 'Tea x3: $13.50');
});

test('receiptLine uses thousands separators', () => {
	assert.equal(receiptLine({ name: 'Desk', priceCents: 60000, qty: 2 }), 'Desk x2: $1,200.00');
});

test('receiptLine shows a refund as a negative amount', () => {
	assert.equal(receiptLine({ name: 'Return', priceCents: -500, qty: 1 }), 'Return x1: -$5.00');
});
