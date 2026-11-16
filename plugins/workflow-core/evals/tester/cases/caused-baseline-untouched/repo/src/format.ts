export function formatAmount(value, currency = 'EUR'): string {
	return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value);
}
