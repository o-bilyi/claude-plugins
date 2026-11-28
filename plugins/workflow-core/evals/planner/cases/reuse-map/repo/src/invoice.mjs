import { formatCents } from './money.mjs';

export function invoiceTotal(lines) {
	const cents = lines.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
	return `Total: ${formatCents(cents)}`;
}
