import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFilters } from '../src/query.mjs';

test('parseFilters decodes values and groups repeated keys', () => {
	assert.deepEqual(parseFilters('?tag=a&tag=b&q=hello+world&page=2'), {
		tag: ['a', 'b'],
		q: 'hello world',
		page: '2',
	});
});

test('parseFilters decodes percent-encoded UTF-8', () => {
	assert.deepEqual(parseFilters('q=caf%C3%A9'), { q: 'café' });
});

test('parseFilters of an empty string is an empty object', () => {
	assert.deepEqual(parseFilters(''), {});
});
