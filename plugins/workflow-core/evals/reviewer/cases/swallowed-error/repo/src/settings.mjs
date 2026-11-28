import { readFileSync } from 'node:fs';

export function loadSettings(file) {
	return JSON.parse(readFileSync(file, 'utf8'));
}
