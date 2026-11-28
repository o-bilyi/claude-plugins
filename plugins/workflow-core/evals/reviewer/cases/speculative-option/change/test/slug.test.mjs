import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/slug.mjs';

test('slugify lowercases and removes punctuation', () => {
	assert.equal(slugify('  Hello, World!  '), 'hello-world');
});
