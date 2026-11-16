---
name: verify
description: Run lint, typecheck and tests for only the units touched by the current changes, using the checks in .claude/workflow.config.json. Use before calling work done, before a PR, or when the user says verify/check.
model: haiku
---

# Verify touched units

Checks must pass for every touched unit before work is done.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs" check --since-base
node "${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs" units
```

- If the user named units, check only those: `wc.mjs check <unit> <unit> --since-base`.
- Exit 3: `.claude/workflow.config.json` is missing. Tell the user to run `/workflow-core:init` and stop.
  Exit 2: show the stderr and stop. Exit 1 means a check failed.
- Show the markdown that `check` prints.
- Read the notes of the checked units in `units`. When a note applies (for example "also verify web when
  a public API changes"), run `wc.mjs check <that unit> --since-base` too.
- Never run watch modes or dev servers.

## Report

One line per unit × check: ✅ / ❌ / ⏭ with the first relevant error lines and the skip reasons. Errors
marked pre-existing (in the baseline, or outside the touched files) do not fail a check. Never claim done
when anything failed: say what failed.
