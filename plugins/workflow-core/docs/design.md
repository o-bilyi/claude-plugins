# workflow-core: design

This file tells how the plugin works and why. The reference for users is [README.md](../README.md).

## 1. Goals and non-goals

**Goal.** One plan → preflight → implement → test → review → report workflow. It works with no change
in three project shapes:

| Shape                | What makes it different                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Single repo          | everything at the root; often pre-existing type or lint errors                              |
| Monorepo             | one git repo, several apps sharing packages; a change in a package touches several apps     |
| Multi-repo workspace | the project root is not a git repo; each subdirectory is its own repo with its own branches |

A project changes the plugin only through data and knowledge. The data is
`.claude/workflow.config.json`. The knowledge is `CLAUDE.md`, `.claude/rules/` and the skills and agents
of the project. The plugin contains no names of projects, frameworks or trackers.

**Non-goals.** CI and deploy; projects without git; Windows; changes to the settings of the user.
Also: stack detection for stacks other than Node in `init`, and custom (regex) parsers.

**Design rules.**

1. When a script can make a decision, the script (`wc.mjs`) makes it. Agents do only the work that
   needs judgment: plans, code, `unsure` tags and reviews.
2. Each config field has a real use in one or more of the three shapes. If no shape needs a field, the
   config does not have it.
3. The plugin does not touch a project with no config. Each hook exits 0, and the skills point to
   `/workflow-core:init`.
4. The agents write less code. The best change is no change, then a change that uses existing code,
   then new code. Section 8 gives the rules.

## 2. Three layers

| Layer     | Contents                                                                                        | Lives in                                             |
| --------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Process   | phases, agent contracts (`RESULT:` / `REVIEW:` lines), round limit, generic prohibitions, hooks | plugin                                               |
| Facts     | units, repos, branches, check commands, parsers, PR format, guards, reviewers, writing style    | `.claude/workflow.config.json`                       |
| Knowledge | code conventions, architecture, domain rules, domain skills and reviewers                       | `CLAUDE.md`, `.claude/rules/`, project skills/agents |

A simple test: if a sentence names a framework, a path or a tracker, it is a fact or knowledge. It is
not process.

## 3. Data model

```
project root (CLAUDE_PROJECT_DIR; may or may not be a git repo)
└── repo   = a git work tree, found from each unit's dir
    └── unit = something checked on its own: an app, a package, or the whole repo
        └── check = one command (typecheck | lint | test | other), optionally with a parser
```

The config must have `"version": 1`. For other files, `wc.mjs` exits 3 and tells the user to run
`/workflow-core:init` again. The README has the full field reference. This section gives the design
decisions.

- **Unit.** A unit must have a `dir`. The `triggers` are path prefixes from the project root. The
  default is `<dir>/`, and `""` means the whole repo. `notes` is text for the planner and the tester,
  for example "also verify web when an API type changes". `"app": {…}` is a short form of one unit with
  the name `app` at `.`.
- **Repo.** The repo of a unit is `git -C <root>/<dir> rev-parse --show-toplevel`. Each git command runs
  in that repo (`git -C`), never at the project root. `doctor` reports a unit outside a git work tree,
  and all other commands skip it.
- **Branches.** `baseBranch` comes from `repos[r]`, then the top level, then `origin/HEAD`, then `main`.
  `prTarget` comes from `repos[r]`, then the top level, then the base branch.
- **Check.** Commands run from the unit dir through `sh -c`. `run` is the full run. `changed` takes
  `{code}` or `{files}`: the touched files of the unit, relative to the unit and shell-quoted. Tests can
  also have `related` and `fullWhen`.
- **Skipped commands.** The script skips a command when its placeholder is empty. It also skips a
  command when the first token contains `/` and is not executable, and it shows a warning.
- **Format.** `command`, `extensions` (`["*"]` = all) and `runFrom` (`root`, `repo` or `unit`). The most
  specific block wins: the unit, then `repos[r]`, then the top level.
- **PR.** `titleFormat` must contain `{summary}`. `{ticket}` needs a `ticketPattern`, which matches in
  any case. The ticket comes from the arguments, then the branch name, then recent commits. If none of
  them has a ticket, the skill asks the user.
