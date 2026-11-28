# Plan: catalog filters

**Units, repos and files:** `.` — `src/query.mjs` (new), `test/query.test.mjs` (new).

**No-code option:** none.

**Reference implementation:** none.

**Steps**

- S1. Create `src/query.mjs` with `parseFilters(query)`.
- S2. Create `test/query.test.mjs`.

**Reuse map:** S1 — standard library — `URLSearchParams` — parses and decodes the query string.

**Acceptance criteria**

- A1: `parseFilters('?tag=a&tag=b&q=x')` → `{ tag: ['a', 'b'], q: 'x' }`.
- A2: `parseFilters('')` → `{}`.

**Out of scope:** type conversion.

## Execution

Continue with `workflow-core:feature-workflow` from step 2 (preflight): implement, test and review in a loop of at most `process.maxRounds` rounds, then report.
