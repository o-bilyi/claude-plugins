---
description: Create .claude/workflow.config.json (v1) by inspecting this project
allowed-tools: Read, Glob, Grep, Write, AskUserQuestion, Bash(git *), Bash(ls *), Bash(node *), Bash(cat *)
---

# Create the workflow config

`<wc>` below is `${CLAUDE_PLUGIN_ROOT}/scripts/wc.mjs`. Run it as `node "<wc>" <command>`. The format is
in `${CLAUDE_PLUGIN_ROOT}/docs/design.md` (§3, and the appendix has one example for each project shape).
Git always runs per repo: `git -C <repo> …`.

1. **Existing config:** if `.claude/workflow.config.json` exists, show it.
   - If it has no `"version": 1`, an older release wrote it, and this release does not support it. Tell the
     user. Then make a new config with the steps below.
   - Use its base branch, PR title format and commands again where they still apply.
   - If it has `"version": 1`, ask the user if you can replace it. Stop, unless the user says yes.

2. **Shape:**
   - `git -C . rev-parse --show-toplevel` fails, and subdirectories have their own `.git`: this is a
     **multi-repo workspace**. Make one unit for each repo dir, or more if a repo is a monorepo.
   - A git repo with workspaces (`pnpm-workspace.yaml`, or `workspaces` in the root `package.json`): this
     is a **monorepo**. Make one unit for each app or package that has its own checks.
     - The `triggers` of a unit are its dir and the internal packages that it uses (`workspace:*`).
     - Write each trigger with a slash at the end, for example `packages/ui/`.
   - All other projects are a **single app**. Use the `app` shorthand at the top level (dir `.`, the full
     repo).
   - No git: tell the user, and ask if you can run `git init`. Stop, unless the user says yes.

3. **Checks for each unit.** Read the `package.json` scripts, the `Makefile`, the run steps in
   `.github/workflows/*.yml` and the README of the unit. Make each one a direct binary from
   `node_modules/.bin` that runs from the unit dir.
   - A script with one tool call becomes that binary (`"lint": "oxlint"` → `./node_modules/.bin/oxlint`).
   - Use `npm run`, `pnpm run` or `yarn` (from the lockfile) only for a script that is more than one
     binary.
   - Never use watch modes: `vitest run`, not `vitest`. No `--watch`.
   - **typecheck:** use `tsc -b` when `tsconfig.json` has `references`. If not, use `tsc --noEmit`. Add
     `"parser": "tsc"`.
   - **lint, eslint:** `run` is `eslint -f json <dirs>`, and `changed` is `eslint -f json {code}`. Add
     `"parser": "eslint-json"`.
   - **lint, oxlint:** `run` is `oxlint -f unix <dirs>`, and `changed` is `oxlint -f unix {code}`. Add
     `"parser": "oxlint"`.
   - Keep the flags of the project (`--quiet`, `--max-warnings=0`, `--deny-warnings`).
   - Tools for the full project (depcruise, custom audits) get only `run` and no parser.
   - **test:** `run` is `vitest run` or `jest`. Add `related` only for these two:
     - vitest: `vitest related --run --passWithNoTests {files}`
     - jest: `jest --findRelatedTests --passWithNoTests {files}`

     Add `fullWhen` only when shared code clearly affects each test, for example `src/shared/`.

   - Other steps that only CI runs (build, codegen checks) get `kind: "other"`.
   - Unused code and duplicates: if the project has `knip` or `jscpd` installed, offer each as a check
     with `kind: "other"` and only `run`. For example: `./node_modules/.bin/knip --no-progress` and
     `./node_modules/.bin/jscpd --silent src`. Do not install them.
   - Other languages: `pyproject.toml` → ruff, mypy, pytest. `go.mod` → `go vet ./...`, `go test ./...`.
     `Cargo.toml` → `cargo check`, `cargo clippy`, `cargo test`. Set `extensions` to match.

4. **Format:** add a top-level `format` only when the project has a formatter.
   - Prettier: `./node_modules/.bin/prettier --write --ignore-unknown`, with `"extensions": ["*"]`.
   - When each repo of a workspace has its own prettier, add `"runFrom": "repo"`.

5. **Repos and branches:** do not set `baseBranch`. It comes from the `origin/HEAD` of each repo.
   - Look for branches like `develop`, `staging` or `qa` with `git -C <repo> branch -r`.
   - If a repo has them, ask which branch the PRs go to. Set `prTarget` at the top level, or
     `repos.<dir>.prTarget` for a repo that is different.

6. **PR title:** read `git -C <repo> log --oneline -30`.
   - The history has a ticket key, for example `ABC-123`: set `pr.ticketPattern` (`ABC-[0-9]+`) and a
     `pr.titleFormat` that matches the history (`{summary}: {ticket}`).
   - If not, ask the user with AskUserQuestion. The default is `{"titleFormat": "{summary}"}` and no
     pattern.
   - If the branch names have no ticket keys, set `process.preflight.branchTicket` to `false`.

7. **Guards:** suggest these, and add only the guards that the user approves:
   - `blockedCommands` for scripts that start dev servers or watch runners. Examples are `npm start`,
     `vite`, `nodemon`, `expo start`, and a `test` script in watch mode.
   - Give each one a message that names the alternative. Add `cwd` when the rule is for one unit.
   - `protectedPaths` for generated or build output (`dist/**`, `ios/**` from prebuild, `.nx/**`).
   - `protectedPaths` with `when: "tracked"` for committed migrations.

8. **Writing style:** ask the user which style the agents use for the text that people read. That text
   is the plans, reports, docs, PR descriptions, commit messages and code comments.
   - `ste100`: ASD-STE100 Simplified Technical English (`node "<wc>" prose --rules` shows the rules).
   - `plain`: no fixed style. Leave the `writing` section out.
   - For `ste100`, add `"writing": {"style": "ste100"}`. If the project has a writing guide, add its path as
     `writing.guide`.

9. **Reviewers:** ask if the user wants the `workflow-core:simplifier` reviewer. It looks only for code
   that the change can remove. If yes, add `{"agent": "workflow-core:simplifier", "paths": [""]}` to
   `reviewers`.

10. **Docs** (optional): ask if the project keeps docs that must follow the code. If not, skip this step,
    and leave `docs` out. If yes, look for area or feature docs: `docs/`, ADR folders, and files with
    `code_paths` frontmatter. Then add a `docs` section:
    - `areas`: the glob of the docs that tell how things work now. Each one lists its code in a
      `code_paths` frontmatter list.
    - `changes` and `newChange`: the folder of the records for each change, and the files that a new
      record needs, for example `["README.md", "adr/*.md"]`.
    - `guide`: the file with the rules for writing docs.
    - `ignore`: globs that never need docs, for example tests, lockfiles and generated code.
    - `mode` (`warn` or `require`) and `enforceAt` (`pr` or `commit`).
    - Suggest `requireCoverage: false` while some code has no area doc.

11. **Write and check:** write `.claude/workflow.config.json` with tabs. Start from
    `${CLAUDE_PLUGIN_ROOT}/templates/workflow.config.json`, and remove the empty parts.
    - Run `node "<wc>" doctor` and `node "<wc>" table`.
    - Fix each validation error, and run them again.
    - Show the file, the table and the doctor output. Then ask the user to examine them and commit the
      file.
