import { execFileSync, spawnSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
const sandboxes = [];

const STUB = `#!/bin/sh
name=$(basename "$0")
echo "$(pwd -P) $name $*" >> "$STUB_LOG"
if [ -n "$STUB_DIR" ] && [ -f "$STUB_DIR/$name.out" ]; then cat "$STUB_DIR/$name.out"; fi
if [ -n "$STUB_DIR" ] && [ -f "$STUB_DIR/$name.code" ]; then exit "$(cat "$STUB_DIR/$name.code")"; fi
case " $STUB_FAIL " in
  *" $name "*) echo "$name failed"; exit 1 ;;
esac
exit 0
`;

export function git(root, args) {
	return execFileSync(
		'git',
		[
			'-c',
			'user.name=test',
			'-c',
			'user.email=test@example.com',
			'-c',
			'commit.gpgsign=false',
			...args,
		],
		{ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
	);
}

export function writeFile(root, path, content) {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

function stubBins(root, dir, names) {
	const bin = join(root, dir, 'node_modules', '.bin');
	mkdirSync(bin, { recursive: true });
	for (const name of names) {
		const file = join(bin, name);
		writeFileSync(file, STUB);
		chmodSync(file, 0o755);
	}
}

// A git repo with one commit holding every file, so later edits are the "change".
// `stubs` maps an app dir (relative to the root) to the stub binaries it gets.
export function createProject({ config, files = {}, stubs = {} } = {}) {
	const sandbox = mkdtempSync(join(tmpdir(), 'workflow-core-'));
	sandboxes.push(sandbox);
	const root = join(sandbox, 'repo');
	mkdirSync(root);

	const all = { '.gitignore': 'node_modules/\n', ...files };
	if (config !== undefined)
		all['.claude/workflow.config.json'] = `${JSON.stringify(config, null, '\t')}\n`;
	for (const [path, content] of Object.entries(all)) writeFile(root, path, content);

	git(root, ['init', '-q', '-b', 'main']);
	git(root, ['add', '-A']);
	git(root, ['commit', '-q', '-m', 'init']);

	for (const [dir, names] of Object.entries(stubs)) stubBins(root, dir, names);
	return { sandbox, root, realRoot: realpathSync(root), log: join(sandbox, 'stub.log') };
}

// A project root that is not a git repo, holding one committed git repo per `repos` entry.
export function createWorkspace({ config, files = {}, repos = {}, stubs = {} } = {}) {
	const sandbox = mkdtempSync(join(tmpdir(), 'workflow-core-'));
	sandboxes.push(sandbox);
	const root = join(sandbox, 'workspace');
	mkdirSync(root);
	if (config !== undefined) {
		writeFile(root, '.claude/workflow.config.json', `${JSON.stringify(config, null, '\t')}\n`);
	}
	for (const [path, content] of Object.entries(files)) writeFile(root, path, content);
	for (const [dir, repoFiles] of Object.entries(repos)) {
		const repo = join(root, dir);
		const all = { '.gitignore': 'node_modules/\n', ...repoFiles };
		for (const [path, content] of Object.entries(all)) writeFile(repo, path, content);
		git(repo, ['init', '-q', '-b', 'main']);
		git(repo, ['add', '-A']);
		git(repo, ['commit', '-q', '-m', 'init']);
	}
	for (const [dir, names] of Object.entries(stubs)) stubBins(root, dir, names);
	return { sandbox, root, realRoot: realpathSync(root), log: join(sandbox, 'stub.log') };
}

// Makes stub `name` print `stdout` and exit with `code` (needs STUB_DIR = <sandbox>/out).
export function stubOutput(p, name, stdout, code = 0) {
	writeFile(p.sandbox, `out/${name}.out`, stdout);
	writeFile(p.sandbox, `out/${name}.code`, String(code));
}

export function readLog(log) {
	return existsSync(log) ? readFileSync(log, 'utf8') : '';
}

// Runs one of the real scripts with CLAUDE_PROJECT_DIR set to `root`.
export function runScript(script, args = [], { root, input = '', env = {} } = {}) {
	return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
		input,
		encoding: 'utf8',
		env: { ...process.env, CLAUDE_PROJECT_DIR: root, STUB_FAIL: '', ...env },
	});
}

export function cleanup() {
	for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
}
