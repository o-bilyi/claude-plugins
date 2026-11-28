# Plan: 20 MB uploads

**Units, repos and files:** `.` — `config/limits.json`, `test/upload.test.mjs`.

**No-code option:** set `maxUploadMb` to `20` in `config/limits.json`. `checkUpload` already reads it.

**Reference implementation:** none.

**Steps**

- S1. In `config/limits.json`, set `maxUploadMb` to 20.
- S2. In `test/upload.test.mjs`, change the "too large" test to 21 MB, and add a test for 20 MB.

**Reuse map:** S1 — `src/upload.mjs` — `checkUpload` — reads the limit; no code change.

**Acceptance criteria**

- A1: a 20 MB file passes.
- A2: a 21 MB file is too large.

**Out of scope:** the number of files per upload.

**Size estimate:** about 5 changed lines.

## Execution

Mode: full
Kind: feature
Plan file: none
Continue with `workflow-core:feature-workflow`: step 0, then step 2 (start the run), preflight, implement, test and review in a loop of at most `process.maxRounds` rounds, then report.
