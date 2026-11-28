import { badRequest, created, requireFields } from '../http.mjs';
import { saveUser } from '../store.mjs';

export function createUser(body) {
	const error = requireFields(body, ['email', 'name']);
	if (error) return badRequest(error);
	return created(saveUser({ email: body.email, name: body.name }));
}
