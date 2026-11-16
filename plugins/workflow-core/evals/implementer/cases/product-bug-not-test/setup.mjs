import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ORDER = `export function subtotal(items) {
	return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function taxFor(net, taxRate) {
	return Math.floor(net * taxRate * 100) / 100;
}

export function total(items, taxRate) {
	const net = subtotal(items);
	return Math.round((net + taxFor(net, taxRate)) * 100) / 100;
}
`;

export async function setup(dir) {
	writeFileSync(join(dir, 'src/order.mjs'), ORDER);
}
