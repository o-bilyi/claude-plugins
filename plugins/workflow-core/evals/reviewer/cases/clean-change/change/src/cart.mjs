export function cartTotal(cart) {
	return cart.items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
}

export function itemCount(cart) {
	return cart.items.reduce((sum, item) => sum + item.qty, 0);
}
