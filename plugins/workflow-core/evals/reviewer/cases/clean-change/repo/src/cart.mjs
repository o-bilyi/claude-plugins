export function cartTotal(cart) {
	return cart.items.reduce((sum, item) => sum + item.priceCents * item.qty, 0);
}
