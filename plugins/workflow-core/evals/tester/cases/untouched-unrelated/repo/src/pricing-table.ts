import type { Row } from './table';

export function renderRows(rows: Row[]): string {
	return rows.map(row => `<tr><td>${row.label}</td><td>${row.priceLabel}</td></tr>`).join('');
}
