Review the current change in the repo at `{{REPO}}`.

wc.mjs: `{{WC}}`

The project has no workflow config. The change is the uncommitted work in that repo.

# Plan: delete projects

S1. Create `src/projects.mjs` with `deleteProject(user, id)`. Use `findProject` and `removeProject` from
`src/store.mjs`, and `HttpError` from `src/errors.mjs`.

S2. Create `test/projects.test.mjs` with tests for A1–A3.

Acceptance criteria:

- A1: the owner (`user.id === project.ownerId`) deletes the project → `{ deleted: id }`.
- A2: a project that does not exist → `HttpError` 404.
- A3: a user who is not the owner → `HttpError` 403, and the project stays.
