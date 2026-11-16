import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../src/errors.mjs';
import { parseEmail } from '../src/email.mjs';

test('parseEmail splits, trims and lowercases the domain', () => {
	assert.deepEqual(parseEmail('  Ada@Example.COM '), { local: 'Ada', domain: 'example.com' });
});

for (const input of ['', 'ada', 'ada@', '@example.com', 'ada@example', 'a da@example.com', null]) {
	test(`parseEmail rejects ${JSON.stringify(input)}`, () => {
		assert.throws(
			() => parseEmail(input),
			err => err instanceof AppError && err.code === 'INVALID_EMAIL'
		);
	});
}
