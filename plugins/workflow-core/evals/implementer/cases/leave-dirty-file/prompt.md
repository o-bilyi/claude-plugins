Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): docs/notes.md

# Plan: formal greetings

1. In `src/greet.mjs`, give `greet(name)` an optional second argument `{ formal }`. With
   `formal: true` it returns `Good day, <name>.`; otherwise the current `Hi, <name>!`.
2. In `test/greet.test.mjs`, add a test for `formal: true`. Keep the existing test.
