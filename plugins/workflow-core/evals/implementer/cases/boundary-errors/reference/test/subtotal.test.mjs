import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkout } from '../src/checkout.mjs';
import { subtotal } from '../src/subtotal.mjs';

test('subtotal sums price times quantity', () => {
	assert.equal(
		subtotal([
			{ priceCents: 250, qty: 2 },
			{ priceCents: 100, qty: 1 },
		]),
		600
	);
});

test('checkout returns the subtotal', () => {
	assert.equal(checkout({ lines: [{ priceCents: 250, qty: 2 }] }).subtotalCents, 500);
});
