# Plan: create projects

**Units, repos and files:** `.` — `src/handlers/projects.mjs` (new), `test/projects.test.mjs` (new).

**No-code option:** none.

**Reference implementation:** `src/handlers/users.mjs`.

**Steps**

- S1. Create `src/handlers/projects.mjs` with `createProject(body)`.
- S2. Create `test/projects.test.mjs`.

**Reuse map:** S1 — `src/http.mjs` — `requireFields`, `badRequest`, `created`; `src/store.mjs` — `saveProject`.

**Acceptance criteria**

- A1: `createProject({ name: 'Site', ownerId: 7 })` → status 201.
- A2: `createProject({ ownerId: 7 })` → status 400, `Missing fields: name`.

**Out of scope:** listing and deleting projects.

## Execution

Continue with `workflow-core:feature-workflow` from step 2 (preflight): implement, test and review in a loop of at most `process.maxRounds` rounds, then report.
