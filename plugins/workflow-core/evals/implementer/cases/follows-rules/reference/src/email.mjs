import { AppError } from './errors.mjs';

export function parseEmail(input) {
	const value = String(input ?? '').trim();
	const match = value.match(/^([^\s@]+)@([^\s@]+\.[^\s@]+)$/);
	if (!match) throw new AppError('INVALID_EMAIL', `Invalid email: ${input}`);
	return { local: match[1], domain: match[2].toLowerCase() };
}
