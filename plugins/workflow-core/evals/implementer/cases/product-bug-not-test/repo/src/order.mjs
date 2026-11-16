export function subtotal(items) {
	return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function total(items, taxRate) {
	const net = subtotal(items);
	return Math.round(net * (1 + taxRate) * 100) / 100;
}
