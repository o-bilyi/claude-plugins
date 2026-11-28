---
name: docs
description: Bring the project docs in line with the finished change before it is committed or opened as a PR - checks which area docs the change makes stale and runs the documenter to fix them. Use when the user types /workflow-core:docs, and before every commit or PR in a project whose .claude/workflow.config.json has a docs section.
---

# Update the docs

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`.

Write the docs one time, when the work is complete. That is when the user wants to commit or open a PR.
Do not write them after each edit. Do not run this skill while the implementer or the reviewers still work on
the change.

```bash
node "<wc>" get docs
node "<wc>" docs --json
```

- If `get docs` exits 1, the project has no docs section. Tell the user, and stop.
- Exit 3: `.claude/workflow.config.json` is missing. Tell the user to run `/workflow-core:init`, and stop.
- Exit 2: show the stderr and stop.
- For one commit (not a PR), use `docs --staged --json`. Run it after you stage the files.

1. If `ok` is true, tell the user that the docs are up to date, and stop.
2. If not, run the `workflow-core:documenter` agent. Give it:
   - the `<wc>` path;
   - the scope of the check: a commit (`--staged`) or the branch;
   - the report from step 1;
   - the plan, or a short summary of the change and the reason for it.
3. Run the check again. Show the docs that the documenter changed, and its open questions.
4. If the check still fails, show what is missing. Ask the user what to do:
   - fix the docs;
   - or commit with `<skipTrailer>: <reason>` in the message (the trailer name is `docs.skipTrailer`).
5. The docs go in the same commit as the change. Stage them with the change
   (`git -C <repo> add <paths>`) only when the user asks you to commit.
