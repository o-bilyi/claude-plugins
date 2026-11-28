Review the current change in the repo at `{{REPO}}`.

wc.mjs: `{{WC}}`

The project has no workflow config. The change is the uncommitted work in that repo.

# Plan: trim names in the greeting

S1. In `src/greet.mjs`, trim the name before `greet` uses it.

Acceptance criteria:

- A1: `greet('  Ann ')` → `'Hello, Ann!'`.

Out of scope: any other file.
