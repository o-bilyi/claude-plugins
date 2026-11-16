# claude-plugins

A Claude Code plugin marketplace. It currently holds one plugin, **workflow-core**.

## workflow-core

A config-driven plan → preflight → implement → test → review → PR workflow for Claude Code. It works
the same way in a single repo, a monorepo or a workspace of several git repos.

- **Agents:** a planner the main session follows, plus implementer, tester and reviewer subagents with
  fixed output contracts (`RESULT:` and `REVIEW:` lines).
- **Skills:** `feature-workflow` (the whole loop), `verify` (checks for the touched units) and `pr` (one
  PR per touched repo).
- **Hooks:** guards for protected files and commands, formatting on edit, and a Stop hook that
  verifies the files the session edited. With a baseline, only errors the change introduced block.
- **`/workflow-core:init`** inspects the project and writes `.claude/workflow.config.json`, the only
  place a project describes itself (units, check commands, branches, PR title format, guards).

See the [plugin README](plugins/workflow-core/README.md) for the config reference, hooks and CLI.

## Install

```
/plugin marketplace add o-bilyi/claude-plugins
/plugin install workflow-core@obilyi-plugins
/workflow-core:init
```

The marketplace is named `obilyi-plugins`, not `claude-plugins`, because Claude Code reserves names that
look like official Anthropic marketplaces.

To have everyone who opens a project get the plugin, declare it in the project's committed
`.claude/settings.json`:

```json
{
	"extraKnownMarketplaces": {
		"obilyi-plugins": {
			"source": { "source": "github", "repo": "o-bilyi/claude-plugins" }
		}
	},
	"enabledPlugins": {
		"workflow-core@obilyi-plugins": true
	}
}
```

## Requirements

- Node.js 20 or later (the scripts use Node built-ins only)
- git
- macOS or Linux (Windows is not supported)

## Development

```
npm install
npm test             # workflow-core unit tests (node:test, temporary git repos)
npm run format       # prettier; npm run format:check in CI
```

The agent evals in [plugins/workflow-core/evals](plugins/workflow-core/evals/README.md) call the paid
Claude API, so they run only on demand.

### Releasing a change

1. Make the change under `plugins/workflow-core/` with tests; `npm test` and `npm run format` from the
   repo root.
2. If you changed an agent prompt (`agents/*.md`), re-run its eval.
3. Bump `version` in `plugins/workflow-core/.claude-plugin/plugin.json` and the version assertion in
   `tests/structure.test.mjs`.
4. Add a section to the [CHANGELOG](plugins/workflow-core/CHANGELOG.md), and update the README and
   `docs/design.md` when behavior changes.
5. Merge to `main`. Users pick it up with `/plugin marketplace update obilyi-plugins`.

## Links

- [workflow-core README](plugins/workflow-core/README.md)
- [CHANGELOG](plugins/workflow-core/CHANGELOG.md)
- [Security policy](SECURITY.md)
- [License (MIT)](LICENSE)
