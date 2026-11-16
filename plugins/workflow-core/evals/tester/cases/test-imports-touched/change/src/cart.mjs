export function cartTotal(items, { discount = 0 } = {}) {
	const gross = items.reduce((sum, item) => sum + item.price * item.qty, 0);
	return Math.round(gross * (1 - discount));
}
