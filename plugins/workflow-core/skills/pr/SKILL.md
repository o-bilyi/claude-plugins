---
name: pr
description: 'Open one GitHub pull request per touched repo, with the title format and summary body configured in .claude/workflow.config.json. Use only when the user types /workflow-core:pr.'
disable-model-invocation: true
---

# Open PRs

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`. Git runs per repo: always `git -C <repo> …`, never at
the project root.

```bash
node "<wc>" touched --since-base --json
node "<wc>" units --json
node "<wc>" get pr.titleFormat
node "<wc>" get pr.ticketPattern
node "<wc>" get pr.titleExample
```

- Exit 3: `.claude/workflow.config.json` is missing. Tell the user to run `/workflow-core:init` and stop.
  Exit 2: show the stderr and stop.
- `get pr.titleFormat` always prints a value (default `{summary}`). `get pr.ticketPattern` exits 1 when the
  project has no tickets: skip the ticket and never ask for one. `get pr.titleExample` exits 1 when no
  example is configured.
- The touched repos are the keys of `repos` in `touched` with files. Each repo's path, `baseBranch` and
  `prTarget` are in `units --json` under `repos`.

For each touched repo:

1. **Branch:** `git -C <repo> branch --show-current`. If it is the repo's `baseBranch` or `prTarget`, stop and
   ask the user for a branch name. Create it (`git -C <repo> switch -c <name>`) only on the user's explicit
   instruction; never commit on the base branch.
2. **Verify:** run `node "<wc>" check --since-base <units of this repo>`. If anything fails, report it and ask
   whether to continue.
3. **Ticket** (only with a `ticketPattern`): from the arguments, else the branch name (case-insensitive
   match), else `git -C <repo> log --oneline -20`; if none, ask. Write it in the case the pattern uses
   (`proj-12` becomes `PROJ-12` for `PROJ-[0-9]+`).
4. **Title:** `pr.titleFormat` with `{ticket}` and `{summary}` (a short description in the style of
   `git -C <repo> log --oneline -20 <baseBranch>`; follow `pr.titleExample` when set).
5. **Body** from `git -C <repo> log <prTarget>..HEAD` and `git -C <repo> diff <prTarget>...HEAD --stat`
   (use `origin/<prTarget>` when the local branch is missing):

   ```
   ## Summary
   - <what changed and why, 1–5 bullets>

   ## Test plan
   - <checks run in step 2>
   - <manual steps if the UI changed>
   ```

6. **Uncommitted changes:** show `git -C <repo> status --short` and ask before committing them.
7. **Confirm:** show the repo, title, body and target (`prTarget`), and wait for explicit confirmation.
8. **Push and create**, from that repo: `git -C <repo> push -u origin HEAD`, then
   `gh pr create --base <prTarget> --title … --body-file …` with the repo as the working directory.
   Never force-push.

One PR per repo. Finish with the PR URLs.
