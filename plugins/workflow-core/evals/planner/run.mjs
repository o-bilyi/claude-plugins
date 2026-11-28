#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuite } from '../lib/suite.mjs';

await runSuite({
	name: 'planner',
	title: 'Planner',
	agent: 'workflow-core:planner',
	// No AskUserQuestion: in -p mode nobody answers, so the planner must list open questions.
	tools: ['Read', 'Grep', 'Glob', 'Bash'],
	casesDir: join(dirname(fileURLToPath(import.meta.url)), 'cases'),
	model: 'opus',
	models: 'opus',
	runs: '2',
	budget: '1',
	extraArgs: ['--settings', '{"disableAllHooks":true}'],
});
