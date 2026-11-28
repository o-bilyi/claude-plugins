---
name: quick
description: Quick mode of the feature workflow for a small change - a short plan without the full interview, the implementer, the tester and one generic review. Use when the user types /workflow-core:quick or asks for a quick or small fix.
---

# Quick change

Read `${CLAUDE_PLUGIN_ROOT}/skills/feature-workflow/SKILL.md` and follow it in quick mode. Do not use
the full mode.

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`.

Quick mode is for a task that changes one unit and three files or fewer. The task must change no contract
between units, no data or schema, no security or authorization, and no dependencies.

1. If the task does not fit these limits, tell the user. Then ask if you can use full mode.
2. `node "<wc>" scope` counts the touched units and files after each tester pass. When it prints
   `MODE: full`, it changed the run to full mode. Tell the user, and continue in full mode.

What quick mode keeps from the full workflow:

- the reuse map, the reference implementation and the acceptance criteria in the plan;
- the approval of the plan by the user;
- preflight and the baseline;
- the `workflow-core:implementer` agent for the code, and the `workflow-core:tester` agent;
- the review loop with only `workflow-core:reviewer` in each pass, and the same round limit.
