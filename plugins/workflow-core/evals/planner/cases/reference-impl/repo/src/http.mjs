export function created(data) {
	return { status: 201, body: { data } };
}

export function badRequest(message) {
	return { status: 400, body: { error: { message } } };
}

export function requireFields(body, fields) {
	const missing = fields.filter(field => body?.[field] === undefined || body[field] === '');
	return missing.length ? `Missing fields: ${missing.join(', ')}` : null;
}
