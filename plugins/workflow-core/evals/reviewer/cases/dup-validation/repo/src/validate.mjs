// One email rule for the whole app: one @, a local part, and a domain with a dot.
export function isEmail(value) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}
