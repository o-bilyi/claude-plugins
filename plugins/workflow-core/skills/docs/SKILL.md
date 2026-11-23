---
name: docs
description: Bring the project docs in line with the finished change before it is committed or opened as a PR - checks which area docs the change makes stale and runs the documenter to fix them. Use when the user types /workflow-core:docs, and before every commit or PR in a project whose .claude/workflow.config.json has a docs section.
---

# Update the docs

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`.

Docs are written once, when the work is done and the user wants to commit it or open a PR, not after
every edit. Do not run this while the change is still being fixed or reviewed.

```bash
node "<wc>" get docs
node "<wc>" docs --json
```

- `get docs` exits 1: the project has no docs section. Say so and stop; nothing to do.
- Exit 3: `.claude/workflow.config.json` is missing. Tell the user to run `/workflow-core:init` and stop.
  Exit 2: show the stderr and stop.
- For one commit (the user is committing, not opening a PR) use `docs --staged --json` instead, after the
  files are staged.

1. If `ok` is true, say the docs are up to date and stop.
2. Otherwise run the `workflow-core:documenter` agent with the `<wc>` path, whether the check is for a
   commit (`--staged`) or the branch, the report from step 1, and the plan or a short summary of the
   change and why it was made.
3. Run the check again. Show the docs the documenter changed and its open questions. If the check
   still fails, show what is missing and ask the user whether to fix it, or to commit with
   `<skipTrailer>: <reason>` in the message (the trailer name is `docs.skipTrailer`).
4. The docs go into the same commit as the change: stage them with the change (`git -C <repo> add <paths>`)
   only when the user asked to commit.