- **Writing.** `writing.style` is `plain` (default) or `ste100`. `writing.guide` is an optional path to
  the writing rules of the project. Section 9 tells how the agents use it.

**Which command runs.** Verify, the tester and the Stop hook use the same rule:

| Check                    | With a baseline for this check                                                  | Without a baseline                                                                   |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| typecheck / lint / other | `run`, then compare with the baseline                                           | `changed` if set, else `run` (errors filtered to touched files when a parser exists) |
| test                     | `run` if any touched file matches `fullWhen`, else `related` if set, else `run` | same                                                                                 |

With a baseline, the script always uses `run`, so that it compares the same set of files. `changed` can
lint files that `run` does not cover.

`check --kind <kind>` runs only the checks of one kind. A run with `--kind` does not read or write the
fingerprint of the Stop hook. `check --retry` runs a failed test check one more time. The status stays
`fail`, and `retry` gives the result of the second run. The tester uses it for the flaky check.

### 3.1 Parsers and error identity

A parser changes the stdout of a check into **error lines**:

```
<tool>: <path relative to the unit dir>: <rule or code>: <message>
```

The lines have no line or column numbers. Thus an edit that moves lines does not make old errors look
new. The parser squeezes the whitespace, and the script counts the lines as a multiset. Thus a second
copy of an existing error is a new error.

The parsers are `tsc`, `eslint-json` (`-f json`, ESLint 8 and 9) and `oxlint` (`-f unix`). Each parser
has fixtures from real tool versions. When a parser cannot read the output, the check uses its exit code
and shows a warning. A check without a parser always uses its exit code.

## 4. `wc.mjs` (script layer)

`wc.mjs` is one Node CLI. It uses only Node built-ins, and each subcommand accepts `--json`. The README
lists all subcommands. The guards are separate hook scripts that use the same library.

<!-- prose-ignore -->

Exit codes: 0 ok; 1 a check failed (also: `get` found no value, `docs` found old docs in `require` mode, `scope` found files outside the plan, `state round` found no more rounds, `prose --strict` found writing issues); 2 config not valid, or a usage error; 3 no config, or a config without `version: 1`.

**Touched files.** For each repo, these are the files that are different from `HEAD`: changed, deleted
or untracked. The script keeps them as `"<sha1> <path>"` entries. With a baseline, an entry counts only
when `baseline/dirty` does not have the same entry with the same hash. Thus a file that was dirty before
the task stays out until somebody edits it again.

`--since-base` adds `git diff --name-only <base>...HEAD`, for verify and PRs. A unit is touched when a
touched file starts with one of its triggers.

**Scope.** `scope` reads the plan of the run, or the plan of `--plan <file|->`. It takes each backticked
path that ends in `/` or has a lowercase extension. It skips globs, URLs and names such as
`Array.isArray`. The paths of the "Out of scope" part are a second list.

Then it lists the touched files
that the plan does not name, and the touched files that the "Out of scope" part names. It exits 1 when
there are any. In a workspace, a plan path can be relative to the project root or to the repo.

The reviewers get this list. A file outside the plan is not always an error, but the reviewer must find
a reason for it. In a quick run, `scope` also counts the touched units and files. Past one unit or three
files, it changes the run to full mode and prints `MODE: full`.

**Diffstat.** `diffstat [--since-base]` counts the added and deleted lines per repo. It also counts the
lines of untracked files. The report and the simplifier compare it with the size estimate of the plan.

**Writing.** `writing` prints the writing rules for the prompts in one call. These are the STE rules for
`ste100`, and the project guide when there is one. It works without a config.

**Prose.** `prose <file|-…>` checks text against the STE-lite rules in `docs/ste100.md`. `prose --rules`
prints those rules. The command works without a config, and it only warns. `--strict` makes it exit 1
when it finds an issue. The tests of the plugin use `--strict` on its own prompts and docs.

## 5. Process

`feature-workflow` runs each phase from the main session. Subagents cannot start subagents, and their
questions do not always reach the user. The scripts make each decision that they can: the round count,
the repeated findings, the quick limits and the next step. The skill does what their `NEXT:` and `MODE:`
lines say.

