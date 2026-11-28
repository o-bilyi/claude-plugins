import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signUp } from '../src/signup.mjs';

test('signUp rejects an address without a domain dot', () => {
	assert.throws(() => signUp('a@b'), /Invalid email/);
});
