import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUpload } from '../src/upload.mjs';

test('a 5 MB file passes', () => {
	assert.equal(checkUpload([{ name: 'a.png', bytes: 5 * 1024 * 1024 }]), true);
});

test('an 11 MB file is too large', () => {
	assert.throws(() => checkUpload([{ name: 'b.png', bytes: 11 * 1024 * 1024 }]), /too large/);
});