0. **Start.** The skill runs `doctor` and `writing`. Then it reads the run state (section 7). If a run is
   open, the skill asks the user to continue it or to start again. It selects the mode (section 5.1).
   These steps only read, so they are safe in plan mode. Each session does them, also the session that
   starts with "Implement the following plan:".
1. **Plan.** The main session follows `agents/planner.md` (section 8). The `## Execution` section of the
   plan gives the mode and the plan file. Plan mode writes no run state.
2. **Start the run.** After the approval, `state start` writes the run: the mode, a copy of the plan and
   the branch of each repo. This is the first step of the session after plan mode.
3. **Preflight.** The skill checks the branch, the dirty files and the baseline. With `branchTicket` and
   a `ticketPattern`, the branch must contain the ticket. The workflow never switches or creates
   branches. The user tells if the dirty files are part of the task. The skill saves the baseline one
   time for each task.
4. **Implement.** The skill starts `implementer` one time, with a name. In each fix round, it continues
   the same agent with `SendMessage`.
5. **Test.** `tester` runs `wc.mjs check` for the touched units and tags each failure:

   | Tag            | Parser check, with a baseline | Parser check, without a baseline                                 | Tests and parser-less checks                   |
   | -------------- | ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
   | `caused`       | new vs the baseline (script)  | in a touched file (script)                                       | the failing spec is touched, or fails in one   |
   | `unsure`       | –                             | an untouched line that mentions something a touched file defines | the failing spec imports a touched module      |
   | `pre-existing` | in the baseline (script)      | every other untouched line                                       | the failing spec and its imports are untouched |

   The reply ends with `RESULT: PASS` or `RESULT: FAIL (<c> caused, <u> unsure, <p> pre-existing)`.
   PASS means no `caused` and no `unsure` failures.

   The tester runs `check --retry`. An `unsure` failure that passes the second time goes in the
   `## Flaky` section. It is not a failure, and the skill does not send it to the implementer. A
   `caused` failure stays `caused`, because the change can make a test fail only sometimes.

6. **Scope.** After PASS, the skill runs `scope` against the plan of the run.
7. **Review.** The skill starts all reviewers in one message, so that they run in parallel. These are the
   generic `reviewer` and each agent in `reviewers[]` whose paths match. Each reviewer gets the plan and
   the scope report. The reply ends with `REVIEW: CLEAN` or `REVIEW: BLOCKING (<n>)`.
8. **Findings.** Each blocking finding has an ID, `B1`, `B2` and so on. A "should fix" finding has an ID
   `F1`, `F2` and so on. Each one also has a category. The skill adds the name of the reviewer, for
   example `reviewer B1`. Then `state review -` records all findings of the pass and prints `NEXT:`.
   "Should fix" findings go in the report and never start a round.
9. **Loop.** `caused` or `unsure` failures go to the implementer, then the tester runs again. A
   `BLOCKING` review goes to the implementer, then the tester and the reviewers run again. Before each
   round, `state round` counts it. The skill stops and asks the user in three cases:
   - `state round` exits 1: the run has no more rounds;
   - `state review` prints `NEXT: ask`: the run has no more rounds, or the same blocking finding is in the last
     three passes;
   - the implementer reports that the correct fix changes the plan.
10. **Report.** The report gives the files per repo and the dependency and lockfile changes. It gives
    the diffstat against the size estimate, the files outside the plan, and the last `RESULT:` and
    `REVIEW:` lines. It also lists the flaky tests, the pre-existing failures, and the **Reused** and
    **Duplication found** sections of the implementer. Then `metrics record` records the run (section 7)
    and sets the phase to `done`.

The workflow does not commit, push or write docs. The user does that with `/workflow-core:commit`,
`/workflow-core:pr` and `/workflow-core:docs`. `pr` opens one PR per touched repo against its
`prTarget`. It verifies first, and it waits for a confirmation before each push. It never force-pushes
and never commits on the base branch.

### 5.1 Quick mode

