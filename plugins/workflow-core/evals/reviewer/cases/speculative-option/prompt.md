Review the current change in the repo at `{{REPO}}`.

wc.mjs: `{{WC}}`

The project has no workflow config. The change is the uncommitted work in that repo.

# Plan: post slugs

S1. Create `src/slug.mjs` with `slugify(title)`: lowercase, each run of whitespace becomes one `-`,
remove every character that is not `a-z`, `0-9` or `-`, and trim `-` at both ends.

S2. Create `test/slug.test.mjs` with a test for A1.

Acceptance criteria:

- A1: `slugify('  Hello, World!  ')` → `'hello-world'`.

Out of scope: custom separators and length limits.
