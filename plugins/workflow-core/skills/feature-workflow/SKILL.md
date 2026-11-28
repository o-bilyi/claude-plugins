---
name: feature-workflow
description: Plan → preflight → implement → test → review → report workflow for any non-trivial change. Use when the user asks for a feature, refactor or multi-file fix, in plan mode, and in the session that starts with "Implement the following plan:".
---

# Feature workflow

Run every phase from the main session. Subagents cannot start other subagents. Questions from a subagent
do not always reach the user.

The facts and the decisions come from `wc.mjs`. Its path is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`
(`<wc>` below). Give that path in each subagent prompt. Git is per repo: always use `git -C <repo> …`.
When a `wc.mjs` command prints a `NEXT:` or `MODE:` line, do what that line says.

## 0. Start

Do these steps in each session of the workflow, also in the session that starts with "Implement the
following plan:". They only read. They are safe in plan mode.

1. Run `node "<wc>" doctor`.
   - Exit 2 (config not valid): show the stderr and stop.
   - Exit 3 (no config): tell the user about `/workflow-core:init`. Then do the workflow without the facts
     from the config (see "Without a config" below).
   - Exit 0: tell the user about each problem that it prints, and continue.
2. Run `node "<wc>" writing` once. Write the plan, the questions and the report by the rules that it
   prints.
3. Run `node "<wc>" state`. If it shows a run with a `phase` that is not `done`, ask the user: continue
   that run, or start again. To continue, go to the step of its phase (see "Continue a run" below). To
   start again, run `node "<wc>" state clear`.
4. In a session that starts with "Implement the following plan:", go to step 2 now.
5. Select the mode:
   - **Quick mode** when the user asks for a quick change. Also use it when the task changes one unit
     and three files or fewer. Such a task changes no contract between units, no data or schema, no
     security or authorization, and no dependencies.
   - **Full mode** for all other tasks.
6. Select the kind. A task that fixes a bug is a **bug fix**, in quick or full mode. Its plan has
   `Kind: bug` and a `## Reproduction` part. All other tasks are of the kind `feature`.

### Without a config

Skip the `wc.mjs` steps: the baseline, `state`, `scope`, `diffstat` and `metrics`. Still ask about the
dirty files (from `git -C <repo> status --short`), and never switch branches. Count the rounds yourself.
The tester then reports that it did not run the checks. Tell the user that in the report.

### Continue a run

| Phase       | Continue at                                                             |
| ----------- | ----------------------------------------------------------------------- |
| `preflight` | step 3                                                                  |
| `implement` | step 4. Tell `implementer` that some steps can be complete.             |
|             | In a bug fix without a `repro` value in `state`, do step 4.1 first.     |
| `fix`       | step 5.1. Send the last failures or findings again first.               |
| `review`    | the `next` value of the run: `fix` is step 5.5, `ask` is "Stop and ask" |
| `report`    | step 6                                                                  |

## 1. Plan

Read `${CLAUDE_PLUGIN_ROOT}/agents/planner.md` and follow its procedure yourself, with `<wc>` as the wc.mjs
path. Do the AskUserQuestion interview yourself. Do not give this step to the `workflow-core:planner`
agent. This step writes no run state.

- In plan mode, write the plan to the plan file of plan mode. That file is the only file that you write.
  Put its path and the mode in the `## Execution` section.
- Outside plan mode, show the plan and wait for the approval of the user.

In quick mode:

- Ask only the questions that the code does not answer, two at most.
- The plan has only these parts: files, steps, reuse map, acceptance criteria, out of scope and the
  `## Execution` section. A bug fix also has the `## Reproduction` part.

## 2. Start the run

After the user approves the plan, run one of these:

- With a plan file: `node "<wc>" state start --plan <plan file>`.
- Without a plan file: `node "<wc>" state start <quick|full> --plan -`, with the plan text on stdin.

The script first checks the parts of the plan (`plan check`). On exit 1, the run does not start. Add the
parts that it lists, show the changes to the user, and run the command again. The script reads the mode
and the kind from the `## Execution` section of the plan. It keeps a copy of the plan and the branch of
each repo.

## 3. Preflight

Run `node "<wc>" preflight <units from the plan>` one time for each task. It saves the baseline, unless
`process.preflight.baseline` is `off`. It also moves the run to `implement`.

- **Branch:** when it prints `ticket: missing`, or the ticket is not the ticket of the plan, ask the user
  what to do. Never switch, create or reset branches.
- **Dirty files:** show them, and ask the user if they are part of the task. Files that are not part of
  the task can stay. The touched files do not include them until somebody edits them.
- Never run preflight or `baseline save` again between fix rounds.

## 4. Implement

Do not write the code in the main session. Start the `workflow-core:implementer` agent one time. Give it:

- `name: "implementer"`;
- the full plan text and the plan file path;
- the `<wc>` path;
- the list of dirty files from preflight.

