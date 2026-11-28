---
name: learn
description: 'Turn review findings that come back again and again into project rules - reads the recorded workflow metrics, finds recurring findings and proposes new .claude/rules/ entries for the user to approve. Use only when the user types /workflow-core:learn.'
disable-model-invocation: true
---

# Learn from the review findings

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`.

```bash
node "<wc>" metrics
node "<wc>" metrics --json
node "<wc>" writing
```

- Exit 3: `.claude/workflow.config.json` is missing. Tell the user to run `/workflow-core:init`, and stop.
- If no runs are on record, tell the user that `workflow-core:feature-workflow` records them, and stop.
- Write the new rules by the rules that `writing` prints.

1. **Find patterns.** In `entries[].findings`, find the findings that come back. A pattern is the same
   `category` and a similar `summary` in two or more runs. The `path` can be different.
2. **Read the context.** For each pattern, read `CLAUDE.md` and the `.claude/rules/` files.
   - If a rule already covers the pattern, the rule is not clear enough. Propose a better text for it.
   - If no rule covers it, propose a new rule.
3. **Write each proposal** as one rule of one to three short sentences. Add one example of correct code
   when it helps. Name the rules file that it goes in. A rule describes the project, not one
   change.
4. **Ask the user.** Show all proposals. Use AskUserQuestion with `multiSelect` to ask which ones to add.
5. **Write** only the approved rules, in the files that you named. Keep the format of each file. Do not
   commit.

At the end, list the rules that you added, and the files.

Do not change the metrics. Do not propose a rule from only one finding.
