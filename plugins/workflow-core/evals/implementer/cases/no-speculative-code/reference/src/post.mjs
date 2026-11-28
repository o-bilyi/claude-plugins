import { slugify } from './slug.mjs';

export function createPost(title, body) {
	return { title: title.trim(), slug: slugify(title), body, createdAt: new Date().toISOString() };
}
