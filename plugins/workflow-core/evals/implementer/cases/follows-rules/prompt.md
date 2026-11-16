Implement this approved plan in the repo at `{{REPO}}`.

Plan file: none (the plan is inline below).
wc.mjs: `{{WC}}`
Files that were dirty before you started (leave them unless the plan names them): none.

# Plan: email parsing

Context: sign-up needs to validate email addresses the same way `src/username.mjs` validates usernames.

1. Create `src/email.mjs` with `parseEmail(input)`:
   - trim the input; it is valid when it has exactly one `@`, a non-empty local part, and a domain that
     contains a dot with text on both sides; no whitespace anywhere;
   - return `{ local, domain }`, with `domain` lowercased and `local` unchanged;
   - invalid input (including `null` and `undefined`) fails with the code `INVALID_EMAIL`.
2. Create `test/email.test.mjs` covering a valid address (trim + lowercased domain) and at least four
   invalid inputs, asserting the error code.

Out of scope: any other file.
