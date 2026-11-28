#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuite } from '../lib/suite.mjs';

await runSuite({
	name: 'reviewer',
	title: 'Reviewer',
	agent: 'workflow-core:reviewer',
	tools: ['Read', 'Grep', 'Glob', 'Bash'],
	casesDir: join(dirname(fileURLToPath(import.meta.url)), 'cases'),
	model: 'sonnet',
	models: 'sonnet',
	runs: '3',
	budget: '0.5',
	// In --agent mode the reviewer is the main session; the plugin's Stop hook must not block it.
	extraArgs: ['--settings', '{"disableAllHooks":true}'],
});
