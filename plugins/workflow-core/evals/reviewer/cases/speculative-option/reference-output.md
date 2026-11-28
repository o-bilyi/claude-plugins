## Blocking

none

## Should fix

- F1 [reuse] src/slug.mjs:1 — the `separator` and `maxLength` options are out of scope, and no caller uses
  them — remove the options parameter: `slugify(title)`

## Nits

none

## Checked and fine

- A1 holds with the default options.

REVIEW: CLEAN
