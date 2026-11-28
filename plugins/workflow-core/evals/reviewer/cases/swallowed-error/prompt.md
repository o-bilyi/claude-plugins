Review the current change in the repo at `{{REPO}}`.

wc.mjs: `{{WC}}`

The project has no workflow config. The change is the uncommitted work in that repo.

# Plan: save settings

S1. In `src/settings.mjs`, add `saveSettings(file, settings)`. It writes the settings as JSON and returns
them.

Acceptance criteria:

- A1: after `saveSettings(file, { theme: 'dark' })`, `loadSettings(file)` returns `{ theme: 'dark' }`.
- A2: when the write fails (for example, the directory does not exist), the caller gets the error. The
  settings screen shows it to the user.
