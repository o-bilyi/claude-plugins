# Code rules (src/)

- Named exports only. Never `export default`.
- Errors: throw `AppError` from `src/errors.mjs` with a code (`new AppError('SOME_CODE', message)`).
  Never throw a plain `Error`.
- No `console.log` (or any other `console.*`) in `src/`.
- Every module in `src/` has a test file in `test/` named `<module>.test.mjs`.
