export function subtotal(lines) {
	return lines.reduce((sum, line) => sum + line.priceCents * line.qty, 0);
}
