import type { Task } from './types';

export function openCount(tasks: Task[]): number {
	const open = tasks.filter(task => !task.done);
	return open.length;
}
