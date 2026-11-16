# shop

A tiny cart module.

## API

- `cartTotal(cart)`: the sum of `price * qty` over the cart items, in cents.
- `applyDiscount(cart, code)`: the cart total after the discount code (`SAVE10`, `HALF`), in cents.
