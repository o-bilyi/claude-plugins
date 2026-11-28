import { subtotal } from './subtotal.mjs';
import { validateCheckout } from './validate.mjs';

export function checkout(body) {
	validateCheckout(body);
	return { items: body.lines.length, subtotalCents: subtotal(body.lines) };
}
