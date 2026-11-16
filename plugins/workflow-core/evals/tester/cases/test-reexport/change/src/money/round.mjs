export function roundMoney(amount, step = 0.05) {
	return Math.round(amount / step) * step;
}
