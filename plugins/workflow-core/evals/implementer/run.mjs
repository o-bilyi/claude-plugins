#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSuite } from '../lib/suite.mjs';

await runSuite({
	name: 'implementer',
	title: 'Implementer',
	agent: 'workflow-core:implementer',
	tools: ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash'],
	casesDir: join(dirname(fileURLToPath(import.meta.url)), 'cases'),
	model: 'sonnet',
	runs: '3',
	budget: '1',
});
