import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { asPath } from './scope.mjs';

export const PLAN_KINDS = ['feature', 'bug'];

const HEADING = /^#{1,6}\s+(.*)$/;
const BOLD = /^\s*(?:[-*]|\d+\.)?\s*\*\*([^*]+)\*\*/;
const FENCE = /^\s*```/;

// The parts of a plan: a heading (`## Steps`) or a bold list item (`- **Steps:**`) starts a part. The
// lines in code fences belong to their part, but they are not read as text.
function parts(text) {
	const list = [{ title: '', lines: [] }];
	let fenced = false;
	for (const line of text.split('\n')) {
		if (FENCE.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		const title = line.match(HEADING)?.[1] ?? line.match(BOLD)?.[1];
		if (title) list.push({ title: title.trim(), lines: [line] });
		else list.at(-1).lines.push(line);
	}
	return list.map(p => ({ title: p.title, body: p.lines.join('\n') }));
}

const findPart = (list, re) => list.find(p => re.test(p.title));

const valueOf = (body, name) =>
	body
		.match(new RegExp(`^\\W*${name}\\W*:\\s*(.+)$`, 'im'))?.[1]
		.replace(/^`|`$/g, '')
		.trim() ?? null;

// `Kind: bug` in the plan, else feature.
export function planKind(text) {
	return valueOf(text ?? '', 'kind')?.toLowerCase() ?? 'feature';
}

// The `Reproduction` part of a bug plan: the unit and the command that shows the bug, or the manual
// steps. Null when the plan has no such part.
export function reproduction(text) {
	const part = findPart(parts(text ?? ''), /\breproduction\b/i);
	if (!part) return null;
	return {
		unit: valueOf(part.body, 'unit'),
		command: valueOf(part.body, 'command'),
		manual: valueOf(part.body, 'manual'),
		expect: valueOf(part.body, 'expect'),
	};
}

function ids(text, letter) {
	const re = new RegExp(`^\\s*(?:[-*]|\\d+\\.)?\\s*\\**\\s*(${letter}\\d+)\\b`);
	return text.split('\n').flatMap(line => line.match(re)?.[1] ?? []);
}

function duplicates(list) {
	return [...new Set(list.filter((id, i) => list.indexOf(id) !== i))];
}

// A plan path exists when it is relative to the project root, to a repo or to a unit.
function pathExists(model, path) {
	const bases = [
		model.root,
		...Object.values(model.repos).map(r => r.path),
		...Object.values(model.units).map(u => u.path),
	];
	return bases.some(base => existsSync(join(base, path)));
}

// Checks that a plan has the parts that the workflow uses. Quick plans need fewer parts. A bug plan also
// needs a reproduction.
export function checkPlan(model, text, { mode, kind } = {}) {
	const list = parts(text);
	const all = list.map(p => p.body).join('\n');
	const chosenKind = kind ?? planKind(text);
	const problems = [];
	const add = message => problems.push(message);

	const execution = findPart(list, /\bexecution\b/i);
	const planMode = execution ? valueOf(execution.body, 'mode')?.toLowerCase() : null;
	const chosenMode = mode ?? planMode ?? 'full';
	if (!execution) add('no `## Execution` part');
	else if (!planMode) add('the `## Execution` part has no `Mode: quick|full` line');
	if (!PLAN_KINDS.includes(chosenKind)) add(`Kind must be one of ${PLAN_KINDS.join(', ')}`);

	const steps = ids(all, 'S');
	const criteria = ids(all, 'A');
	if (steps.length === 0) add('no steps with the IDs S1, S2 and so on');
	if (criteria.length === 0) add('no acceptance criteria with the IDs A1, A2 and so on');
	for (const id of duplicates([...steps, ...criteria])) add(`the ID ${id} is used two times`);

	if (!findPart(list, /\breuse map\b/i)) add('no Reuse map part');
	const outOfScope = findPart(list, /\b(out of scope|non-goals?)\b/i);
	if (!outOfScope) add('no Out of scope part');
	if (chosenMode === 'full') {
		const size = findPart(list, /\bsize estimate\b/i);
		if (!size) add('no Size estimate part');
		else if (!/\d/.test(size.body)) add('the Size estimate part has no number');
	}

	if (chosenKind === 'bug') {
		const repro = reproduction(text);
		if (!repro) add('a bug plan needs a `## Reproduction` part');
		else if (!repro.command && !repro.manual) {
			add('the Reproduction part needs a `Command:` line, or a `Manual:` line');
		} else if (repro.command && repro.unit && !model.units[repro.unit]) {
			add(`the Reproduction unit ${repro.unit} is not a unit of the config`);
		} else if (repro.command && !repro.unit && Object.keys(model.units).length > 1) {
			add('the Reproduction part needs a `Unit:` line: the config has more than one unit');
		}
	}

	// A path that does not exist is new when a line of the plan says so ("(new)", "create").
	const lines = list.filter(p => p !== outOfScope).flatMap(p => p.body.split('\n'));
	const pathsOn = line => [...line.matchAll(/`([^`\s]+)`/g)].map(m => asPath(m[1])).filter(Boolean);
	const marked = new Set(lines.filter(l => /\b(new|create[sd]?)\b/i.test(l)).flatMap(pathsOn));
	for (const path of new Set(lines.flatMap(pathsOn))) {
		if (!marked.has(path) && !pathExists(model, path)) {
			add(`\`${path}\` does not exist: write "(new)" on a line that names a new file`);
		}
	}
	return {
		ok: problems.length === 0,
		mode: chosenMode,
		kind: chosenKind,
		problems: [...new Set(problems)],
	};
}

export function renderPlanCheck(result) {
	if (result.ok) return `Plan check: ok (mode=${result.mode}, kind=${result.kind}).`;
	return [
		`Plan check: ${result.problems.length} problem(s) (mode=${result.mode}, kind=${result.kind}):`,
		...result.problems.map(p => `- ${p}`),
		'NEXT: fix the plan, then start the run again',
	].join('\n');
}