A small task does not need the full interview or the extra reviewers. Quick mode is for a task that
changes one unit and three files or fewer. Such a task changes no contract between units, no data or
schema, no security or authorization, and no dependencies. The user starts it with
`/workflow-core:quick`, or the skill selects it from these limits.

Quick mode asks two questions or fewer. Its plan has the files, the steps, the reuse map, the acceptance
criteria, the out-of-scope list and the `## Execution` section. It keeps preflight, the implementer, the
tester, the round limit and the review loop with only the generic reviewer. When the change becomes
larger, `scope` changes the run to full mode. The skill tells the user and continues in full mode.

### 5.2 Commit and learn

`/workflow-core:commit` commits the change in each touched repo. It runs the checks and the docs check
on the staged files. It writes the message in the style of the repo log, and it waits for the
confirmation of the user. It never pushes and never uses `--no-verify`.

`/workflow-core:learn` reads the metrics. It finds findings of the same category and a similar problem
in two or more runs. For each pattern, it proposes a new rule in `.claude/rules/`, or a better text for
an existing rule. The user selects the rules to add. The skill writes only those rules, and it does not
commit.

Only the user can start `commit`, `pr` and `learn` (`disable-model-invocation`). These skills change git
history or project rules, so the model must not start them by itself.

## 6. Hooks

| Event                                   | Hook           | Behavior                                                                                                   |
| --------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| PreToolUse `Edit\|Write`                | guard-files    | match `guards.protectedPaths`; exit 2 with the message                                                     |
| PreToolUse `Bash`                       | guard-bash     | match `guards.blockedCommands` against each command segment; exit 2 with the message                       |
| PostToolUse `Edit\|Write`               | format         | run the most specific `format`; never blocks                                                               |
| PostToolUse `Edit\|Write\|NotebookEdit` | track-edit     | append the edited path to `sessions/<session_id>` of its repo; never blocks                                |
| Stop                                    | verify-changed | `check --stop`, limited to the files this session edited; exit 2 with `caused` lines or raw failure output |
| SessionStart                            | session-start  | one line per repo: `branch=… changed=N baseline=yes/no`; one line for an open workflow run                 |

- The Stop hook checks only the edits of the session. Thus the uncommitted work of the user never blocks
  a session.
- The hook does not record changes that come only through Bash, for example `git mv` or codemods. The
  tester finds them.
- The Stop hook and the tester share a fingerprint, so each state gets one check.
- Guard globs are relative to the project root, and they support `*`, `**` and `?`. `when: "tracked"`
  blocks only files that git tracks. Thus the agents can still create new files.
- The guard tests a command regex on each segment of the command. The segments are split on newlines,
  `;`, `&&`, `||`, `&`, `|` and parentheses outside quotes.
- A `cwd` limits a rule to commands that run from that dir, move into it with `cd`, or name it.
- When the run state has a phase that is not `done`, SessionStart prints the mode, the phase, the round
  and the plan. Thus a new session can continue an open run. When the run belongs to another branch,
  the line says so.

## 6.1 Docs check

The docs check is optional, like each project fact. With no `docs` section, there is no check. The work
follows design rule 1. `lib/docs.mjs` decides what the change still needs: old areas, files that no area
covers, and new scope without a change record. The `documenter` agent writes the text.

- **The areas own the mapping.** Each area doc has a `code_paths` list in its frontmatter. The list
  is in the doc, not in the config. Thus the doc and its mapping change together.
- **New scope is a difference in coverage.** A file is new scope when the areas cover it now, but did
  not cover it at the base. The base is the merge base of the branch, or `HEAD` for a commit. Thus the
  check finds a new feature without a guess from file names.
- **The docs come once, at the end.** The documenter writes the docs after the user approves the code.
  Thus fix rounds never write them again. `feature-workflow` does not write docs. `/workflow-core:docs`
  runs at the commit or the PR.
- **Where it blocks.** With `enforceAt: "pr"` (default), commits get only a warning. `/workflow-core:pr`
  and CI require the docs for the branch, which is good for squash-merged PRs. With
  `enforceAt: "commit"`, the Bash guard blocks each commit. A `Docs-Skip: <reason>` trailer is the
  explicit way out, and reviewers can see it.

