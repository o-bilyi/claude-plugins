import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slugify } from '../src/slug.mjs';

test('slugify lowercases and removes punctuation', () => {
	assert.equal(slugify('  Hello, World!  '), 'hello-world');
});

test('slugify joins several spaces into one dash', () => {
	assert.equal(slugify('a   b  c'), 'a-b-c');
});
