import { Chart } from 'chart.js';

export function drawChart(canvas: HTMLCanvasElement, data: number[]): Chart {
	return new Chart(canvas, {
		type: 'line',
		data: { labels: data.map(String), datasets: [{ data }] },
	});
}
