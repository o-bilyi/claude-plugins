const DISCOUNTS = {
	SAVE10: total => total - Math.round(total * 0.1),
	HALF: total => Math.round(total / 2),
};

export function cartTotal(cart) {
	return cart.items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function applyDiscount(cart, code) {
	const discount = DISCOUNTS[code];
	if (!discount) throw new Error(`Unknown discount code: ${code}`);
	return discount(cartTotal(cart));
}
