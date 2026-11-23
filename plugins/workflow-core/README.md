# workflow-core

A config-driven plan → preflight → implement → test → review → PR workflow for Claude Code, for single
repos, monorepos and multi-repo workspaces. The plugin provides the agents, skills, commands and hooks.
Each project supplies its facts in `.claude/workflow.config.json`; the full design is in
[docs/design.md](docs/design.md); what changed per version is in [CHANGELOG.md](CHANGELOG.md).

## What it provides

- **Agents:** `planner` (opus, read-only; the main session follows it), `implementer` (haiku),
  `tester` (haiku; ends with `RESULT:`), `reviewer` (sonnet; ends with `REVIEW:`), `documenter` (sonnet;
  ends with `DOCS:`).
- **Skills:** `feature-workflow` (the whole loop), `verify` (checks for touched units), `pr` (one PR per
  touched repo), `docs` (bring the project docs in line before a commit or PR; see [Docs](#docs)).
- **Command:** `/workflow-core:init` inspects the project and writes a v1 config.
- **Hooks:** guards for protected files and commands (PreToolUse), formatting (PostToolUse),
  verification of touched units (Stop), repo status (SessionStart). See [Hook behavior](#hook-behavior).
- **CLI:** `scripts/wc.mjs`, used by the hooks, skills and agents. See [CLI](#cli).

## Install

The plugin is in the `obilyi-plugins` marketplace, which lives in the GitHub repo `o-bilyi/claude-plugins`:

```
/plugin marketplace add o-bilyi/claude-plugins
/plugin install workflow-core@obilyi-plugins
```

To make a project declare it, add `extraKnownMarketplaces` and `enabledPlugins` to its committed
`.claude/settings.json`; the root [README](../../README.md#install) has the snippet.

## Config reference

`<project>/.claude/workflow.config.json`, v1 (design notes and one example per project shape:
`docs/design.md` §3 and the appendix). A file without `"version": 1` is rejected: run `/workflow-core:init`
to write a new one.

| Field                          | Default                                  | Meaning                                                                                            |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `version`                      | required: `1`                            |                                                                                                    |
| `baseBranch`, `prTarget`       | `origin/HEAD`, then `main`               | per repo; `repos.<dir>` overrides; `prTarget` falls back to the base branch                        |
| `pr`                           | `{"titleFormat": "{summary}"}`           | `titleFormat` must contain `{summary}`; `{ticket}` requires `ticketPattern` (regex, any case)      |
| `repos.<dir>`                  | –                                        | `baseBranch`, `prTarget`, `format` for one git repo (dir relative to the project root, `.` = root) |
| `units.<name>` / `app`         | –                                        | something checked on its own; `app` = a unit named `app` at `.`                                    |
| `format`                       | –                                        | `command`, `extensions` (`["*"]` = all), `runFrom`: `root` (default), `repo` or `unit`             |
| `extensions.changed` / `.code` | JS/TS (+ `json` for `changed`)           | files that trigger the Stop hook / that `{code}` expands to                                        |
| `process.maxRounds`            | `3`                                      | tester and review rounds before the workflow stops and asks                                        |
| `process.preflight`            | `branchTicket: true`, `baseline: "auto"` | check the branch for the ticket; record a baseline at preflight (`"off"` disables)                 |
| `reviewers`                    | `[]`                                     | `{agent, paths}`: extra reviewer agents when their path prefixes are touched                       |
| `planner.extraChecklist`       | `[]`                                     | extra interview items                                                                              |
| `guards`                       | –                                        | `protectedPaths` `{glob, when?: "tracked", message}`, `blockedCommands` `{regex, cwd?, message}`   |
| `docs`                         | – (off)                                  | optional docs check; see [Docs](#docs)                                                             |

**Unit:** `dir` (required), `triggers` (path prefixes from the project root; default `<dir>/`, `""` = all),
`checks`, `stopHook` (default `true`), `notes` (prose for the planner and tester), `format`.

**Check:** `kind` (`typecheck`, `lint`, `test`, `other`), `name` (default: the kind; unique per unit), `run`
(required; from the unit dir through `sh -c`), `changed` (touched files only), `related` and `fullWhen`
(tests only), `parser` (`tsc`, `eslint-json`, `oxlint`; see [Parsers](#parsers)), `stopHook` (default `true`,
`false` for `other`).

**Placeholders:** `{files}` = the unit's touched files with `extensions.changed`, `{code}` = those with
`extensions.code`; relative to the unit dir and shell-quoted. A command whose placeholder would be empty is
skipped. A command whose first token contains `/` and is not executable is skipped with a warning. A simple
`tsc` command (no `-b`, no shell operators) gets incremental flags.

## Hook behavior

All hooks exit 0 without a config. Only the guards and the Stop hook can block (exit 2).

| Event                                   | Script               | Behavior                                                                                                                                                                             |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PreToolUse `Edit\|Write`                | `guard-files.mjs`    | Blocks a file matching `guards.protectedPaths[].glob` (`*`, `**`, `?`; relative to the project root). `when: "tracked"` blocks only files git tracks.                                |
| PreToolUse `Bash`                       | `guard-bash.mjs`     | Blocks a command segment matching `guards.blockedCommands[].regex` (see below).                                                                                                      |
| PostToolUse `Edit\|Write`               | `format-file.mjs`    | Runs the most specific `format` (unit, then `repos[r]`, then top level) from `runFrom`: `root`, `repo` or `unit`. Never blocks.                                                      |
| PostToolUse `Edit\|Write\|NotebookEdit` | `track-edit.mjs`     | Appends the edited path to `sessions/<session_id>` in that repo's state dir (files older than 7 days are dropped). Never blocks.                                                     |
| Stop                                    | `verify-changed.mjs` | `wc.mjs check --stop` semantics, limited to the files this session edited (a session that edited nothing exits 0); failures go to stderr with exit 2, warnings to a `systemMessage`. |
| SessionStart                            | `session-start.mjs`  | One line per repo: `<repo>: branch=<b> changed=<N> baseline=<yes (N errors)\|no>`.                                                                                                   |

**Guards.** Blocked calls print `Blocked: <message>` and exit 2. A missing or invalid config never
blocks. Commands are split into segments on newlines, `;`, `&&`, `||`, `&`, `|`, `(` and `)`
outside quotes, so `echo "npm start"` is not blocked. A rule with `cwd` applies when the hook's cwd is
that dir or below it, when an earlier `cd <dir>` segment moved there, or when the segment names the
dir as a path (`ui`, `./ui/x`, `--prefix=ui`).

**Stop.** Skipped when `stop_hook_active` is set. It checks units with `stopHook` whose triggers match
a touched file with an `extensions.changed` extension, and runs only their checks with `stopHook`.
Units run in parallel and checks run in order. A unit whose fingerprint (HEAD, its touched entries,
its resolved config) matches the last passing run is skipped. A check whose tool is missing (first
token contains `/` and is not executable) is skipped and reported, and does not fail the unit.

## Docs

Optional. A project without a `docs` section gets no docs check at all. With one, the plugin keeps
"area" docs (how each part works now) in step with the code, and asks for a change record when the
change adds scope no area covered before.

```json
"docs": {
	"mode": "require",
	"enforceAt": "pr",
	"areas": "docs/areas/*.md",
	"changes": "docs/features",
	"newChange": ["README.md", "adr/*.md"],
	"guide": "docs/README.md",
	"ignore": ["**/*.test.ts", "**/_generated/**", "pnpm-lock.yaml"],
	"requireCoverage": false
}
```

| Field             | Default         | Meaning                                                                                         |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `areas`           | required        | glob of the area docs; each lists its code in a `code_paths` frontmatter list of globs          |
| `mode`            | `warn`          | `warn` reports only; `require` fails `wc.mjs docs` and blocks where it is enforced              |
| `enforceAt`       | `pr`            | `pr`: commits only warn, `/workflow-core:pr` and CI require; `commit`: the guard blocks commits |
| `changes`         | –               | folder of per-change records (`<changes>/<slug>/`)                                              |
| `newChange`       | `["README.md"]` | globs a change folder needs when the change adds new scope (needs `changes`)                    |
| `guide`           | –               | the project's docs writing rules, read by the documenter                                        |
| `ignore`          | `[]`            | globs that never need docs                                                                      |
| `requireCoverage` | `true`          | changed code that no area covers fails the check; `false` while areas are still being written   |
| `skipTrailer`     | `Docs-Skip`     | a `Docs-Skip: <reason>` line in a commit message skips the check for that commit or branch      |

What the check asks for, given the changed files (minus doc files and `ignore`):

- **Stale area:** an area whose `code_paths` match a changed file must be changed too.
- **Uncovered** (with `requireCoverage`): a changed file no area covers must be added to one.
- **New scope:** files covered now but not by the areas at the base (a new area, or wider `code_paths`)
  need a touched `<changes>/<slug>/` folder holding every `newChange` file.

Docs are written once, when the work is done: `feature-workflow` never writes them. The `docs` skill runs
when the user commits or opens a PR (`pr` calls it), and runs the `documenter` agent for what is missing.
The guard on `git commit` checks the staged files: with `enforceAt: "commit"` and `mode: "require"` it
blocks the commit, otherwise it shows a warning. Add `node <wc> docs` to CI to cover commits made outside
Claude.

## Missing config

When `.claude/workflow.config.json` is missing, or has no `"version": 1`, the hooks do nothing and exit 0,
and `wc.mjs` exits 3 with a hint to run `/workflow-core:init`.

## State and baseline

State lives in each repo's git dir, under `$(git rev-parse --git-path workflow-core)`; nothing is
written to the work tree:

```
baseline/dirty                  "<sha1> <path>" of files dirty when the baseline was saved
baseline/meta.json              savedAt, HEAD, per unit and check: error count or why it was skipped
baseline/<unit>/<check>.errors  "<count>\t<error line>" per distinct error
checked/<unit>.fp               fingerprint of the last passing check (HEAD, touched entries, unit config, baseline)
tsbuildinfo/<unit>/<check>      incremental tsc state
```

- A file in `baseline/dirty` with the same hash is not "touched" until it is edited again.
- `baseline save` runs `run` for every check with a `parser`; `process.preflight.baseline: "off"` turns
  it off (`--force` overrides).
- With a baseline, a check runs `run` and an error is caused when it occurs more often than in the
  baseline (shown once, with `(+N)` when N > 1). Without one, it runs `changed` (if set) and an error is
  caused when it is in a touched file of the unit; errors in other files are returned as `untouched`
  lines (up to 200) for the tester to tag `unsure` or `pre-existing`. Tests have no baseline: `fullWhen`
  → `run`, else `related`, else `run`.
- Parser output that can't be read, or a non-zero exit with no parsed errors, falls back to the exit
  code with a warning.

## Single app vs monorepo vs workspace

A single app uses `app` (see `templates/workflow.config.json`). A monorepo lists one unit per app with
explicit `triggers` for the shared packages it depends on. A multi-repo workspace (the project root is not a
git repo) lists one unit per repo dir; each unit's repo is found with `git rev-parse --show-toplevel`, and
every git command runs inside that repo. `/workflow-core:init` picks the shape.

## Parsers

A check with `parser` (v1 config) has its stdout turned into error lines of the form
`<tool>: <path relative to the unit dir>: <rule>: <message>`, with no line or column numbers. The lines
are whitespace-squeezed, de-duplicated and sorted, so the same error stays the same line when code
above it moves. Stderr is never parsed.

| Parser        | The command must                                           | Rule field                                           |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `tsc`         | print default tsc diagnostics (pretty or `--pretty false`) | `TS2322`; errors with no file use `-` as the path    |
| `eslint-json` | use `-f json` (ESLint 8 and 9)                             | `ruleId`, or `fatal` for parse errors                |
| `oxlint`      | use `-f unix`                                              | e.g. `eslint(no-debugger)`; `fatal` for parse errors |

- `tsc`: colors are stripped, both `file(1,2): error TS…` and `file:1:2 - error TS…` are read, and
  only the first line of a multi-line message is kept. TypeScript 6 and 7 print the pretty, colored
  form even when stdout is not a terminal.
- `eslint-json` and `oxlint` keep every message they print, warnings included; use `--quiet` or
  `--deny-warnings` on the command to decide what counts.
- Unreadable output (no diagnostics in non-empty tsc output, non-JSON ESLint output, an oxlint line
  in another format) makes the parser report `ok: false`. The check then falls back to its exit code
  with a warning.

Fixtures from real tool versions live in `tests/fixtures/parsers/<tool>-<version>/`. To add a version,
run the generator with the binaries (it writes synthetic sources to a temp dir and records stdout and
exit codes, with the temp path replaced by `__UNIT__`):

```
node tests/fixtures/parsers/regenerate.mjs tsc=<path/to/tsc> eslint=<path/to/eslint> oxlint=<path/to/oxlint>
```

Each argument can be repeated. `tests/parsers.test.mjs` picks up every fixture directory.

## Tests

The plugin's tests use `node:test` and need only Node built-ins. They create temporary git repos with stub
executables in `node_modules/.bin`:

```
node --test tests/
```

## CLI

`node scripts/wc.mjs <command> [--json]`, from anywhere inside the project (`CLAUDE_PROJECT_DIR` wins):

| Command                                                        | Does                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `doctor`                                                       | units outside git, unknown `repos` keys, missing binaries, unresolved bases   |
| `units`                                                        | units grouped by repo, with base branch, PR target and state dir              |
| `touched [--since-base]`                                       | touched files per repo and the touched units                                  |
| `table`                                                        | the verify table: one row per unit, then notes and `other` checks             |
| `get <dot.path>`                                               | one normalized config value                                                   |
| `config`                                                       | the normalized config as JSON                                                 |
| `reviewers [--since-base]`                                     | `reviewers[]` agents whose paths are touched                                  |
| `check [unit…] [--stop] [--since-base]`                        | runs checks (default: touched units); `--stop` uses the Stop hook's selection |
| `preflight [unit…] [--force]`                                  | branch, ticket match, dirty files, then `baseline save`                       |
| `baseline save [unit…] [--force]` / `status` / `clear [unit…]` | records, shows or removes the baseline                                        |
| `docs [--staged]`                                              | docs check for the branch (default) or the staged commit; see [Docs](#docs)   |

Exit codes: 0 ok; 1 a check failed (or `get` found no value, or `docs` found the docs out of date in
`require` mode); 2 invalid config, or a usage error
(unknown subcommand, option or unit); 3 no config, or a config without `"version": 1`.

To run it without permission prompts, add this allow rule to the project's settings:
`Bash(node *workflow-core*/scripts/wc.mjs *)`.
