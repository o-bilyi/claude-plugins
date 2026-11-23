---
name: feature-workflow
description: Plan → preflight → implement → test → review → report workflow for any non-trivial change. Use when the user asks for a feature, refactor or multi-file fix, in plan mode, and in the session that starts with "Implement the following plan:".
---

# Feature workflow

Run every phase from the main session. Subagents cannot start other subagents, and questions asked by a
subagent don't reliably reach the user.

The facts come from `wc.mjs`; its path is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs` (written `<wc>` below).
Pass that resolved path in every subagent prompt. Git is per repo: always `git -C <repo> …`.

Check the config first with `node "<wc>" doctor`:

- Exit 3 (no config): suggest `/workflow-core:init` and run the same workflow without the config facts.
  Only `wc.mjs preflight` and the baseline are skipped: still ask the dirty-file question (from
  `git -C <repo> status --short`) and never switch branches. The tester then reports that checks were not
  run; tell the user so in the report.
- Exit 2 (invalid config): show the stderr and stop.
- Otherwise mention any problems it prints and continue.

A session that starts with "Implement the following plan:" skips step 1 and starts at step 2.

## 1. Plan

Read `${CLAUDE_PLUGIN_ROOT}/agents/planner.md` and follow its procedure yourself, including the
AskUserQuestion interview, with `<wc>` as the wc.mjs path. Do not delegate this to the
`workflow-core:planner` agent.

- In plan mode, write the plan to the plan-mode plan file. That file is the only one you write.
- Outside plan mode, present the plan and wait for approval.

## 2. Preflight

Run `node "<wc>" preflight <units from the plan>` once per task (it saves the baseline unless
`process.preflight.baseline` is `off`).

- **Branch:** when it prints `ticket: missing`, or the ticket differs from the plan's, ask the user how to
  proceed. Never switch, create or reset branches.
- **Dirty files:** show them and ask whether they belong to the task. Unrelated ones may stay; they are kept
  out of the touched files until edited.
- Never re-run preflight or `baseline save` between fix rounds.

## 3. Implement

Do not write the code in the main session. Start the `workflow-core:implementer` agent once, with
`name: "implementer"`, the full plan text, the plan file path, the `<wc>` path and the preflight dirty-file
list. Always resume that same `implementer` with SendMessage; never start a second one. If it stops with a
question, ask the user and send the answer with SendMessage to `implementer`.

## 4. Test and review loop

Read `node "<wc>" get process.maxRounds` (the round limit). A round is one SendMessage of failures or
findings to `implementer`; the first tester run and the first review are free. One review pass is the
generic reviewer plus every matching project reviewer.

1. Run `workflow-core:tester` with the `<wc>` path. On `RESULT: FAIL`, send its `caused` and `unsure`
   failures verbatim with SendMessage to `implementer` (one round), then run the tester again.
2. On `RESULT: PASS`, run a review pass: `workflow-core:reviewer` with the plan text and the `<wc>` path,
   then each agent printed by `node "<wc>" reviewers`, each in its own Agent call with the plan text and
   the `<wc>` path.
3. Any `REVIEW: BLOCKING`: send all blocking findings verbatim to `implementer` (one round), run the tester
   again, then another review pass. "Should fix" items and nits go to the report and never start a round.
4. Done when the last tester run says `RESULT: PASS` and every reviewer in the last pass says
   `REVIEW: CLEAN`.

Stop and ask the user (fix it in the main session, change the plan, or accept as is) when the round limit
is reached, or when the implementer reports that the right fix changes the plan.

## 5. Report

- Files changed, per repo; dependency and lockfile changes.
- The final tester table and its `RESULT:` line.
- The `REVIEW:` lines and the "should fix" items.
- Pre-existing failures, separately.
- Anything `implementer` flagged as uncertain.
- Open questions.

Do not commit, push or open PRs, and do not write the project docs here: the change may still be fixed
after the report. If the user wants a PR, tell them to run `/workflow-core:pr`. When the config has a
`docs` section, the docs are written once the user commits or opens the PR (`/workflow-core:docs`).
