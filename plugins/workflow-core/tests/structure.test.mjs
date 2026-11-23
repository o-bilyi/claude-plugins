import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeConfig } from '../scripts/lib/config.mjs';

const PLUGIN = fileURLToPath(new URL('..', import.meta.url));
const MODELS = ['opus', 'sonnet', 'haiku'];
const read = path => readFileSync(join(PLUGIN, path), 'utf8');

function frontmatter(text) {
	const m = text.match(/^---\n([\s\S]*?)\n---\n/);
	if (!m) return null;
	const fields = {};
	for (const line of m[1].split('\n')) {
		const kv = line.match(/^([\w-]+):\s*(.*)$/);
		if (kv) fields[kv[1]] = kv[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
	}
	return fields;
}

const agents = readdirSync(join(PLUGIN, 'agents')).map(f => `agents/${f}`);
const skills = readdirSync(join(PLUGIN, 'skills')).map(d => `skills/${d}/SKILL.md`);
const commands = readdirSync(join(PLUGIN, 'commands')).map(f => `commands/${f}`);
const prompts = [...agents, ...skills, ...commands];
const docs = [...prompts, 'README.md'];

function wcSubcommands() {
	const source = read('scripts/wc.mjs');
	const names = new Set([...source.matchAll(/command === '(\w+)'/g)].map(m => m[1]));
	for (const m of source.matchAll(/^\t\t(\w+): (?:async )?model =>/gm)) names.add(m[1]);
	return names;
}

describe('frontmatter', () => {
	for (const file of agents) {
		test(`${file} has name, description, tools and a known model`, () => {
			const fm = frontmatter(read(file));
			assert.ok(fm, 'no frontmatter');
			assert.equal(`agents/${fm.name}.md`, file);
			assert.ok(fm.description && fm.tools);
			assert.ok(MODELS.includes(fm.model), `model ${fm.model}`);
		});
	}
	for (const file of skills) {
		test(`${file} has name and description`, () => {
			const fm = frontmatter(read(file));
			assert.ok(fm, 'no frontmatter');
			assert.equal(`skills/${fm.name}/SKILL.md`, file);
			assert.ok(fm.description);
			if (fm.model) assert.ok(MODELS.includes(fm.model), `model ${fm.model}`);
		});
	}
	for (const file of commands) {
		test(`${file} has a description`, () => {
			assert.ok(frontmatter(read(file))?.description);
		});
	}
});

describe('references', () => {
	test('every ${CLAUDE_PLUGIN_ROOT} path exists', () => {
		const files = [...docs, 'hooks/hooks.json'];
		for (const file of files) {
			for (const m of read(file).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+)/g)) {
				const path = m[1].replace(/\.+$/, '');
				assert.ok(existsSync(join(PLUGIN, path)), `${file}: ${path} does not exist`);
			}
		}
	});

	test('hooks.json only runs existing scripts', () => {
		const hooks = JSON.parse(read('hooks/hooks.json')).hooks;
		const scripts = Object.values(hooks)
			.flat()
			.flatMap(entry => entry.hooks)
			.map(h => h.command.match(/scripts\/([\w-]+\.mjs)/)[1]);
		assert.ok(scripts.length >= 5);
		for (const script of scripts) assert.ok(existsSync(join(PLUGIN, 'scripts', script)), script);
	});

	test('every wc.mjs subcommand mentioned is real', () => {
		const real = wcSubcommands();
		for (const name of ['doctor', 'check', 'preflight', 'baseline', 'config', 'get']) {
			assert.ok(real.has(name), `parser missed ${name}`);
		}
		for (const file of docs) {
			const text = read(file);
			const used = [
				...text.matchAll(/scripts\/wc\.mjs"?\s+([a-z]+)/g),
				...text.matchAll(/`wc\.mjs ([a-z]+)/g),
				...text.matchAll(/"<wc>"\s+([a-z]+)/g),
			].map(m => m[1]);
			for (const name of used) assert.ok(real.has(name), `${file}: wc.mjs ${name}`);
		}
	});

	test('no inline code span is broken across lines', () => {
		for (const file of docs) {
			let fenced = false;
			read(file)
				.split('\n')
				.forEach((line, i) => {
					if (/^\s*```/.test(line)) fenced = !fenced;
					else if (!fenced) {
						const ticks = (line.match(/`/g) ?? []).length;
						assert.equal(ticks % 2, 0, `${file}:${i + 1}: ${line}`);
					}
				});
		}
	});

	test('planner.md is read with Read, so it cannot use ${CLAUDE_PLUGIN_ROOT}', () => {
		assert.ok(!read('agents/planner.md').includes('${CLAUDE_PLUGIN_ROOT}'));
	});

	test('git runs per repo in every prompt', () => {
		for (const file of prompts) {
			for (const m of read(file).matchAll(/`git ([\w-]+)/g)) {
				assert.ok(['-C', 'init'].includes(m[1]), `${file}: git ${m[1]}`);
			}
		}
	});
});

describe('contracts', () => {
	test('tester and reviewer take the wc.mjs path from the prompt and use touched --json', () => {
		for (const file of ['agents/tester.md', 'agents/reviewer.md']) {
			const text = read(file).replace(/\s+/g, ' ');
			assert.ok(text.includes('the wc.mjs path from your prompt'), file);
			assert.ok(text.includes('${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs'), file);
			assert.ok(text.includes('touched --json'), file);
		}
	});

	test('the tester handles a missing config and untouched lines', () => {
		const text = read('agents/tester.md').replace(/\s+/g, ' ');
		assert.ok(text.includes('no workflow config: checks not run'));
		assert.ok(text.includes('`untouched`'));
	});

	test('tester ends with the exact RESULT formats', () => {
		const text = read('agents/tester.md');
		assert.ok(text.includes('RESULT: PASS\n'));
		assert.ok(text.includes('RESULT: FAIL (<c> caused, <u> unsure, <p> pre-existing)\n'));
		assert.ok(text.includes('| unit | check | result |'));
	});

	test('reviewer ends with the exact REVIEW formats', () => {
		const text = read('agents/reviewer.md');
		assert.ok(text.includes('REVIEW: CLEAN\n'));
		assert.ok(text.includes('REVIEW: BLOCKING (<n>)\n'));
		for (const heading of ['## Blocking', '## Should fix', '## Nits', '## Checked and fine']) {
			assert.ok(text.includes(heading), heading);
		}
	});

	test('the planner execution line matches the workflow', () => {
		assert.ok(
			read('agents/planner.md').includes(
				'Continue with `workflow-core:feature-workflow` from step 2\n  (preflight)'
			) ||
				read('agents/planner.md')
					.replace(/\s+/g, ' ')
					.includes(
						'Continue with `workflow-core:feature-workflow` from step 2 (preflight): implement, test and review in a loop of at most `process.maxRounds` rounds, then report.'
					)
		);
	});

	test('the template is a valid v1 config', () => {
		const config = normalizeConfig(JSON.parse(read('templates/workflow.config.json')));
		assert.equal(config.configVersion, 1);
		assert.ok(config.units.app.checks.every(c => c.kind === 'test' || c.parser));
	});

	test('plugin.json is version 0.13.0', () => {
		assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).version, '0.13.0');
	});
});
