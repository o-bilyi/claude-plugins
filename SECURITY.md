# Security policy

## Supported versions

Only the latest released version of each plugin gets security fixes. Update with
`/plugin marketplace update obilyi-plugins`.

## Threat model

Claude Code plugins have no sandbox: they run with the privileges of the user running Claude Code.
Review a plugin before you install it, as you would any code you run.

workflow-core installs these hooks:

| Hook             | Event                                   | What it does                                                                  |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| `guard-files`    | PreToolUse `Edit\|Write`                | blocks edits to paths listed in `guards.protectedPaths`                       |
| `guard-bash`     | PreToolUse `Bash`                       | blocks commands matching `guards.blockedCommands`                             |
| `format-file`    | PostToolUse `Edit\|Write`               | runs the project's configured `format.command` on the edited file             |
| `track-edit`     | PostToolUse `Edit\|Write\|NotebookEdit` | records the edited path for the current session                               |
| `verify-changed` | Stop                                    | runs the project's configured check commands for the files the session edited |
| `session-start`  | SessionStart                            | prints the branch and the number of changed files per repo                    |

- The hooks and the `wc.mjs` CLI run only commands from the project's own
  `.claude/workflow.config.json`, plus `git`. **Opening a project whose config you have not read means
  running its commands.** Treat that file like any other script in the repo.
- There are no network calls and no telemetry. The scripts use Node built-ins only and have no runtime
  dependencies.
- State (baselines, fingerprints, session edit lists) is written only under each repo's
  `.git/workflow-core` (`git rev-parse --git-path workflow-core`), never to the work tree.
- The agent evals in `plugins/workflow-core/evals` call the `claude` CLI and therefore the Claude API.
  They run only when you start them by hand.

## Reporting a vulnerability

Please report privately through GitHub: on the repository's **Security** tab, choose **Report a
vulnerability**. Don't open a public issue for security problems.

Include the affected version, a description and steps to reproduce. You can expect an acknowledgment
within 7 days. Once a fix is released, the report will be disclosed in the changelog, with credit if
you want it.