Always continue that same `implementer` with SendMessage. Never start a second one in the same session.
If it stops with a question, ask the user. Send the answer with SendMessage to `implementer`.

### 4.1 Bug fix: show the bug first

In a bug fix, tell `implementer` to do only S1: the test that shows the bug. Then run
`node "<wc>" repro`. It runs the command of the `## Reproduction` part.

- `NEXT: fix`: the test fails, so it shows the bug. Tell `implementer` to do the other steps.
- `NEXT: ask`: the command passes before the fix, or the reproduction is manual. Go to "Stop and ask".
  For a manual reproduction, ask the user to do the steps before the fix and after it.

## 5. Test and review loop

A round is one SendMessage of failures or findings to `implementer`. Before each round, run
`node "<wc>" state round`. Exit 1 means that the run has no more rounds: go to "Stop and ask". The first tester run
and the first review are free.

1. **Test.** Run `workflow-core:tester` with the `<wc>` path.
   - On `RESULT: FAIL`, run `state round`. Then send the `caused` and `unsure` failures, word for word, to
     `implementer`. Then run the tester again.
   - Tell the user about the `## Flaky` tests, but do not send them to `implementer`.
   - In a bug fix, on `RESULT: PASS`, run `node "<wc>" repro` before the scope check. `NEXT: continue`
     means that the bug is gone. On exit 1, run `state round`, and send its output to `implementer`.
     `NEXT: ask` means that the reproduction files changed after they failed: go to "Stop and ask".
2. **Scope.** On `RESULT: PASS`, run `node "<wc>" scope`. Give its report to the reviewers.
   - It lists the touched files that the plan does not name, and the touched files that the plan puts
     out of scope.
   - `MODE: full` means that a quick run became too large. Tell the user, and do the review pass in full
     mode.
3. **Review pass.** Start all reviewers in one message, so that they run in parallel:
   - `workflow-core:reviewer`;
   - in full mode, each agent that `node "<wc>" reviewers` prints.

   Give each reviewer the plan text, the scope report and the `<wc>` path. Each reviewer gets its own
   Agent call. When `workflow-core:simplifier` is in the list, tell `workflow-core:reviewer` that the
   simplifier runs.

4. **Record.** Record all blocking and "should fix" findings of the pass in one command. Use the IDs of
   the reviewers, for example `reviewer B1` or `api-reviewer F2`. Use the category from the finding, or
   select one from the list in step 6.

   ```bash
   node "<wc>" state review - <<'EOF'
   [{"reviewer":"reviewer","id":"reviewer B1","severity":"blocking","category":"correctness","path":"src/a.ts:12","summary":"<problem>"}]
   EOF
   ```

   Send `[]` when no reviewer has a finding. The command prints a `NEXT:` line.

5. **Next.**
   - `NEXT: fix`: run `state round`. Then send all blocking findings with their IDs, word for word, to
     `implementer`. Then go to step 5.1.
   - `NEXT: ask`: go to "Stop and ask".
   - `NEXT: report`: go to step 6.
6. "Should fix" items and nits go in the report. They never start a round.

### Stop and ask

Stop and ask the user what to do in these cases:

- A `wc.mjs` command prints `NEXT: ask`: the run has no more rounds, or the same blocking finding is in the last
  three review passes.
- `implementer` reports that the correct fix changes the plan.
- `repro` prints `NEXT: ask`.

The user can fix it in the main session, change the plan, or accept the change as it is.

## 6. Report

Run `node "<wc>" diffstat`. Then report:

- The files that changed, per repo, and the dependency and lockfile changes.
- The size from `diffstat`, and the size estimate of the plan. Tell the user when the change is two or
  more times larger.
- The touched files outside the plan, from the last scope check.
- The last tester table and its `RESULT:` line, and the flaky tests.
- In a bug fix, the last `REPRO:` line.
- The `REVIEW:` lines and the "should fix" items.
- The pre-existing failures, in a separate list.
- The **Reused** and **Duplication found** sections of `implementer`, and what it was not sure about.
- The open questions.

Then record the run. The script adds the mode, the kind, the rounds, the time of each phase, the size,
the reproduction and the findings. Give it only the
values below:

```bash
node "<wc>" metrics record - <<'EOF'
{"result":"PASS","caused":0,"unsure":0,"flaky":0,"estimate":120}
EOF
```

`result` is `PASS`, `FAIL` or `ACCEPTED`. The counts are from the last tester run. `estimate` is the
size estimate of the plan. The finding categories are: `plan`, `correctness`, `data`, `contracts`,
`security`, `tests`, `structure`, `reuse`, `conventions`, `writing`.

Do not commit, push or open PRs here. Do not write the project docs here, because the change can still
change after the report.

- For a commit, tell the user about `/workflow-core:commit`.
- For a PR, tell the user about `/workflow-core:pr`.
- When the config has a `docs` section, the docs come at the commit or the PR (`/workflow-core:docs`).
