import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summary } from '../src/checkout.mjs';
import { fmt } from '../src/format.mjs';

test('fmt prints dollars with two decimals', () => {
	assert.equal(fmt(1234), '$12.34');
});

test('summary formats subtotal, shipping and total', () => {
	assert.deepEqual(summary(2000), { subtotal: '$20.00', shipping: '$5.99', total: '$25.99' });
});
