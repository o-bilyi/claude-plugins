let nextId = 1;

export function saveUser(user) {
	return { id: nextId++, ...user };
}

export function saveProject(project) {
	return { id: nextId++, ...project };
}
