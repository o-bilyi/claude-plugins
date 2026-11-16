import type { Task } from '../../../packages/api/src/types';

export function TaskRow({ task }: { task: Task }) {
	return <li className={task.done ? 'done' : ''}>{task.title}</li>;
}
