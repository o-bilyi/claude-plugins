export function createPost(title, body) {
	return { title: title.trim(), body, createdAt: new Date().toISOString() };
}
