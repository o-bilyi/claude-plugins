Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: receipt lines

Context: the shop prints receipts. Each line shows the item name, the quantity and the line total in
dollars, formatted like the invoice total (`$1,234.56`, negative amounts as `-$5.00`).

1. Create `src/receipt.mjs` with `receiptLine(item)`. `item` is `{ name, priceCents, qty }`. It returns
   `"<name> x<qty>: <line total>"`, for example `{ name: 'Tea', priceCents: 450, qty: 3 }` →
   `"Tea x3: $13.50"`.
2. Create `test/receipt.test.mjs` with tests for that example, a total of at least $1,000, and a refund
   line with a negative price.

Out of scope: any other file.
