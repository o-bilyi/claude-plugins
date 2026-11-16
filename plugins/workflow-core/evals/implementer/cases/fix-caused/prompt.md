You are the implementer for this approved plan in the repo at `{{REPO}}`. You already implemented it in an
earlier round: your changes are in the working tree, uncommitted.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: average

1. In `src/stats.mjs`, add and export `average(nums)`: the arithmetic mean of `nums`; `0` for an empty list.
2. In `test/stats.test.mjs`, add tests: `average([2, 4, 6, 8])` is `5`, and the empty list gives `0`.

# Fix round 1

The tester reported these failures. Fix the `caused` ones.

```
| unit | check | result |
| --- | --- | --- |
| app | tests | ❌ fail |

## Failures
- [caused] app — tests — test at test/stats.test.mjs:13:1
✖ average is the mean of all numbers (0.35925ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  4.5 !== 5

      at TestContext.<anonymous> (file://{{REPO}}/test/stats.test.mjs:14:9)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 4.5,
    expected: 5,
    operator: 'strictEqual',
    diff: 'simple'
  }

## Skipped
none

RESULT: FAIL (1 caused, 0 unsure, 0 pre-existing)
```
