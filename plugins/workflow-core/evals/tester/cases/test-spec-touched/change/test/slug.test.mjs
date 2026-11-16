import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/slug.mjs';

test('slugify lowercases and joins words with dashes', () => {
	assert.equal(slugify('Hello World'), 'hello-world');
});

test('slugify transliterates accented letters', () => {
	assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
});
