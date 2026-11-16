export function isWeekend(date) {
	const day = date.getUTCDay();
	return day === 0 || day === 5;
}
