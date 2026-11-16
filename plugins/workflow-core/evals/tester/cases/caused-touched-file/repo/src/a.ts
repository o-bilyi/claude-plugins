export function total(prices: number[]): number {
	let sum = 0;
	const tax = 0;
	for (const price of prices) sum += price;
	return sum + tax;
}
