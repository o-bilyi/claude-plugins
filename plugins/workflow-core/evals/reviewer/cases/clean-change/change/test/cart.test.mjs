import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartTotal, itemCount } from '../src/cart.mjs';

test('cartTotal sums the items', () => {
	assert.equal(cartTotal({ items: [{ priceCents: 200, qty: 3 }] }), 600);
});

test('itemCount sums the quantities', () => {
	assert.equal(
		itemCount({
			items: [
				{ priceCents: 200, qty: 3 },
				{ priceCents: 50, qty: 2 },
			],
		}),
		5
	);
});

test('itemCount of an empty cart is 0', () => {
	assert.equal(itemCount({ items: [] }), 0);
});
