## Blocking

- B1 [plan] src/config.mjs:1 — the change sets `REQUEST_TIMEOUT_MS` from 30000 to 5000, and the plan puts every
  file except `src/greet.mjs` out of scope — slow requests now fail after 5 s — revert the file

## Should fix

none

## Nits

none

## Checked and fine

- S1 and A1: `greet` trims the name.

REVIEW: BLOCKING (1)
