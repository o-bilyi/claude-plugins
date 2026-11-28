import { isEmail } from './validate.mjs';

export function signUp(email) {
	if (!isEmail(email)) throw new Error('Invalid email');
	return { email: email.trim(), invited: false };
}
