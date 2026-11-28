import { formatCents } from './money.mjs';

export function receiptLine(item) {
	return `${item.name} x${item.qty}: ${formatCents(item.priceCents * item.qty)}`;
}