## 7. State on disk

For each repo, the state is under `$(git -C <repo> rev-parse --git-path workflow-core)`:

```
baseline/dirty                     "<sha1> <path>" for files dirty at preflight
baseline/meta.json                 when it was saved, HEAD, per-check counts or skip reasons
baseline/<unit>/<check>.errors     error lines at preflight, with counts
checked/<unit>.fp                  fingerprint of the last passing state (Stop hook and tester)
sessions/<session_id>              repo-relative paths the session edited (Stop hook scope)
tsbuildinfo/<unit>/<check>         incremental tsc state
run.json                           the open workflow run: mode, phase, round, pass, plan, branches, findings
plan.md                            a copy of the plan of the open run
metrics.jsonl                      one line per finished run
```

The plugin writes nothing to the work tree or to `.claude/`. The fingerprint is the sha1 of HEAD, the
touched entries under the triggers of the unit, the resolved config of the unit and the baseline.

`run.json`, `plan.md` and `metrics.jsonl` belong to the project, not to one repo. They go in the state
dir of the root repo. In a workspace, they go in the state dir of the first repo, by name. They stay in
this clone.

- **Run state.** `state start` writes a new run. `preflight` moves it to `implement`, `state round`
  counts the rounds, and `state review` records the findings of each pass. `state set key=value…` sets
  values, and `state clear` removes the run. The JSON input comes on stdin, so that quotes in the text
  cannot break the command.
- **The next step.** `state review` gives a key to each finding: the reviewer, the file without the line
  and the category. When the same blocking key is in the last three passes, the next step is `ask`.
  When the run has no round left, the next step is also `ask`. With no blocking finding, it is
  `report`. In all other cases, it is `fix`.
- **Metrics.** `metrics record` adds one line for the run. The script adds the mode, the rounds, the
  passes, the diffstat and the findings. The skill gives only the result, the tester counts and the
  estimate. `metrics` shows the number of runs, the mean rounds, the blocking findings per reviewer and
  the categories. `/workflow-core:learn` reads them.

## 8. Agents

| Agent                                        | Model (frontmatter) | Tools                       | Contract                     |
| -------------------------------------------- | ------------------- | --------------------------- | ---------------------------- |
| planner (procedure the main session follows) | opus                | read-only + AskUserQuestion | plan parts below             |
| implementer                                  | sonnet              | edit                        | prohibitions below; fix mode |
| tester                                       | haiku               | read-only + Bash            | `RESULT:` line               |
| reviewer                                     | sonnet              | read-only + Bash            | `REVIEW:` line               |
| simplifier (optional reviewer)               | sonnet              | read-only + Bash            | `REVIEW:` line               |
| documenter                                   | sonnet              | edit                        | `DOCS:` line                 |

**Planner.** The main session follows `agents/planner.md`. It reads `CLAUDE.md`, the `.claude/rules/` of
the touched units and the skills of the project. It searches for code to use again: first project code,
then installed dependencies, then the standard library. It also finds the nearest feature of the same
kind, which is the reference implementation. The interview asks about behavior and roles, edge cases,
contracts, data and migrations, non-functional needs, scope and ticket, plus `planner.extraChecklist`.

The plan has these parts:

- a no-code option (config, data or an existing feature), when one exists;
- the reference implementation;
- steps with IDs `S1`, `S2` and so on;
- a reuse map: each new item, and the existing code that it uses or the reason for new code;
- options with their size, when there is more than one way;
- acceptance criteria with IDs `A1`, `A2` and so on;
- an out-of-scope list and a size estimate in lines;
- the tests and checks, and an `## Execution` section with exact text.

**Implementer.** It writes the minimum code that does the plan. These are its rules:

- Use existing code first: project helpers, then dependencies, then the standard library.
- Follow the structure of the reference implementation.
- Write no speculative options, no wrappers with one caller, no checks for impossible states and no dead
  code.
- Handle errors only at the boundaries: input, I/O and external calls.
- Before the report, map each diff hunk to a plan step, or remove the hunk. This is the diff trace.
- Do not install or change dependencies unless the plan says so. Never edit lockfiles by hand, and
  report each lockfile change.
