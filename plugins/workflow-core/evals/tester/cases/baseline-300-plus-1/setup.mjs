import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MESSAGES = [
	['TS7006', "Parameter 'props' implicitly has an 'any' type."],
	['TS2339', "Property 'value' does not exist on type 'EventTarget'."],
	['TS2532', "Object is possibly 'undefined'."],
	['TS2345', "Argument of type 'string | null' is not assignable to parameter of type 'string'."],
	['TS18048', "'item' is possibly 'undefined'."],
];

function oldErrors() {
	const lines = [];
	for (let i = 0; i < 300; i++) {
		const [code, message] = MESSAGES[i % MESSAGES.length];
		const file = `src/legacy/module${String(Math.floor(i / 5)).padStart(2, '0')}.tsx`;
		lines.push(`${file}(${10 + (i % 5) * 7},5): error ${code}: ${message}`);
	}
	return lines;
}

function stubDir(dir) {
	const path = execFileSync('git', ['rev-parse', '--git-path', 'workflow-eval'], {
		cwd: dir,
		encoding: 'utf8',
	}).trim();
	const out = resolve(dir, path, '.');
	mkdirSync(out, { recursive: true });
	return out;
}

export function before(dir) {
	for (let m = 0; m < 60; m++) {
		const name = `src/legacy/module${String(m).padStart(2, '0')}.tsx`;
		mkdirSync(join(dir, 'src/legacy'), { recursive: true });
		writeFileSync(
			join(dir, name),
			`export default function Module${m}(props) {\n\treturn null;\n}\n`
		);
	}
	execFileSync('git', ['add', '-A'], { cwd: dir });
	execFileSync(
		'git',
		[
			'-c',
			'user.name=eval',
			'-c',
			'user.email=eval@example.com',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'-qm',
			'legacy modules',
		],
		{ cwd: dir }
	);
	const out = stubDir(dir);
	writeFileSync(join(out, 'tsc.out'), `${oldErrors().join('\n')}\n`);
	writeFileSync(join(out, 'tsc.code'), '2\n');
}

export function after(dir) {
	const out = stubDir(dir);
	const added =
		"src/report/totals.ts(11,9): error TS2322: Type 'string' is not assignable to type 'number'.";
	const lines = oldErrors();
	lines.splice(137, 0, added);
	writeFileSync(join(out, 'tsc.out'), `${lines.join('\n')}\n`);
	writeFileSync(join(out, 'tsc.code'), '2\n');
}
