Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: status column in the report

Context: report rows now carry a `status` (`'ok'` or `'late'`), and the table must show it.

1. In `src/report.mjs`, change `formatRow(row)` to add the status as a last column.
2. In `test/report.test.mjs`, update the `formatRow` test for the new column.

Acceptance criteria:

- `formatRow({ name: 'Tea', qty: 2, status: 'late' })` → `'| Tea | 2 | late |'`

Out of scope: `legacyTotal`, any other file.