- Never weaken, skip or delete tests. Do not commit, create branches, push or start dev servers.
- Never read or write `.env` files. Do not touch files that were dirty at preflight, unless the plan
  names them.
- If a step is not clear, or if the correct fix changes the plan, stop and report.

The report has the files, the steps, the diff trace, **Reused**, **Duplication found**, the dependency
changes, the fixed findings and the uncertainties. In fix mode, the implementer fixes each `caused`
failure and each blocking finding, by ID. It examines `unsure` failures and does not touch `pre-existing`
ones. For a failing test, it tells if the cause is the test, the product or the environment.

**Model choice.** The implementer runs on sonnet. The plan (opus, main session) does the hard reasoning.
Haiku passed the implementer evals (section 10), but those cases do not test the structure rules. One
such rule is to put new logic in its own hook or component, not in an existing one.

A weaker writer there costs a review round each time, so the implementer uses the same model as the
reviewer. The round limit
stops a model that cannot finish. A project that needs a different model can override the agent with its
own agent.

**Reviewer.** The reviewer checks the plan first. A file outside the plan without a reason is blocking.
Then it checks correctness, data, contracts, security, tests, structure, reuse, conventions and writing.
Each finding has an ID and a `path:line`.

**Simplifier.** This optional reviewer looks only for code that the change can remove or make simpler.
It looks for duplicates, code that a library already does, unused options, wrappers with one caller,
checks for impossible states and dead code. It compares the diffstat with the size estimate. A finding
blocks only when no plan step needs that code. `/workflow-core:init` can add it to `reviewers[]`.

When the simplifier runs, the generic reviewer checks only the duplicates of its reuse item. Thus the
two reviewers do not report the same finding.

## 9. Writing style

Each agent runs `wc.mjs writing` once and writes by the rules that it prints. With
`writing.style: "ste100"`, this applies to plans, questions, reports, review findings, commit messages,
PR bodies and docs. Code comments follow the style of the project, not these rules. The PR skill and the
documenter run `prose` on the text that they write.

The rules are STE-lite, a short form of ASD-STE100. The script checks the sentence length (20 words for
an instruction, 25 for a description) and the paragraph length (6 sentences). It also checks for the
passive voice and for words that have a simpler replacement. It does not have the STE dictionary. The
check only warns, because a script cannot know the meaning of the text.

The prompts and docs of the plugin itself follow the same rules. `tests/structure.test.mjs` runs the
linter on them in strict mode.

## 10. Evaluation

Unit tests cover the script layer: `wc.mjs`, the parsers and the hooks, on temporary git repos. The
agent layer has evals in `evals/`. An eval is a fixture scenario with a known answer, and the suite runs
it several times per model. The evals cover only what the model decides. Evals call the real `claude`
CLI, so they run on demand, never in CI.

All suites use `evals/lib/suite.mjs`. A case has a `repo/`, a `prompt.md` and a `case.json` with graders. It
can also have a `change/` that the suite copies after the first commit, and a `reference-output.md`.
`--dry-run reference` checks the graders against the reference output. `--dry-run baseline` checks that
the graders fail on an empty reply.

**Implementer** (13 cases × 3 runs). The cases are small tasks with an approved plan, and some have a
follow-up failure. The suite measures the rounds to PASS, the weakened tests (must be 0) and the edits
outside the plan. In 0.13, haiku and sonnet passed each grader in each run, with 0 safety violations.
Both models were at the ceiling, so the suite needs harder cases before it can separate them.

0.14.0 adds six minimal-code cases: `reuse-existing-helper`, `no-speculative-code`, `use-stdlib`,
`follow-reference-impl`, `boundary-errors` and `trace-hunks`. No model has run them yet.

**Reviewer** (6 cases × 3 runs, sonnet). Each case gives a change and a plan. The reviewer must block on
duplicate validation, a missing owner check, a file outside the plan and a swallowed error. It must
report a speculative option, and it must say CLEAN for a clean change.

