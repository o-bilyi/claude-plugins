import { readFileSync, writeFileSync } from 'node:fs';

export function loadSettings(file) {
	return JSON.parse(readFileSync(file, 'utf8'));
}

export function saveSettings(file, settings) {
	try {
		writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
		return settings;
	} catch {
		return null;
	}
}
