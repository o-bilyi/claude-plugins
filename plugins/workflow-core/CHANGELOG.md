# Changelog

All notable changes to workflow-core. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (0.x: minor versions may break).

## 0.14.0 - 2026-11-27

One release for all the planned work: minimal code, STE writing, run state, scope, quick mode, parallel
reviews, flaky tests, metrics, and the `commit`, `learn` and `quick` skills.

### Added

- **Minimal code and reuse.** The planner searches for existing code (project code, then installed
  dependencies, then the standard library) and writes a **Reuse map**. The plan also has a **No-code
  option**, a **Reference implementation**, **Options** with their size, **Acceptance criteria** (IDs
  `A1`…), **Out of scope** and a **Size estimate**. Plan steps have IDs `S1`….
- The implementer uses existing helpers first and follows the reference implementation. It writes no
  speculative options, one-caller wrappers, impossible-state checks or dead code, and it handles errors
  only at the boundaries. Before it reports, it maps each diff hunk to a plan step (**Diff trace**) and
  removes the rest. The report has **Reused** and **Duplication found**.
- **`simplifier` agent** (sonnet, optional reviewer): looks only for code the change can remove, and
  compares the diffstat with the size estimate. It blocks only on code that no plan step needs.
  `/workflow-core:init` offers to add it to `reviewers`.
- **STE writing.** `writing` config section: `style` (`plain` or `ste100`) and `guide`. With `ste100`,
  the agents and skills write plans, reports, findings, commit messages, PR bodies and docs by the
  STE-lite rules in `docs/ste100.md`.
- `wc.mjs writing` prints the writing rules for the prompts in one call: the STE rules and the project
  guide. It works without a config.
- `wc.mjs prose <file|-…> [--strict]` checks text against STE-lite (sentence length, paragraph length,
  passive voice, words with a simpler replacement). It only warns, and works without a config.
  `wc.mjs prose --rules` prints the rules.
- **Run state.** The scripts make the decisions of the loop, and the workflow does what they print.
  `run.json` keeps the mode, phase, round, review pass, plan, branches and findings.
  - `state start [quick|full] [--plan <file|->]` starts a run after the approval of the plan. It reads
    the mode from the `## Execution` section, and keeps a copy of the plan and the branch of each repo.
  - `preflight` moves the run to `implement`. `state round` counts the rounds and exits 1 when the run
    has no more rounds.
  - `state review -` records the findings of one pass (JSON on stdin) and prints `NEXT: fix`,
    `NEXT: report` or `NEXT: ask`. It asks when the same blocking finding (reviewer, file, category) is
    in the last three passes, or when no round is left.
  - `state set key=value…`, `state get`, `state clear`.
  - `feature-workflow` asks to continue an open run. SessionStart prints one line for it, and says when
    the run belongs to another branch.
- **Scope check.** `wc.mjs scope [--plan <file|->]` lists the touched files that the plan does not name,
  and the touched files that its "Out of scope" part names (exit 1). Without `--plan`, it uses the plan
  of the run. In a quick run past one unit or three files, it changes the run to full mode
  (`MODE: full`). The reviewers get the list, and a file outside the plan without a reason is blocking.
- `wc.mjs diffstat [--since-base]`: added and deleted lines per repo, untracked files included. The
  report compares it with the size estimate.
- `wc.mjs check --kind <kind>` runs only one kind of check. It does not use the Stop hook fingerprint.
- **Finding IDs.** Reviewers number blocking findings `B1`… and "should fix" findings `F1`…, each with a
  category (`- B1 [correctness] path:line — …`).
- **Flaky tests.** `wc.mjs check --retry` runs a failed test check one more time and gives the result in
  `retry`. An `unsure` failure that passes the second time goes in a `## Flaky` section, and the workflow
  does not send it to the implementer. A `caused` failure stays `caused`.
- **Metrics.** `wc.mjs metrics record -` records one line per finished run in `metrics.jsonl`. The script
  adds the mode, rounds, passes, size and findings; the workflow gives only the result, the tester counts
  and the estimate. `wc.mjs metrics` shows a summary (runs, mean rounds, caused failures, blocking
  findings per reviewer, categories).
- **Quick mode** and the `quick` skill: for one unit and three files or fewer, with no contract, data,
  security or dependency change. Short plan, at most two questions, one generic review.
- **`commit` skill** (user-only): one commit per touched repo after the checks and the staged docs check,
  in the style of the repo log. It never pushes and never uses `--no-verify`.
- **`learn` skill** (user-only): finds findings that come back in two or more runs and proposes
  `.claude/rules/` entries for the user to approve.
- `/workflow-core:init` offers `knip` and `jscpd` as `other` checks when they are installed, the writing
  style, and the simplifier reviewer.
- **Evals.** A shared engine `evals/lib/suite.mjs` (comma-separated `--case` globs, `change/` dirs,
  optional reference dirs, graders `outputNotMatches`, `lastLineMatches`, `sectionMatches`,
  `sectionNotMatches`). New reviewer suite (6 cases) and planner suite (5 cases). Six new implementer
  cases: `reuse-existing-helper`, `no-speculative-code`, `use-stdlib`, `follow-reference-impl`,
  `boundary-errors`, `trace-hunks`.

### Changed

- All agent prompts, skills, the `init` command, the README, `docs/design.md` and `docs/ste100.md` are
  in STE-lite. `tests/structure.test.mjs` checks them with `prose --strict`.
