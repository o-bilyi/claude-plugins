export function parseFilters(query) {
	const filters = {};
	for (const [key, value] of new URLSearchParams(query)) {
		if (!(key in filters)) filters[key] = value;
		else if (Array.isArray(filters[key])) filters[key].push(value);
		else filters[key] = [filters[key], value];
	}
	return filters;
}
