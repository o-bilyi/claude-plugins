import { fmt } from './format.mjs';
import { shippingFee } from './shipping.mjs';

export function summary(subtotalCents) {
	const shipping = shippingFee(subtotalCents);
	return {
		subtotal: fmt(subtotalCents),
		shipping: fmt(shipping),
		total: fmt(subtotalCents + shipping),
	};
}
