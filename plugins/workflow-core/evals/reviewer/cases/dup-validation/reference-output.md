## Blocking

- B1 [reuse] src/invite.mjs:2 — the change copies the email rule with a different regex instead of `isEmail`
  from `src/validate.mjs` — `inviteUser('a@b')` passes, but `signUp('a@b')` throws, so A2 is false — use
  `isEmail(email)`

## Should fix

- F1 [tests] test/invite.test.mjs — no test for an invalid address (A2) — add `'a@b'` and assert the error

## Nits

none

## Checked and fine

- S1 creates `inviteUser` with the planned return value.

REVIEW: BLOCKING (1)
