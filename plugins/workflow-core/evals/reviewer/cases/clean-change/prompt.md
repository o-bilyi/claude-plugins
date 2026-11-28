Review the current change in the repo at `{{REPO}}`.

wc.mjs: `{{WC}}`

The project has no workflow config. The change is the uncommitted work in that repo.

# Plan: item count for the cart badge

S1. In `src/cart.mjs`, add and export `itemCount(cart)`: the sum of `qty` over `cart.items`.

S2. In `test/cart.test.mjs`, add tests for A1 and A2.

Acceptance criteria:

- A1: two items with `qty` 3 and 2 → `5`.
- A2: an empty cart (`items: []`) → `0`.

Out of scope: any other file. `cart.items` is always an array (the cart store makes sure of it).
