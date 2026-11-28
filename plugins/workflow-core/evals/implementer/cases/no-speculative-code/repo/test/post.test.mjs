import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPost } from '../src/post.mjs';

test('createPost trims the title', () => {
	assert.equal(createPost('  Hello  ', 'x').title, 'Hello');
});
