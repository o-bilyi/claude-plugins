---
name: bugfix
description: Bug fix mode of the feature workflow - a test that shows the bug comes first, and the script checks that it fails before the fix and passes after it. Use when the user types /workflow-core:bugfix or asks to fix a bug.
---

# Bug fix

Read `${CLAUDE_PLUGIN_ROOT}/skills/feature-workflow/SKILL.md` and follow it for a bug fix. Select quick
mode or full mode by the rules of step 0.

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`.

1. **Plan.** Find the steps that show the bug, the expected and the actual result, and the unit. The plan
   has `Kind: bug` in the `## Execution` section, and a `## Reproduction` part with the unit and the
   command that runs the test of S1. S1 adds that test and changes no product code.
2. **Show the bug.** After preflight, the implementer does only S1. `node "<wc>" repro` must print
   `NEXT: fix`. When it prints `NEXT: ask`, the test does not show the bug: ask the user.
3. **Fix.** The implementer does the other steps. After each tester `RESULT: PASS`, `node "<wc>" repro`
   must print `REPRO: fixed`.
4. **Do not change the test.** When the files of S1 change after the test failed, `repro` prints
   `NEXT: ask`. Ask the user if the change is correct.

When no test can show the bug, the plan has a `Manual:` line. Then ask the user to do the steps before
the fix and after it.
