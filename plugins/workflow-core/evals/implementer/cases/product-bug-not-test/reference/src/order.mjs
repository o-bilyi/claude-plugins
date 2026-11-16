export function subtotal(items) {
	return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function taxFor(net, taxRate) {
	return Math.round(net * taxRate * 100) / 100;
}

export function total(items, taxRate) {
	const net = subtotal(items);
	return Math.round((net + taxFor(net, taxRate)) * 100) / 100;
}
