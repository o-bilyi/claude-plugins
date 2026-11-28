Review the current change in the repo at `{{REPO}}`.

wc.mjs: `{{WC}}`

The project has no workflow config. The change is the uncommitted work in that repo.

# Plan: invite users

S1. Create `src/invite.mjs` with `inviteUser(email)`. It returns `{ email, invited: true }`. It rejects an
invalid email exactly like sign-up does.

S2. Create `test/invite.test.mjs`.

Acceptance criteria:

- A1: `inviteUser('a@b.co')` → `{ email: 'a@b.co', invited: true }`.
- A2: an address that `signUp` rejects, for example `'a@b'`, throws `Invalid email`.
