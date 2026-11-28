Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: create projects

Context: the API needs an endpoint handler to create projects.

Reference implementation: `src/handlers/users.mjs`.

1. Create `src/handlers/projects.mjs` with `createProject(body)`. The required fields are `name` and
   `ownerId`. Save the project with `saveProject` from `src/store.mjs`.
2. Create `test/projects.test.mjs` with tests for the acceptance criteria.

Acceptance criteria:

- `createProject({ name: 'Site', ownerId: 7 })` → status 201, and `body.data` has the saved `name` and
  `ownerId`.
- `createProject({ ownerId: 7 })` → status 400, `body.error.message` is `Missing fields: name`.

Out of scope: any other file.
