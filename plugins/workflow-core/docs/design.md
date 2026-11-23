# workflow-core: design

How the plugin is put together and why. The user-facing reference is [README.md](../README.md).

## 1. Goals and non-goals

**Goal.** One plan → preflight → implement → test → review → report workflow that works unchanged in
three project shapes:

| Shape                | What makes it different                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| Single repo          | everything at the root; often pre-existing type or lint errors                              |
| Monorepo             | one git repo, several apps sharing packages; a change in a package touches several apps     |
| Multi-repo workspace | the project root is not a git repo; each subdirectory is its own repo with its own branches |

A project adapts the plugin only through data (`.claude/workflow.config.json`) and knowledge
(`CLAUDE.md`, `.claude/rules/`, its own skills and agents). The plugin contains no project, framework
or tracker names.

**Non-goals.** CI and deploy; non-git projects; Windows; editing the user's settings; stack detection
beyond Node in `init`; custom (regex) parsers.

**Design rules.**

1. Anything a script can decide is decided by a script (`wc.mjs`). Agents only do what needs
   judgment: planning, implementing, tagging `unsure` failures, reviewing.
2. Every config field has a real use in at least one of the three shapes. If none needs it, it is
   left out.
3. A project with no config is untouched: every hook exits 0, and skills point to `/workflow-core:init`.

## 2. Three layers

| Layer     | Contents                                                                                        | Lives in                                             |
| --------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Process   | phases, agent contracts (`RESULT:` / `REVIEW:` lines), round limit, generic prohibitions, hooks | plugin                                               |
| Facts     | units, repos, branches, check commands, parsers, PR format, guards, reviewers                   | `.claude/workflow.config.json`                       |
| Knowledge | code conventions, architecture, domain rules, domain skills and reviewers                       | `CLAUDE.md`, `.claude/rules/`, project skills/agents |

Rule of thumb: if a sentence mentions a framework, a path or a tracker, it is a fact or knowledge, not
process.

## 3. Data model

```
project root (CLAUDE_PROJECT_DIR; may or may not be a git repo)
└── repo   = a git work tree, found from each unit's dir
    └── unit = something checked on its own: an app, a package, or the whole repo
        └── check = one command (typecheck | lint | test | other), optionally with a parser
```

The config must have `"version": 1`. Any other file is rejected with a hint to re-run
`/workflow-core:init`. The full field reference is in the README; the points below are the design
decisions behind it.

