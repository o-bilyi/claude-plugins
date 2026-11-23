---
description: Create .claude/workflow.config.json (v1) by inspecting this project
allowed-tools: Read, Glob, Grep, Write, AskUserQuestion, Bash(git *), Bash(ls *), Bash(node *), Bash(cat *)
---

# Create the workflow config

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`; run it as `node "<wc>" <command>`. The format is
described in `${CLAUDE_PLUGIN_ROOT}/docs/design.md` (§3; the appendix has one example per project shape). Git
always runs per repo: `git -C <repo> …`.

1. **Existing config:** if `.claude/workflow.config.json` exists, show it.
   - Without `"version": 1` it is from an older, unsupported release: say so and build a new config from
     the steps below (reuse its base branch, PR title format and commands where they still apply).
   - Otherwise ask whether to overwrite it, and stop unless the user says yes.

2. **Shape:**
   - `git -C . rev-parse --show-toplevel` fails and subdirectories have their own `.git`: a **multi-repo
     workspace**. One unit per repo dir (more if a repo is itself a monorepo).
   - A git repo with workspaces (`pnpm-workspace.yaml`, or `workspaces` in the root `package.json`): a
     **monorepo**. One unit per app or package that has its own checks; each unit's `triggers` are its dir
     plus the internal packages it depends on (`workspace:*`), with a trailing slash, e.g. `packages/ui/`.
   - Otherwise a **single app**: use the top-level `app` shorthand (dir `.`, whole repo).
   - No git at all: say so and ask whether to run `git init`; stop unless the user says yes.

3. **Checks per unit.** Read the unit's `package.json` scripts, `Makefile`, `.github/workflows/*.yml` run
   steps and README. Turn each into a direct binary from `node_modules/.bin`, run from the unit dir:
   - A script that is one tool call becomes that binary (`"lint": "oxlint"` → `./node_modules/.bin/oxlint`).
     Use `npm run` / `pnpm run` / `yarn` (from the lockfile) only when a script can't be reduced to one
     binary.
   - Never watch modes: `vitest run`, not `vitest`; no `--watch`.
   - **typecheck:** `tsc -b` when `tsconfig.json` has `references` (solution style); else `tsc --noEmit`.
     Add `"parser": "tsc"`.
   - **lint:** eslint → `run` `eslint -f json <dirs>` and `changed` `eslint -f json {code}` with
     `"parser": "eslint-json"`; oxlint → `oxlint -f unix <dirs>` / `oxlint -f unix {code}` with
     `"parser": "oxlint"`. Keep the project's flags (`--quiet`, `--max-warnings=0`, `--deny-warnings`).
     Project-wide tools (depcruise, custom audits) get `run` only and no parser.
   - **test:** `run` (`vitest run`, `jest`). Add `related` only for these two:
     - vitest: `vitest related --run --passWithNoTests {files}`
     - jest: `jest --findRelatedTests --passWithNoTests {files}`

     Add `fullWhen` only when shared code obviously affects every test (e.g. `src/shared/`).

   - Other CI-only steps (build, codegen checks): `kind: "other"`.
   - Non-JS: `pyproject.toml` → ruff/mypy/pytest; `go.mod` → `go vet ./...`, `go test ./...`;
     `Cargo.toml` → `cargo check`, `cargo clippy`, `cargo test`; set `extensions` to match.

4. **Format:** add a top-level `format` only when a formatter exists. Prettier:
   `./node_modules/.bin/prettier --write --ignore-unknown` with `"extensions": ["*"]`. When each repo of a
   workspace has its own prettier, add `"runFrom": "repo"`.

5. **Repos and branches:** don't set `baseBranch` (it comes from each repo's `origin/HEAD`). When a repo has
   branches like `develop`, `staging` or `qa` (`git -C <repo> branch -r`), ask which one PRs target and
   set `prTarget` (top level, or `repos.<dir>.prTarget` for a repo that differs).

6. **PR title:** `git -C <repo> log --oneline -30`. A consistent ticket key (e.g. `ABC-123`) →
   `pr.ticketPattern` (`ABC-[0-9]+`) and a `pr.titleFormat` matching the history (`{summary}: {ticket}`).
   Otherwise ask with AskUserQuestion; the default is `{"titleFormat": "{summary}"}` and no pattern. If
   branches carry no ticket keys, set `process.preflight.branchTicket` to `false`.

7. **Guards:** suggest, and include only what the user approves:
   - `blockedCommands` for scripts that start dev servers or watch runners (`npm start`, `vite`,
     `nodemon`, `expo start`, a `test` script that is watch mode), with a message naming the alternative;
     add `cwd` when the rule is for one unit only.
   - `protectedPaths` for generated or build output (`dist/**`, `ios/**` from prebuild, `.nx/**`) and
     committed migrations (`when: "tracked"`).

8. **Docs** (optional): ask whether the project keeps docs that must follow the code. Skip this step and
   leave `docs` out when it does not. Otherwise look for area or feature docs (`docs/`, ADR folders,
   files with `code_paths` frontmatter) and add a `docs` section: `areas` (glob of the docs that describe
   how things work now; each lists its code in a `code_paths` frontmatter list), `changes` and
   `newChange` (the folder of per-change records and the files a new one needs, e.g.
   `["README.md", "adr/*.md"]`), `guide` (the file with the docs writing rules), `ignore` (globs that never
   need docs: tests, lockfiles, generated code), `mode` (`warn` or `require`) and `enforceAt` (`pr` or
   `commit`). Suggest `requireCoverage: false` while some code has no area doc yet.

9. **Write and check:** write `.claude/workflow.config.json` (tabs; start from
   `${CLAUDE_PLUGIN_ROOT}/templates/workflow.config.json`; drop empty parts). Run `node "<wc>" doctor` and
   `node "<wc>" table`. Fix any validation error and run them again. Show the file, the table and the doctor
   output, then ask the user to review both and commit the file.
