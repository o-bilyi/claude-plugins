import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyId } from '../src/legacy.mjs';

test('legacy ids are zero-padded to four digits', () => {
	assert.equal(legacyId(7), 'T0007');
});
