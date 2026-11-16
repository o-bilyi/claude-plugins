export interface Line {
	qty: number;
	price: number;
}

export function total(lines: Line[]): number {
	return lines.reduce((sum, line) => sum + line.qty * line.price, 0);
}