**Planner** (5 cases × 2 runs, opus). The planner must find the existing helper, the reference
implementation, the no-code option and the standard-library answer. It must ask about a policy that the
code does not answer. Each plan must have acceptance criteria, an out-of-scope list and the exact
`## Execution` section, and the planner must change no files.

**Tester** (13 cases on the real `wc.mjs check`, with stubbed tsc and eslint and real `node --test`).
The suite measures false PASS (must be 0), tag accuracy (target 90% or more) and the exact `RESULT:`
format (100%). In the first run, both models had 0 false PASS and 98% tag accuracy. Some replies had text
after the `RESULT:` line, or a report in a code fence. Thus `agents/tester.md` got an explicit format
rule. After that, haiku passed 65 of 65 runs on each metric, so the tester stays on haiku.

## Appendix: example configs

### Single repo

```jsonc
{
	"version": 1,
	"app": {
		"checks": [
			{ "kind": "typecheck", "run": "./node_modules/.bin/tsc -b", "parser": "tsc" },
			{
				"kind": "lint",
				"run": "./node_modules/.bin/oxlint --deny-warnings -f unix src",
				"changed": "./node_modules/.bin/oxlint --deny-warnings -f unix {code}",
				"parser": "oxlint",
			},
			{
				"kind": "test",
				"run": "./node_modules/.bin/vitest run",
				"related": "./node_modules/.bin/vitest related --run --passWithNoTests {files}",
			},
		],
	},
}
```

### Monorepo

```jsonc
{
	"version": 1,
	"pr": { "titleFormat": "{summary}: {ticket}", "ticketPattern": "PROJ-[0-9]+" },
	"format": {
		"command": "node_modules/.bin/prettier --write",
		"extensions": ["ts", "tsx", "json", "md"],
	},
	"units": {
		"web": {
			"dir": "apps/web",
			"triggers": ["apps/web/", "packages/shared/"],
			"checks": [
				{ "kind": "typecheck", "run": "./node_modules/.bin/tsc --noEmit" },
				{
					"kind": "lint",
					"run": "./node_modules/.bin/eslint .",
					"changed": "./node_modules/.bin/eslint {code}",
				},
				{ "kind": "test", "run": "./node_modules/.bin/vitest run" },
			],
		},
		"backend": {
			"dir": "apps/backend",
			"triggers": ["apps/backend/", "packages/shared/"],
			"notes": "Also verify web when an API response type changes.",
			"checks": [
				{ "kind": "typecheck", "run": "./node_modules/.bin/tsc --noEmit" },
				{ "kind": "test", "run": "./node_modules/.bin/vitest run" },
			],
		},
	},
	"reviewers": [{ "agent": "api-reviewer", "paths": ["apps/backend/src/api/"] }],
}
```

### Multi-repo workspace

```jsonc
{
	"version": 1,
	"prTarget": "staging",
	"repos": { "mobile": { "prTarget": "main" } },
	"format": {
		"command": "./node_modules/.bin/prettier --write --ignore-unknown",
		"extensions": ["*"],
		"runFrom": "repo",
	},
	"units": {
		"api": {
			"dir": "api",
			"checks": [
				{ "kind": "typecheck", "run": "./node_modules/.bin/tsc --noEmit", "parser": "tsc" },
			],
		},
		"web": {
			"dir": "web",
			"checks": [
				{
					"kind": "lint",
					"run": "./node_modules/.bin/eslint --quiet -f json src",
					"changed": "./node_modules/.bin/eslint --quiet -f json {code}",
					"parser": "eslint-json",
				},
				{
					"kind": "test",
					"run": "npx vitest run",
					"related": "npx vitest related --run {files}",
					"fullWhen": ["web/src/shared/"],
				},
			],
		},
		"mobile": {
			"dir": "mobile",
			"checks": [{ "kind": "lint", "run": "./node_modules/.bin/eslint ." }],
		},
	},
	"guards": {
		"protectedPaths": [
			{
				"glob": "api/migrations/*.sql",
				"when": "tracked",
				"message": "Add a new migration instead.",
			},
		],
		"blockedCommands": [
			{ "regex": "^npm (run )?(start|dev)\\b", "message": "Dev servers are run by the user." },
		],
	},
}
```
