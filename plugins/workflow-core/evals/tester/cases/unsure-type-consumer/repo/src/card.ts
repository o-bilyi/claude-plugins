import type { User } from './user';

export function userCard(user: User): string {
	return `<div class="card">${user.name} &lt;${user.email}&gt;</div>`;
}