- **Unit.** `dir` is required; `triggers` (path prefixes from the project root) default to `<dir>/`,
  and `""` means the whole repo. `notes` is prose for the planner and tester ("also verify web when
  an API type changes"). `"app": {…}` is shorthand for a single unit named `app` at `.`.
- **Repo.** A unit's repo is `git -C <root>/<dir> rev-parse --show-toplevel`. Every git command runs
  inside that repo (`git -C`), never at the project root. A unit outside any git work tree is reported
  by `doctor` and skipped everywhere else. `baseBranch` resolves as `repos[r]` → top level →
  `origin/HEAD` → `main`; `prTarget` as `repos[r]` → top level → the base branch.
- **Check.** Commands run from the unit dir through `sh -c`. `run` is the full run; `changed` takes
  `{code}` or `{files}` (the unit's touched files, unit-relative and shell-quoted); tests can add
  `related` and `fullWhen`. A command whose placeholder would be empty is skipped, and a command whose
  first token contains `/` but isn't executable is skipped with a warning.
- **Format.** `command` + `extensions` (`["*"]` = all) + `runFrom` (`root`, `repo` or `unit`). The most
  specific block wins: unit, then `repos[r]`, then top level.
- **PR.** `titleFormat` must contain `{summary}`; `{ticket}` requires a case-insensitive
  `ticketPattern`. The ticket comes from the arguments, then the branch name, then recent commits,
  else the user is asked.

**Which command runs** (one rule for verify, the tester and the Stop hook):

| Check                    | With a baseline for this check                                                  | Without a baseline                                                                   |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| typecheck / lint / other | `run`, then compare with the baseline                                           | `changed` if set, else `run` (errors filtered to touched files when a parser exists) |
| test                     | `run` if any touched file matches `fullWhen`, else `related` if set, else `run` | same                                                                                 |

Using `run` whenever a baseline exists keeps the comparison like-for-like: `changed` can lint files
that `run` never covers.

### 3.1 Parsers and error identity

A parser turns a check's stdout into **error lines**:

```
<tool>: <path relative to the unit dir>: <rule or code>: <message>
```

There are no line or column numbers, so edits that shift lines don't make old errors look new. Lines
are whitespace-squeezed and counted as a multiset, so a second copy of an existing error is new.
Parsers: `tsc`, `eslint-json` (`-f json`, ESLint 8 and 9) and `oxlint` (`-f unix`). Each ships with
fixtures recorded from real tool versions. Output a parser can't read makes the check fall back to its
exit code, with a warning. Checks without a parser are always exit-code only.

## 4. `wc.mjs` (script layer)

One Node CLI, Node built-ins only, `--json` on every subcommand: `doctor`, `units`,
`touched [--since-base]`, `table`, `get <path>`, `config`, `reviewers`, `check [unit…] [--stop]`,
`preflight`, `baseline save|status|clear`. Exit codes: 0 ok; 1 a check failed (or `get` found no
value); 2 invalid config or a usage error; 3 no config, or a config without `version: 1`. The guards are
separate hook scripts on the same library.

**Touched files.** Per repo: files that differ from `HEAD` (modified, deleted, untracked), as
`"<sha1> <path>"` entries. With a baseline, an entry counts only if it is **not** in `baseline/dirty`
with the same hash: a file that was dirty before the task stays out until it is edited again.
`--since-base` adds `git diff --name-only <base>...HEAD` (verify and PR). A unit is touched when a
touched file starts with one of its triggers.

## 5. Process

`feature-workflow` runs every phase from the main session (subagents can't start subagents, and their
questions don't reliably reach the user). A session that starts with "Implement the following plan:"
goes straight to preflight.

1. **Plan.** The main session follows `agents/planner.md`: a generic interview (behavior and roles,
   edge cases, contracts between units and repos, data and migrations, non-functional, scope and
   ticket) plus `planner.extraChecklist`. The planner reads `CLAUDE.md`, the touched units'
   `.claude/rules/` and the project's skills. The plan lists units, files, ordered steps, tests and
   checks, and ends with a standard `## Execution` section.
2. **Preflight.** Branch (with `branchTicket` and a `ticketPattern`, the branch should carry the
   ticket; the workflow never switches or creates branches itself), dirty files (the user says
   whether they belong to the task), then the baseline, recorded once per task.
3. **Implement.** `implementer` is started once with a name and resumed with `SendMessage` in every
   fix round.
4. **Test.** `tester` runs `wc.mjs check` for the touched units and tags every failure:

   | Tag            | Parser check, with a baseline | Parser check, without a baseline                                 | Tests and parser-less checks                   |
   | -------------- | ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
   | `caused`       | new vs the baseline (script)  | in a touched file (script)                                       | the failing spec is touched, or fails in one   |
   | `unsure`       | –                             | an untouched line that mentions something a touched file defines | the failing spec imports a touched module      |
   | `pre-existing` | in the baseline (script)      | every other untouched line                                       | the failing spec and its imports are untouched |

   The reply ends with `RESULT: PASS` or `RESULT: FAIL (<c> caused, <u> unsure, <p> pre-existing)`.
   PASS means no `caused` and no `unsure`.

5. **Review.** After PASS: the generic `reviewer`, then every agent in `reviewers[]` whose paths
   match. The reply ends with `REVIEW: CLEAN` or `REVIEW: BLOCKING (<n>)`. "Should fix" items go to
   the report and never start a round.
6. **Loop.** `caused`/`unsure` → implementer → tester; `BLOCKING` → implementer → tester → reviewers.
   After `process.maxRounds` rounds the session stops and asks. An implementer report that the right
   fix changes the plan also stops the loop.
7. **Report and PR.** Files per repo, dependency and lockfile changes, the final `RESULT:` and
   `REVIEW:` lines, and pre-existing failures listed separately. `/workflow-core:pr` opens one PR per
   touched repo against its `prTarget`. It verifies first, waits for confirmation before each push,
   and never force-pushes or commits on the base branch.

## 6. Hooks

| Event                                   | Hook           | Behavior                                                                                                   |
| --------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| PreToolUse `Edit\|Write`                | guard-files    | match `guards.protectedPaths`; exit 2 with the message                                                     |
| PreToolUse `Bash`                       | guard-bash     | match `guards.blockedCommands` against each command segment; exit 2 with the message                       |
| PostToolUse `Edit\|Write`               | format         | run the most specific `format`; never blocks                                                               |
| PostToolUse `Edit\|Write\|NotebookEdit` | track-edit     | append the edited path to `sessions/<session_id>` of its repo; never blocks                                |
| Stop                                    | verify-changed | `check --stop`, limited to the files this session edited; exit 2 with `caused` lines or raw failure output |
| SessionStart                            | session-start  | one line per repo: `branch=… changed=N baseline=yes/no`                                                    |

- The Stop hook scope is the session's own edits, so the user's uncommitted work never blocks a
  session. Changes made only through Bash (`git mv`, codemods) are not recorded; the tester catches
  them. Each state is checked once: a fingerprint is shared with the tester.
- Guard globs are relative to the project root and support `*`, `**` and `?`. `when: "tracked"`
  blocks only files git tracks, so new files can still be created. Command regexes are tested per
  segment (split on newlines, `;`, `&&`, `||`, `&`, `|`, parentheses, outside quotes). A `cwd` limits a
  rule to commands run from, `cd`-ed into, or naming that dir.

## 6.1 Docs check

Optional, like every project fact: no `docs` section, no check. The split of work follows design rule 1.
`lib/docs.mjs` decides deterministically what the change still needs (stale areas, uncovered files, new
scope without a change record); the `documenter` agent writes the prose.

- **Areas own the mapping.** The code each area covers is the `code_paths` list in the area doc's own
  frontmatter, not in the config, so the doc and its mapping change together and cannot drift apart.
- **New scope is a diff of coverage.** A file is new scope when the areas cover it now but did not at the
  base (the branch's merge base, or `HEAD` for a commit). That catches a new feature without guessing from
  file names: writing its area doc, or widening `code_paths`, is what marks it new.
- **Written once, at the end.** Docs follow the code after it is approved, so fix rounds never rewrite
  them. `feature-workflow` does not write docs; `/workflow-core:docs` runs at commit or PR time.
- **Where it blocks.** `enforceAt: "pr"` (default) lets work-in-progress commits through with a warning
  and requires docs for the branch in `/workflow-core:pr` and CI, which suits squash-merged PRs.
  `enforceAt: "commit"` blocks each commit in the Bash guard. A `Docs-Skip: <reason>` trailer is the
  explicit, reviewable way out.

## 7. State on disk

Per repo, under `$(git -C <repo> rev-parse --git-path workflow-core)`:

```
baseline/dirty                     "<sha1> <path>" for files dirty at preflight
baseline/meta.json                 when it was saved, HEAD, per-check counts or skip reasons
baseline/<unit>/<check>.errors     error lines at preflight, with counts
checked/<unit>.fp                  fingerprint of the last passing state (Stop hook and tester)
sessions/<session_id>              repo-relative paths the session edited (Stop hook scope)
tsbuildinfo/<unit>/<check>         incremental tsc state
```

Nothing is written to the work tree or to `.claude/`. Fingerprint = sha1 of HEAD, the touched entries
under the unit's triggers, the unit's resolved config and the baseline.

## 8. Agents

| Agent                                        | Model (frontmatter) | Tools                       | Contract                     |
| -------------------------------------------- | ------------------- | --------------------------- | ---------------------------- |
| planner (procedure the main session follows) | opus                | read-only + AskUserQuestion | §5 step 1                    |
| implementer                                  | sonnet              | edit                        | prohibitions below; fix mode |
| tester                                       | haiku               | read-only + Bash            | `RESULT:` line               |
| reviewer                                     | sonnet              | read-only + Bash            | `REVIEW:` line               |

The implementer runs on sonnet. The plan (opus, main session) carries the reasoning, and haiku passed
the implementer evals (§9), but those cases do not test the structure rules: putting new logic in its
own hook or component instead of growing an existing one. A weaker writer there costs a review round
each time, so the implementer matches the reviewer. The round limit catches a model that can't finish.
A project that needs a different model overrides the agent with its own.

Implementer prohibitions: no dependency installs or changes unless the plan says so; never hand-edit
lockfiles, and report any lockfile change; never weaken, skip or delete tests; no commits, branches or
pushes; no dev servers; never read or write `.env` files; don't touch files that were dirty at
preflight unless the plan names them; stop and report when a step is unclear or the right fix changes
the plan. In fix mode it fixes every `caused` failure and blocking finding, investigates `unsure`
ones, leaves `pre-existing` alone, and classifies a failing test as a bad test, a product bug or an
environment issue.

## 9. Evaluation

Unit tests cover the script layer (`wc.mjs`, parsers, hooks) against temporary git repos. The agent
layer has evals (`evals/`): fixture scenarios with known answers, run several times per model. They
cover only what the model decides, which is `unsure` tags, test-failure tags, safety rules, and the
exact `RESULT:` line. Evals call the real `claude` CLI, so they run on demand, never in CI.

**Implementer** (7 cases × 3 runs × haiku and sonnet). The cases are small tasks with an approved
plan, some with a seeded follow-up failure. Measured: rounds to PASS, tests weakened (must be 0),
edits outside the plan. Both models passed every grader in every run, with 0 safety violations. Both
hit the ceiling, so harder cases (including structure) are needed before the suite can separate models;
until then the implementer runs on sonnet (§8).

**Tester** (13 cases on the real `wc.mjs check`, with stubbed tsc/eslint and real `node --test`).
Measured: false PASS (must be 0), tag accuracy (target ≥ 90%), exact `RESULT:` format (100%). In the
first run both models had 0 false PASS and 98% tag accuracy. Format misses (text after the `RESULT:`
line, a report inside a code fence) led to an explicit format rule in `agents/tester.md`. After
that, haiku passed 65/65 runs on every metric, so the tester stays on haiku.

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
