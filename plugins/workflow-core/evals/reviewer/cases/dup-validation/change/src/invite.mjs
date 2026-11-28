export function inviteUser(email) {
	if (!/^[^@]+@[^@]+$/.test(email)) throw new Error('Invalid email');
	return { email, invited: true };
}
