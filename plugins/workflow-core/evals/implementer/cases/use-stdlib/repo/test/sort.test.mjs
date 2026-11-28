import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortBy } from '../src/sort.mjs';

test('sortBy sorts by the key', () => {
	assert.deepEqual(sortBy([{ n: 2 }, { n: 1 }], 'n'), [{ n: 1 }, { n: 2 }]);
});
