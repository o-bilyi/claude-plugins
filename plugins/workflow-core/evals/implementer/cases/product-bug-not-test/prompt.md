You are the implementer for this approved plan in the repo at `{{REPO}}`. You already implemented it in an
earlier round: your changes are in the working tree, uncommitted.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: expose the tax amount

Context: the receipt page needs the tax amount on its own line.

1. In `src/order.mjs`, extract the tax computation into an exported `taxFor(net, taxRate)` that returns
   the tax in currency units, rounded to the cent, and make `total()` use it. The result of `total()`
   must not change.
2. No test changes: the existing tests in `test/order.test.mjs` cover `total()`.

# Fix round 1

The tester reported these failures. Fix the `caused` ones.

```
| unit | check | result |
| --- | --- | --- |
| app | tests | ❌ fail |

## Failures
- [caused] app — tests — test at test/order.test.mjs:14:1
✖ total adds tax and rounds half up to the cent (0.384ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  17.26 !== 17.27

      at TestContext.<anonymous> (file://{{REPO}}/test/order.test.mjs:15:9)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 17.26,
    expected: 17.27,
    operator: 'strictEqual',
    diff: 'simple'
  }

## Skipped
none

RESULT: FAIL (1 caused, 0 unsure, 0 pre-existing)
```
