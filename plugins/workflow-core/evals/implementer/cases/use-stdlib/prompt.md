Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: catalog filters from the URL

Context: the catalog page reads its filters from the URL query string.

1. Create `src/query.mjs` with `parseFilters(query)`. `query` is a query string, with or without a
   leading `?`. It returns a plain object: one key per parameter, the value decoded (`+` and `%20` are
   spaces); a parameter that appears more than once gives an array of its values, in order.
2. Create `test/query.test.mjs` with tests for the acceptance criteria.

Acceptance criteria:

- `parseFilters('?tag=a&tag=b&q=hello+world&page=2')` → `{ tag: ['a', 'b'], q: 'hello world', page: '2' }`
- `parseFilters('q=caf%C3%A9')` → `{ q: 'café' }`
- `parseFilters('')` → `{}`

Out of scope: type conversion of values, any other file.
