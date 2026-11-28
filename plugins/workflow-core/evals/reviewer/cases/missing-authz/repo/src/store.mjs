const projects = new Map([
	[1, { id: 1, ownerId: 10, name: 'Site' }],
	[2, { id: 2, ownerId: 20, name: 'App' }],
]);

export function findProject(id) {
	return projects.get(id) ?? null;
}

export function removeProject(id) {
	return projects.delete(id);
}
