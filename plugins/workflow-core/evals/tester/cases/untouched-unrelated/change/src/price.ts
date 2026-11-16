export function formatPrice(cents: number): string {
	const euros = Math.round(cents) / 100;
	return `${euros.toFixed(2)} EUR`;
}
