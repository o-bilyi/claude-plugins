Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: checkout subtotal

Context: `checkout(body)` in `src/checkout.mjs` validates the request body with `validateCheckout`
before it does anything else, so every line that reaches the subtotal has an integer `priceCents` ≥ 0
and an integer `qty` ≥ 1.

1. Create `src/subtotal.mjs` with `subtotal(lines)`: the sum of `priceCents * qty` over all lines.
2. In `src/checkout.mjs`, add `subtotalCents: subtotal(body.lines)` to the returned object.
3. Create `test/subtotal.test.mjs` with tests for the acceptance criteria.

Acceptance criteria:

- `subtotal([{ priceCents: 250, qty: 2 }, { priceCents: 100, qty: 1 }])` → `600`
- `checkout({ lines: [{ priceCents: 250, qty: 2 }] }).subtotalCents` → `500`

Out of scope: tax, discounts, any other file.
