Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: price formatting cleanup and shipping update

1. In `src/format.mjs`, rename `fmt` to `formatPrice`. Update every caller: `src/checkout.mjs` and
   `test/checkout.test.mjs` (including the test name).
2. In `src/shipping.mjs`, update shipping fees per the new policy.
