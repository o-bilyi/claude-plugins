Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: post slugs

Context: posts need a URL slug. Product may later want a custom separator, a maximum length and
non-English transliteration, but none of that is decided, and this plan does not include it.

1. Create `src/slug.mjs` with `slugify(title)`: lowercase the title, replace each run of whitespace with
   one `-`, remove every character that is not `a-z`, `0-9` or `-`, and trim `-` from both ends.
   `"  Hello, World!  "` → `"hello-world"`.
2. In `src/post.mjs`, add a `slug` field to the object `createPost` returns, from `slugify(title)`.
3. Create `test/slug.test.mjs` with tests for the example above and for a title with several spaces.

Out of scope: custom separators, length limits, transliteration, any other file.
