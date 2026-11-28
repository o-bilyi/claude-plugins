# Plan: receipt lines

**Units, repos and files:** `.` — `src/receipt.mjs` (new), `test/receipt.test.mjs` (new).

**No-code option:** none.

**Reference implementation:** `src/invoice.mjs`.

**Steps**

- S1. Create `src/receipt.mjs` with `receiptLine(item)`.
- S2. Create `test/receipt.test.mjs`.

**Reuse map:** S1 — `src/money.mjs` — `formatCents` — formats the line total like the invoice.

**Acceptance criteria**

- A1: `receiptLine({ name: 'Tea', priceCents: 450, qty: 3 })` → `'Tea x3: $13.50'`.
- A2: a refund (`priceCents: -500`) → `'-$5.00'` in the line.

**Out of scope:** totals, taxes, any other file.

**Open questions:** none.

**Size estimate:** about 30 changed lines.

## Execution

Mode: full
Kind: feature
Plan file: none
Continue with `workflow-core:feature-workflow`: step 0, then step 2 (start the run), preflight, implement, test and review in a loop of at most `process.maxRounds` rounds, then report.
