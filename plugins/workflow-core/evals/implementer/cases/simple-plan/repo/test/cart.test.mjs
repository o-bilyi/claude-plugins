import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartTotal } from '../src/cart.mjs';

test('cartTotal sums price times quantity', () => {
	const cart = {
		items: [
			{ price: 250, qty: 2 },
			{ price: 100, qty: 1 },
		],
	};
	assert.equal(cartTotal(cart), 600);
});

test('cartTotal of an empty cart is 0', () => {
	assert.equal(cartTotal({ items: [] }), 0);
});
