export function shippingFee(subtotalCents) {
	if (subtotalCents >= 5000) return 0;
	if (subtotalCents >= 2500) return 299;
	return 599;
}
