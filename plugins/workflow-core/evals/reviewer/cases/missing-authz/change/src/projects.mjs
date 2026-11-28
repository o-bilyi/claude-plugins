import { HttpError } from './errors.mjs';
import { findProject, removeProject } from './store.mjs';

export function deleteProject(user, id) {
	const project = findProject(id);
	if (!project) throw new HttpError(404, 'Not found');
	removeProject(id);
	return { deleted: id };
}
