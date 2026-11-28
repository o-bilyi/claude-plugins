---
name: verify
description: Run lint, typecheck and tests for only the units touched by the current changes, using the checks in .claude/workflow.config.json. Use before calling work done, before a PR, or when the user says verify/check.
model: haiku
---

# Verify touched units

The checks must pass for each touched unit before the work is complete.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs" check --since-base
node "${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs" units
```

- If the user names units, check only those: `wc.mjs check <unit> <unit> --since-base`.
- To run only one kind of check, add `--kind <typecheck|lint|test|other>`.
- Exit 3: `.claude/workflow.config.json` is missing. Tell the user to run `/workflow-core:init`, and stop.
- Exit 2: show the stderr and stop. Exit 1 means that a check failed.
- Show the Markdown that `check` prints.
- Read the notes of the checked units in `units`. A note can tell you to verify another unit, for example
  "also verify web when a public API changes". If it applies, also run
  `wc.mjs check <that unit> --since-base`.
- Never run watch modes or dev servers.

## Report

Write one line for each unit and check: ✅, ❌ or ⏭. Add the first relevant error lines and the reasons
for skips. A pre-existing error does not fail a check. A pre-existing error is in the baseline, or
outside the touched files. If a check failed, tell the user what failed. Never say that the work is
complete when a check failed.
