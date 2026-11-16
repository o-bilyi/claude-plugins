Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: discount codes for the cart

Context: the cart can compute its total (`cartTotal` in `src/cart.mjs`, amounts in cents). Shoppers need
two discount codes.

1. In `src/cart.mjs`, add and export `applyDiscount(cart, code)`. It returns the cart total (from
   `cartTotal`) after the discount, in whole cents:
   - `SAVE10`: 10% off, rounded to the nearest cent (600 → 540).
   - `HALF`: half the total, rounded to the nearest cent (600 → 300).
   - Any other code throws an `Error` whose message starts with `Unknown discount code`.
2. In `test/cart.test.mjs`, add tests for both codes and for the unknown-code error. Keep the existing
   tests.
3. In `README.md`, add one line for `applyDiscount` to the API list.

Out of scope: storing codes, combining codes, any other file.
