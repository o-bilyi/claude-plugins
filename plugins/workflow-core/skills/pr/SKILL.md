---
name: pr
description: 'Open one GitHub pull request per touched repo, with the title format and summary body configured in .claude/workflow.config.json. Use only when the user types /workflow-core:pr.'
disable-model-invocation: true
---

# Open PRs

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`. Git runs per repo: always use
`git -C <repo> …`. Never run git at the project root.

```bash
node "<wc>" touched --since-base --json
node "<wc>" units --json
node "<wc>" get pr.titleFormat
node "<wc>" get pr.ticketPattern
node "<wc>" get pr.titleExample
node "<wc>" writing
```

- Exit 3: `.claude/workflow.config.json` is missing. Tell the user to run `/workflow-core:init`, and stop.
- Exit 2: show the stderr and stop.
- `get pr.titleFormat` always prints a value. The default is `{summary}`.
- `get pr.ticketPattern` exits 1 when the project has no tickets. Then do not use a ticket, and never ask
  for one.
- `get pr.titleExample` exits 1 when the config has no example.
- Write the title and the body by the rules that `writing` prints.
- The touched repos are the keys of `repos` in `touched` that have files. The path, `baseBranch` and
  `prTarget` of each repo are in `units --json` under `repos`.

For each touched repo:

1. **Branch:** run `git -C <repo> branch --show-current`. If it is the `baseBranch` or the `prTarget` of
   the repo, stop and ask the user for a branch name.
   - Create the branch (`git -C <repo> switch -c <name>`) only when the user tells you to.
   - Never commit on the base branch.
2. **Verify:** run `node "<wc>" check --since-base <units of this repo>`. If a check fails, tell the user,
   and ask if you can continue.
3. **Docs:** if `node "<wc>" get docs` prints a docs section, run `node "<wc>" docs`.
   - If the docs are out of date, follow `/workflow-core:docs`. It runs the `workflow-core:documenter`
     agent.
   - Commit the docs with the change before you push.
   - With `docs.mode` `require`, do not open the PR until the check passes. The user can also give a
     reason for the skip trailer.
4. **Ticket** (only with a `ticketPattern`): find it in this order:
   1. the arguments;
   2. the branch name (the case does not matter);
   3. `git -C <repo> log --oneline -20`.

   If you do not find it, ask the user. Write it in the case of the pattern: `proj-12` becomes `PROJ-12`
   for `PROJ-[0-9]+`.

5. **Title:** use `pr.titleFormat` with `{ticket}` and `{summary}`. The summary is a short description in
   the style of `git -C <repo> log --oneline -20 <baseBranch>`. Follow `pr.titleExample` when the config
   has one.
6. **Body:** make it from `git -C <repo> log <prTarget>..HEAD` and
   `git -C <repo> diff <prTarget>...HEAD --stat`. If the local branch is missing, use `origin/<prTarget>`.

   ```
   ## Summary
   - <what changed and why, 1–5 bullets>

   ## Test plan
   - <checks run in step 2>
   - <manual steps if the UI changed>
   ```

   When `writing` printed the STE rules, write the body to a file and run `node "<wc>" prose <file>`. Fix
   the issues.

7. **Uncommitted changes:** when `git -C <repo> status --short` shows changes of the task, do steps 3 to 8
   of `${CLAUDE_PLUGIN_ROOT}/skills/commit/SKILL.md` for them. Do not commit them in another way.
8. **Confirm:** show the repo, the title, the body and the target (`prTarget`). Wait for the explicit
   confirmation of the user.
9. **Push and create** from that repo: run `git -C <repo> push -u origin HEAD`. Then run
   `gh pr create --base <prTarget> --title … --body-file …` with the repo as the working directory.
   Never force-push.

Open one PR for each repo. At the end, give the PR URLs.
