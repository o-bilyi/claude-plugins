export function validateCheckout(body) {
	const valid =
		Array.isArray(body?.lines) &&
		body.lines.length > 0 &&
		body.lines.every(
			line =>
				Number.isInteger(line.priceCents) &&
				line.priceCents >= 0 &&
				Number.isInteger(line.qty) &&
				line.qty >= 1
		);
	if (!valid) throw new Error('Invalid checkout');
}
