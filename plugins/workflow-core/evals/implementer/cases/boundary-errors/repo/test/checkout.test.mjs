import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkout } from '../src/checkout.mjs';

test('checkout counts the lines', () => {
	assert.equal(checkout({ lines: [{ priceCents: 100, qty: 1 }] }).items, 1);
});

test('checkout rejects an invalid body', () => {
	assert.throws(() => checkout({ lines: [] }), /Invalid checkout/);
});