- `feature-workflow` starts all reviewers in one message, so they run in parallel, and gives each the
  plan and the scope report.
- The report gives the diffstat against the estimate and the files outside the plan, and records the
  metrics. It points to `/workflow-core:commit` and `/workflow-core:pr`.
- `pr`, `commit` and `learn` have `disable-model-invocation: true`.
- The reviewer checks plan conformance first, then correctness, data, contracts, security, tests,
  structure, reuse and unneeded code, conventions and writing.
- The implementer eval runner is now a thin wrapper around `evals/lib/suite.mjs`.
- Each session of the workflow runs the start steps (`doctor`, `writing`, `state`), also the session
  that starts with "Implement the following plan:". Plan mode writes no run state: `state start` runs
  after the approval. The `## Execution` section of the plan gives the mode and the plan file.
- When the simplifier runs, the generic reviewer checks only the duplicates of its reuse item.
- The reviewer does not apply the writing rules to code comments. They follow the style of the project.
- `pr` commits the uncommitted changes by the steps of the `commit` skill.
- The planner gives **Options** only for a decision that the user must make.

## 0.13.0 - 2026-11-23

### Added

- Optional docs check (`docs` config section). Area docs list the code they cover in `code_paths`
  frontmatter; `wc.mjs docs [--staged]` reports area docs a change made stale, code no area covers, and
  new scope without a change record (README, ADR). `mode` (`warn` or `require`) and `enforceAt` (`pr` or
  `commit`) set how strict it is; a `Docs-Skip: <reason>` commit trailer skips it.
- `documenter` agent and `docs` skill: write the docs once, when the change is done, before a commit or PR.
- The Bash guard checks the staged files on `git commit`: it blocks with `enforceAt: "commit"` in
  `require` mode and warns otherwise. `/workflow-core:pr` runs the docs check before pushing, and
  `/workflow-core:init` offers to set it up.

### Changed

- The implementer runs on sonnet instead of haiku, matching the reviewer, so new logic goes into its
  own unit (the 0.12.0 structure rules) without an extra review round.

## 0.12.0 - 2026-11-22

### Added

- Structure checks (single responsibility, judged by concern, not line count): the reviewer flags units
  that mix concerns or took on a new one instead of extracting it, the planner plans that extraction as
  its own step, and the implementer puts new logic in its own unit.

## 0.11.0 - 2026-11-16

First public release.

### Removed

- Support for the 0.2.0 config format. A `.claude/workflow.config.json` without `"version": 1` is now
  rejected: `wc.mjs` exits 3 with a hint to run `/workflow-core:init`, the session-start hook prints the
  same hint, and the other hooks do nothing.
- `scripts/config.mjs` (the 0.2.0 CLI) and `wc.mjs config --v1` (the 0.2.0 → v1 converter).
- The "Formatting:" line of `wc.mjs table`, which only 0.2.0's `format.check` produced.

### Changed

- `/workflow-core:init` no longer offers to convert a 0.2.0 config. It writes a new v1 config instead.

## 0.10.0 - 2026-11-14

### Added

- PostToolUse hook `track-edit` (`Edit|Write|NotebookEdit`): records each edited path in
  `<git-path workflow-core>/sessions/<session_id>` of the file's repo. Files older than 7 days are
  pruned, and the hook never blocks.

### Changed

- The Stop hook (`verify-changed`) checks only the files the current session edited. A session that
  edited nothing exits 0, so the user's own uncommitted work no longer blocks replies. Without a
  `session_id` in the payload it checks the whole working tree, as before. `wc.mjs check` and the
  tester still see the whole working tree.
- `agents/tester.md`: the report is plain Markdown (not in a code fence), the `RESULT:` line ends the
  reply, and `RESULT: PASS` takes no counts.

### Known limitations

- Changes made only through Bash (`git mv`, `sed`, codemods) are not recorded, so the Stop hook misses
  them. The tester still catches them.

## 0.9.0 - 2026-11-13

### Added

- Config v1: repo → unit → check → parser. Each unit's git repo is detected automatically, and the
  base branch comes from `origin/HEAD`. One model covers single repos, monorepos and multi-repo
  workspaces.
- Parsers `tsc`, `eslint-json` and `oxlint`, which turn output into line-number-free error lines.
- Baseline: a multiset of error lines recorded at preflight, so that only new errors block. Files
  already dirty at preflight are not counted as touched until they are edited again. State lives under
  `$(git rev-parse --git-path workflow-core)`, never in the work tree.
- `wc.mjs` CLI: `doctor`, `units`, `touched`, `table`, `get`, `config`, `reviewers`, `check`,
  `preflight`, `baseline save|status|clear`.
- Hooks: `guard-files` and `guard-bash` (PreToolUse), `format-file` (PostToolUse), `verify-changed`
  (Stop, with a fingerprint cache shared with the tester), and `session-start`.
- Agents: `planner` (opus), `implementer` (haiku), `tester` (haiku; tags `caused` / `unsure` /
  `pre-existing` and ends with `RESULT:`), `reviewer` (sonnet; ends with `REVIEW:`). Project reviewers
  come from `reviewers[]`.
- Skills `feature-workflow`, `verify` and `pr`, and the `/workflow-core:init` command.
- Agent evals for the implementer and the tester (`evals/`).

## 0.2.0 - 2026-11-13

### Added

- First version: a config-driven plugin with planner, implementer and tester agents, the
  `feature-workflow`, `verify` and `pr` skills, and format and verify-changed hooks.
