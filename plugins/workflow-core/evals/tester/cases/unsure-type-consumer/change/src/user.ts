export interface User {
	id: number;
	fullName: string;
	email: string;
}

export function displayName(user: User): string {
	return user.fullName;
}
