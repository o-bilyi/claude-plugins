import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyDiscount, cartTotal } from '../src/cart.mjs';

const cart = {
	items: [
		{ price: 250, qty: 2 },
		{ price: 100, qty: 1 },
	],
};

test('cartTotal sums price times quantity', () => {
	assert.equal(cartTotal(cart), 600);
});

test('cartTotal of an empty cart is 0', () => {
	assert.equal(cartTotal({ items: [] }), 0);
});

test('applyDiscount SAVE10 takes 10% off', () => {
	assert.equal(applyDiscount(cart, 'SAVE10'), 540);
});

test('applyDiscount HALF halves the total', () => {
	assert.equal(applyDiscount(cart, 'HALF'), 300);
});

test('applyDiscount throws on an unknown code', () => {
	assert.throws(() => applyDiscount(cart, 'NOPE'), /Unknown discount code/);
});
