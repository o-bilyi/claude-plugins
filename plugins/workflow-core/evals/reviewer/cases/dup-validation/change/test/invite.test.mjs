import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inviteUser } from '../src/invite.mjs';

test('inviteUser marks the user as invited', () => {
	assert.equal(inviteUser('a@b.co').invited, true);
});
