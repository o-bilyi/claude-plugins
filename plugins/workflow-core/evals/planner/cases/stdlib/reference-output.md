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

**Size estimate:** about 20 changed lines.

## Execution

Mode: full
Kind: feature
Plan file: none
Continue with `workflow-core:feature-workflow`: step 0, then step 2 (start the run), preflight, implement, test and review in a loop of at most `process.maxRounds` rounds, then report.
