---
name: commit
description: 'Commit the current change in each touched repo, after the checks and the docs check, with a message in the style of the repo history. Never pushes. Use only when the user types /workflow-core:commit.'
disable-model-invocation: true
---

# Commit the change

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`. Git runs per repo: always use
`git -C <repo> …`. Never run git at the project root. Never push.

```bash
node "<wc>" touched --json
node "<wc>" units --json
node "<wc>" writing
```

- Exit 3: `.claude/workflow.config.json` is missing. Tell the user to run `/workflow-core:init`, and stop.
- Exit 2: show the stderr and stop.
- Write the message by the rules that `writing` prints.
- The touched repos are the keys of `repos` in `touched` that have files.

For each touched repo:

1. **Branch:** run `git -C <repo> branch --show-current`. If it is the `baseBranch` of the repo, ask the
   user for a branch name, or for permission to commit on the base branch.
   - Create the branch (`git -C <repo> switch -c <name>`) only when the user tells you to.
2. **Verify:** run `node "<wc>" check <units of this repo>`. If a check fails, tell the user, and ask if
   you can continue.
3. **Files:** show `git -C <repo> status --short`. Ask the user which files go in the commit. Files that
   were dirty before the task do not go in, unless the user tells you to add them.
4. **Stage:** run `git -C <repo> add -- <files>`.
5. **Docs:** if `node "<wc>" get docs` prints a docs section, run `node "<wc>" docs --staged`.
   - If the docs are out of date, follow `/workflow-core:docs` for a commit, and stage the docs.
   - With `docs.mode` `require`, do not commit until the check passes. The user can also give a reason
     for the skip trailer.
6. **Message:** read `git -C <repo> log --oneline -20`. Write the subject in the same style, and with the
   ticket key when the history uses one. Add a body of one to five lines: what changed, and why.
7. **Confirm:** show the repo, the files and the message. Wait for the explicit confirmation of the user.
8. **Commit:** run `git -C <repo> commit -F <message file>`. If a hook fails, show its output. Do not use
   `--no-verify`.

At the end, give the commit hash of each repo. Tell the user that you did not push.
