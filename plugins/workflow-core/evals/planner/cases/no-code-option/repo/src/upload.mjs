import { readFileSync } from 'node:fs';

const limits = JSON.parse(readFileSync(new URL('../config/limits.json', import.meta.url), 'utf8'));

export function checkUpload(files) {
	if (files.length > limits.maxFilesPerUpload) throw new Error('Too many files');
	for (const file of files) {
		if (file.bytes > limits.maxUploadMb * 1024 * 1024) throw new Error(`${file.name} is too large`);
	}
	return true;
}
