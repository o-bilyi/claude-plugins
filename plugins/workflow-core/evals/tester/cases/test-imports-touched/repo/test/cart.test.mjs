import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartTotal } from '../src/cart.mjs';

test('cartTotal sums price times quantity', () => {
	assert.equal(
		cartTotal([
			{ price: 2.5, qty: 3 },
			{ price: 1.25, qty: 2 },
		]),
		10
	);
});

test('cartTotal keeps cents', () => {
	assert.equal(cartTotal([{ price: 0.99, qty: 1 }]), 0.99);
});
