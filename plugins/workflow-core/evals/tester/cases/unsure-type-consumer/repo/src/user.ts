export interface User {
	id: number;
	name: string;
	email: string;
}

export function displayName(user: User): string {
	return user.name;
}
