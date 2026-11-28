# workflow-core

A plan → preflight → implement → test → review → PR workflow for Claude Code. A config file drives it.
It works for single repos, monorepos and multi-repo workspaces. The plugin gives the agents, skills,
commands and hooks. Each project gives its facts in `.claude/workflow.config.json`.

The full design is in [docs/design.md](docs/design.md). The changes in each version are in
[CHANGELOG.md](CHANGELOG.md).

## What it provides

- **Agents:**
  - `planner` (opus, read-only). The main session follows its procedure.
  - `implementer` (sonnet). It writes the minimum code, and it uses existing code first.
  - `tester` (haiku). Its last line is `RESULT:`.
  - `reviewer` (sonnet). Its last line is `REVIEW:`.
  - `simplifier` (sonnet, optional reviewer). It looks only for code that the change can remove.
  - `documenter` (sonnet). Its last line is `DOCS:`.
- **Skills:**
  - `feature-workflow`: the full loop, with a quick mode for small changes.
  - `quick`: the quick mode, as a command.
  - `bugfix`: the bug fix mode. A test shows the bug first, and the script checks it before and after
    the fix.
  - `verify`: the checks for the touched units.
  - `commit`: one commit per touched repo, after the checks. It never pushes.
  - `pr`: one PR per touched repo.
  - `docs`: brings the project docs in line before a commit or a PR. See [Docs](#docs).
  - `learn`: turns review findings that come back into project rules.
- **Command:** `/workflow-core:init` examines the project and writes a v1 config.
- **Hooks:** guards for protected files and commands (PreToolUse), formatting (PostToolUse),
  verification of touched units (Stop), repo status (SessionStart). See [Hook behavior](#hook-behavior).
- **CLI:** `scripts/wc.mjs`. The hooks, skills and agents use it. See [CLI](#cli).

Only the user can start `commit`, `pr` and `learn`. The model does not start them by itself.

## Install

The plugin is in the `obilyi-plugins` marketplace. The marketplace is in the GitHub repo
`o-bilyi/claude-plugins`:

```
/plugin marketplace add o-bilyi/claude-plugins
/plugin install workflow-core@obilyi-plugins
```

To declare the plugin in a project, add `extraKnownMarketplaces` and `enabledPlugins` to the committed
`.claude/settings.json` of the project. The root [README](../../README.md#install) has the snippet.

## Config reference

The config is `<project>/.claude/workflow.config.json`, v1. `docs/design.md` §3 has the design notes, and
its appendix has one example for each project shape. A file without `"version": 1` is not valid. Run
`/workflow-core:init` to write a new one.

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
| `writing`                      | `{"style": "plain"}`                     | `style`: `plain` or `ste100`; `guide`: optional path to the project's writing rules                |

**Unit:** these are the fields of a unit.

- `dir` (required).
- `triggers`: path prefixes from the project root. The default is `<dir>/`, and `""` means all files.
- `checks`, and `stopHook` (default `true`).
- `notes`: text for the planner and the tester.
- `format`.

**Check:** these are the fields of a check.

- `kind`: `typecheck`, `lint`, `test` or `other`.
- `name`: the default is the kind. Each name must be unique in its unit.
- `run` (required). It runs from the unit dir through `sh -c`.
- `changed`: a command for the touched files only.
- `related` and `fullWhen`: for tests only.
- `parser`: `tsc`, `eslint-json` or `oxlint`. See [Parsers](#parsers).
- `stopHook`: the default is `true`, and `false` for `other`.

**Placeholders:** `{files}` is the list of touched files of the unit with `extensions.changed`. `{code}` is
the list of touched files with `extensions.code`. Both lists are relative to the unit dir and
shell-quoted.

- When a placeholder is empty, the script skips the command.
- When the first token of a command contains `/` and is not executable, the script skips the command
  and shows a warning.
- A simple `tsc` command (no `-b`, no shell operators) gets incremental flags.

**Writing:** with `"style": "ste100"`, the agents write plans, reports, findings, commit messages, PR
bodies and docs by the STE-lite rules in [docs/ste100.md](docs/ste100.md). `wc.mjs prose` checks text
against those rules, and it only warns.

## Hook behavior

All hooks exit 0 without a config. Only the guards and the Stop hook can block (exit 2).

| Event                                   | Script               | Behavior                                                                                                                                                                             |
| --------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PreToolUse `Edit\|Write`                | `guard-files.mjs`    | Blocks a file matching `guards.protectedPaths[].glob` (`*`, `**`, `?`; relative to the project root). `when: "tracked"` blocks only files git tracks.                                |
| PreToolUse `Bash`                       | `guard-bash.mjs`     | Blocks a command segment matching `guards.blockedCommands[].regex` (see below).                                                                                                      |
| PostToolUse `Edit\|Write`               | `format-file.mjs`    | Runs the most specific `format` (unit, then `repos[r]`, then top level) from `runFrom`: `root`, `repo` or `unit`. Never blocks.                                                      |
| PostToolUse `Edit\|Write\|NotebookEdit` | `track-edit.mjs`     | Appends the edited path to `sessions/<session_id>` in that repo's state dir (files older than 7 days are dropped). Never blocks.                                                     |
| Stop                                    | `verify-changed.mjs` | `wc.mjs check --stop` semantics, limited to the files this session edited (a session that edited nothing exits 0); failures go to stderr with exit 2, warnings to a `systemMessage`. |
| SessionStart                            | `session-start.mjs`  | One line per repo: `<repo>: branch=<b> changed=<N> baseline=<yes (N errors)\|no>`. One more line when a workflow run is open.                                                        |

**Guards.** A guard prints `Blocked: <message>` and exits 2. A missing config, or a config that is not
valid, never blocks. The guard splits a command into segments on newlines, `;`, `&&`, `||`, `&`, `|`,
`(` and `)` outside quotes. Thus it does not block `echo "npm start"`.

A rule with `cwd` applies in these cases:

- The cwd of the hook is that dir or a dir below it.
- An earlier `cd <dir>` segment moves there.
- The segment names the dir as a path (`ui`, `./ui/x`, `--prefix=ui`).

**Stop.** The hook does nothing when the input has `stop_hook_active`. It selects the units with `stopHook`
whose triggers match a touched file with an `extensions.changed` extension. It runs only their checks
with `stopHook`. The units run in parallel, and the checks of a unit run in order.

- The fingerprint of a unit is HEAD, its touched entries and its resolved config. When the fingerprint
  matches the last passing run, the hook skips the unit.
- When the tool of a check is missing (the first token contains `/` and is not executable), the hook
  skips the check and reports it. The unit does not fail.

## Docs

The docs check is optional. A project without a `docs` section gets no docs check. With one, the plugin
keeps the "area" docs in step with the code. An area doc tells how one part of the code works now. When
the change adds scope that no area covered before, the plugin also asks for a change record.

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

The check uses the changed files, without the doc files and the `ignore` globs. It asks for these
changes:

- **Old area:** when the `code_paths` of an area match a changed file, the area must change too.
- **Not covered** (with `requireCoverage`): when no area covers a changed file, add the file to an area.
- **New scope:** the areas cover some files now, but did not cover them at the base. This happens with a
  new area or with wider `code_paths`. Such files need a touched `<changes>/<slug>/` folder that holds
  each `newChange` file.

The docs come once, at the end of the work. `feature-workflow` never writes them. The `docs` skill runs
when the user commits or opens a PR, and `commit` and `pr` start it. It runs the `documenter` agent for
the docs that are missing.

The guard on `git commit` checks the staged files. With `enforceAt: "commit"` and `mode: "require"`, it
blocks the commit. In all other cases, it shows a warning. To cover commits from outside Claude, add
`node <wc> docs` to CI.

## Missing config

When `.claude/workflow.config.json` is missing or has no `"version": 1`, the hooks do nothing and exit 0.
`wc.mjs` exits 3 and tells the user to run `/workflow-core:init`. `wc.mjs writing` and `wc.mjs prose` work
without a config.

## State and baseline

The state is in the git dir of each repo, under `$(git rev-parse --git-path workflow-core)`. The plugin
writes nothing to the work tree.

```
baseline/dirty                  "<sha1> <path>" of files dirty when the baseline was saved
baseline/meta.json              savedAt, HEAD, per unit and check: error count or why it was skipped
baseline/<unit>/<check>.errors  "<count>\t<error line>" per distinct error
checked/<unit>.fp               fingerprint of the last passing check (HEAD, touched entries, unit config, baseline)
tsbuildinfo/<unit>/<check>      incremental tsc state
run.json                        the open workflow run (project-wide; see below)
plan.md                         a copy of the plan of the open run, for `scope`
metrics.jsonl                   one line per finished run (project-wide)
```

- A file in `baseline/dirty` with the same hash is not "touched" until somebody edits it again.
- `baseline save` runs `run` for each check with a `parser`. `process.preflight.baseline: "off"` turns
  it off, and `--force` overrides that.
- Parser output that the parser cannot read, or a non-zero exit with no parsed errors, makes the check
  use the exit code. The check also shows a warning.

**Caused errors.** With a baseline, a check runs `run`. An error is `caused` when it occurs more often
than in the baseline. The report shows it once, with `(+N)` when N is more than 1.

Without a baseline, a check runs `changed` (if set). An error is `caused` when it is in a touched file
of the unit. The check returns errors in other files as `untouched` lines, up to 200. The tester tags them
`unsure` or `pre-existing`.

Tests have no baseline. A test check runs `run` when a touched file matches `fullWhen`. If not, it runs
`related`, and if there is no `related`, it runs `run`.

**Run state and metrics.** `run.json`, `plan.md` and `metrics.jsonl` belong to the project, not to one
repo. They go in the state dir of the root repo. In a workspace, they go in the state dir of the first
repo, by name. `/workflow-core:learn` reads the metrics. They stay in this clone: a new clone starts with
no metrics.

The scripts make the decisions of the loop, and the workflow does what they print:

- `state start` first checks the parts of the plan (`plan check`). A plan must have steps (`S1`…), acceptance criteria (`A1`…), a reuse map, an out-of-scope part and an `## Execution` part with `Mode:`. In full mode, it also needs a size estimate. A plan without these parts does not start a run. A path that does not exist needs "(new)" on its
  line. A bug plan (`Kind: bug`) also needs a `## Reproduction` part.
- `state start` keeps the mode, the kind, a copy of the plan and the branch of each repo. SessionStart
  tells you when the open run belongs to another branch.
- `preflight` moves the run to `implement`. `state round` counts the rounds, and exits 1 when the run
  has no more rounds.
- `state review -` records the findings of one review pass. It prints `NEXT: fix`, `NEXT: report` or
  `NEXT: ask`. It asks when the same blocking finding (the same reviewer, file and category) is in the
  last three passes.
- `scope` changes a quick run to full mode when it touches more than one unit or three files.
- `repro` runs the `Command:` of the `## Reproduction` part in its unit. The first run must fail
  (`NEXT: fix`), and the script keeps the hash of each touched file. Later runs must pass
  (`REPRO: fixed`), and those files must not change (`NEXT: ask`). A command that passes before the fix
  and a `Manual:` reproduction also print `NEXT: ask`.
- `metrics record -` adds what the run knows to the values that you give. These are the mode, the kind, the rounds, the time of each phase and the size against the estimate. They also include the stops to ask, the reproduction and the findings. `metrics`
  shows the means and the median size against the estimate.

**Flaky tests.** `check --retry` runs a failed test check one more time and puts the result in `retry`.
The tester calls an `unsure` failure that passed on the second run flaky. A `caused` failure stays
`caused`.

## Single app vs monorepo vs workspace

A single app uses `app` (see `templates/workflow.config.json`). A monorepo lists one unit for each app.
Each unit has explicit `triggers` for the shared packages that it uses.

A multi-repo workspace is a project root that is not a git repo. It lists one unit for each repo dir.
The script finds the repo of each unit with `git rev-parse --show-toplevel`, and it runs each git command
in that repo. `/workflow-core:init` selects the shape.

## Parsers

A check with `parser` changes its stdout into error lines with this form:
`<tool>: <path relative to the unit dir>: <rule>: <message>`. The lines have no line or column numbers.
The parser squeezes the whitespace, removes duplicates and sorts the lines. Thus the same error stays
the same line when the code above it moves. The parser never reads stderr.

| Parser        | The command must                                           | Rule field                                           |
| ------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `tsc`         | print default tsc diagnostics (pretty or `--pretty false`) | `TS2322`; errors with no file use `-` as the path    |
| `eslint-json` | use `-f json` (ESLint 8 and 9)                             | `ruleId`, or `fatal` for parse errors                |
| `oxlint`      | use `-f unix`                                              | e.g. `eslint(no-debugger)`; `fatal` for parse errors |

- `tsc`: the parser removes colors. It reads both `file(1,2): error TS…` and `file:1:2 - error TS…`. It
  keeps only the first line of a message with many lines. TypeScript 6 and 7 print the pretty, colored
  form also when stdout is not a terminal.
- `eslint-json` and `oxlint`: the parser keeps each message that the tool prints, also warnings. Use
  `--quiet` or `--deny-warnings` on the command to select what counts.
- Some output is not readable: tsc output with no diagnostics, ESLint output that is not JSON, or an
  oxlint line in another format. Then the parser reports `ok: false`, and the check uses its exit code
  with a warning.

The fixtures from real tool versions are in `tests/fixtures/parsers/<tool>-<version>/`. To add a version,
run the generator with the binaries. It writes test sources to a temp dir. It records stdout and exit
codes, and it replaces the temp path with `__UNIT__`.

```
node tests/fixtures/parsers/regenerate.mjs tsc=<path/to/tsc> eslint=<path/to/eslint> oxlint=<path/to/oxlint>
```

You can give each argument more than one time. `tests/parsers.test.mjs` reads each fixture directory.

## Tests

The tests of the plugin use `node:test` and need only Node built-ins. They create temporary git repos
with stub executables in `node_modules/.bin`:

```
node --test tests/
```

The tests also run `wc.mjs prose --strict` on the prompts and docs of the plugin. The agent evals are in
[evals/](evals/README.md). They call the real `claude` CLI and cost money, so they do not run in CI.

## CLI

Run `node scripts/wc.mjs <command> [--json]` from any dir in the project. `CLAUDE_PROJECT_DIR` wins.

| Command                                                                | Does                                                                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `doctor`                                                               | units outside git, unknown `repos` keys, missing binaries, unresolved bases                                                      |
| `units`                                                                | units grouped by repo, with base branch, PR target and state dir                                                                 |
| `touched [--since-base]`                                               | touched files per repo and the touched units                                                                                     |
| `table`                                                                | the verify table: one row per unit, then notes and `other` checks                                                                |
| `get <dot.path>`                                                       | one normalized config value                                                                                                      |
| `config`                                                               | the normalized config as JSON                                                                                                    |
| `reviewers [--since-base]`                                             | `reviewers[]` agents whose paths are touched                                                                                     |
| `check [unit…] [--stop] [--since-base] [--kind <kind>] [--retry]`      | runs checks (default: touched units); `--kind` runs one kind; `--retry` runs a failed test check again                           |
| `plan check [--plan <file\|->]`                                        | the parts that the plan misses; exit 1 when there are any. Without `--plan`, the plan of the run                                 |
| `repro`                                                                | runs the reproduction command of a bug run; prints `REPRO:` and `NEXT:`; exit 1 when the bug still shows                         |
| `scope [--plan <file\|->] [--since-base]`                              | touched files that the plan does not name or puts out of scope; exit 1 when there are any. Without `--plan`, the plan of the run |
| `diffstat [--since-base]`                                              | added and deleted lines per repo, untracked files included; a file dirty at the baseline counts from its baseline content        |
| `preflight [unit…] [--force]`                                          | branch, ticket match, dirty files, then `baseline save`                                                                          |
| `baseline save [unit…] [--force]` / `status` / `clear [unit…]`         | records, shows or removes the baseline                                                                                           |
| `docs [--staged]`                                                      | docs check for the branch (default) or the staged commit; see [Docs](#docs)                                                      |
| `state` / `state get <key>` / `state set <key=value…>` / `state clear` | the open workflow run: mode, phase, round, pass, plan, branches, findings                                                        |
| `state start [quick\|full] [--plan <file\|->]`                         | starts a run after the approval of the plan                                                                                      |
| `state round`                                                          | counts one more round; exit 1 when the run has no more rounds                                                                    |
| `state review -`                                                       | records the findings of a review pass (JSON on stdin), prints `NEXT:`                                                            |
| `metrics` / `metrics record -`                                         | summary of finished runs / record the run (JSON on stdin)                                                                        |
| `writing`                                                              | the writing rules for the prompts: STE rules and the project guide (no config needed)                                            |
| `prose <file\|-…> [--strict]` / `prose --rules`                        | STE-lite writing check (no config needed) / print the rules                                                                      |

<!-- prose-ignore -->

Exit codes: 0 ok; 1 a check failed (also: `get` found no value, `docs` found old docs in `require` mode, `scope` found files outside the plan, `plan check` or `state start` found missing parts, `repro` found that the bug still shows, `state round` found no more rounds, `prose --strict` found writing issues); 2 config not valid, or a usage error (unknown subcommand, option, unit or kind); 3 no config, or a config without `"version": 1`.

To run it without permission prompts, add this allow rule to the settings of the project:
`Bash(node *workflow-core*/scripts/wc.mjs *)`.
