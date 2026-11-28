import { badRequest, created, requireFields } from '../http.mjs';
import { saveProject } from '../store.mjs';

export function createProject(body) {
	const error = requireFields(body, ['name', 'ownerId']);
	if (error) return badRequest(error);
	return created(saveProject({ name: body.name, ownerId: body.ownerId }));
}
