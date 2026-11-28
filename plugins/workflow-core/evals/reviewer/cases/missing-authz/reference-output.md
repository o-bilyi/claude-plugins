## Blocking

- B1 [security] src/projects.mjs:4 — no owner check: any user deletes any project — user 20 calls
  `deleteProject({ id: 20 }, 1)` and removes the project of user 10; A3 is false — throw
  `new HttpError(403, 'Forbidden')` when `user.id !== project.ownerId`, before `removeProject`
- B2 [tests] test/projects.test.mjs — no test for A3 (a user who is not the owner) — add it

## Should fix

none

## Nits

none

## Checked and fine

- A1 and A2 hold.

REVIEW: BLOCKING (2)
