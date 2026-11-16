# Changelog

All notable changes to workflow-core. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/) (0.x: minor versions may break).

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
