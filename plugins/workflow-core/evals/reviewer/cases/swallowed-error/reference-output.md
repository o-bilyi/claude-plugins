## Blocking

- B1 [correctness] src/settings.mjs:11 — the `catch` hides the write error and returns `null` — a missing directory
  gives `null`, the settings screen shows no error, and A2 is false — remove the `try`/`catch`

## Should fix

none

## Nits

none

## Checked and fine

- A1 holds: `saveSettings` writes JSON that `loadSettings` reads.

REVIEW: BLOCKING (1)
