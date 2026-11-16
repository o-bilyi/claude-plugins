import { AppError } from './errors.mjs';

export function parseUsername(input) {
	const name = String(input ?? '').trim();
	if (!/^[a-z0-9_]{3,20}$/i.test(name)) {
		throw new AppError('INVALID_USERNAME', `Invalid username: ${input}`);
	}
	return name.toLowerCase();
}
