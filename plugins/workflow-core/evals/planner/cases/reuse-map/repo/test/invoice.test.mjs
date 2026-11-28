import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceTotal } from '../src/invoice.mjs';

test('invoiceTotal formats the sum of all lines', () => {
	assert.equal(
		invoiceTotal([
			{ priceCents: 1250, qty: 2 },
			{ priceCents: 99, qty: 1 },
		]),
		'Total: $25.99'
	);
});

test('invoiceTotal uses thousands separators', () => {
	assert.equal(invoiceTotal([{ priceCents: 123456, qty: 1 }]), 'Total: $1,234.56');
});
