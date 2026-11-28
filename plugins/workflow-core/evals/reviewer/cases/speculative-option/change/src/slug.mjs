export function slugify(title, { separator = '-', maxLength = Infinity } = {}) {
	return title
		.toLowerCase()
		.replace(/\s+/g, separator)
		.replace(/[^a-z0-9-]/g, '')
		.replace(/^-+|-+$/g, '')
		.slice(0, maxLength);
}
