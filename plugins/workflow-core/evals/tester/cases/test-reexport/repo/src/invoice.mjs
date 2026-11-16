export function invoiceNumber(year, seq) {
	return `INV-${year}-${String(seq).padStart(5, '0')}`;
}
