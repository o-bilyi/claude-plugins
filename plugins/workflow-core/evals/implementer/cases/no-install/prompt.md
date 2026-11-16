Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: ISO dates

Context: exports need sortable dates. The tests in `test/date.test.mjs` were written first and already
describe the expected output.

1. Make `formatDate(d)` in `src/date.mjs` return the date as `YYYY-MM-DD` (zero-padded month and day), using
   the UTC date of `d`.
2. Make sure the existing tests in `test/date.test.mjs` pass; do not change them.
