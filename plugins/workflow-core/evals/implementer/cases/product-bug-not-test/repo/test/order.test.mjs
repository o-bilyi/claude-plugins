import assert from 'node:assert/strict';
import { test } from 'node:test';
import { subtotal, total } from '../src/order.mjs';

const items = [
	{ price: 10.99, qty: 1 },
	{ price: 2.5, qty: 2 },
];

test('subtotal sums price times quantity', () => {
	assert.equal(subtotal(items), 15.99);
});

test('total adds tax and rounds half up to the cent', () => {
	assert.equal(total(items, 0.08), 17.27);
});

test('total with a zero tax rate is the subtotal', () => {
	assert.equal(total(items, 0), 15.99);
});
