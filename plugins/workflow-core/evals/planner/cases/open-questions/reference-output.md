# Plan: shipping fee at checkout (draft)

**Units, repos and files:** `.` — `src/checkout.mjs`, a new `src/shipping.mjs`, tests.

**No-code option:** none.

**Reference implementation:** `src/subtotal.mjs` does not exist yet; `src/checkout.mjs` is the nearest code.

**Steps**

- S1. Create `src/shipping.mjs` with the fee rule (after the open questions are answered).
- S2. In `src/checkout.mjs`, add the fee to the result.

**Acceptance criteria:** none yet. They depend on the policy.

**Out of scope:** taxes and discounts.

**Open questions**

- Which shipping fee policy? The repo has no policy document or fee table.
- Is the fee fixed, or does it depend on the subtotal, the weight or the region?
- Is there a free-shipping threshold?

## Execution

Continue with `workflow-core:feature-workflow` from step 2 (preflight): implement, test and review in a loop of at most `process.maxRounds` rounds, then report.
