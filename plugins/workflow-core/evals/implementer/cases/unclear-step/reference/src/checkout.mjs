import { formatPrice } from './format.mjs';
import { shippingFee } from './shipping.mjs';

export function summary(subtotalCents) {
	const shipping = shippingFee(subtotalCents);
	return {
		subtotal: formatPrice(subtotalCents),
		shipping: formatPrice(shipping),
		total: formatPrice(subtotalCents + shipping),
	};
}
