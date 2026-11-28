import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cartTotal } from '../src/cart.mjs';

test('cartTotal sums the items', () => {
	assert.equal(cartTotal({ items: [{ priceCents: 200, qty: 3 }] }), 600);
});
