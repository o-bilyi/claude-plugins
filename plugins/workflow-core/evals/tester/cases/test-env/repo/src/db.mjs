export function connectionUrl() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set');
	return new URL(url);
}
