| unit | check     | result  |
| ---- | --------- | ------- |
| api  | typecheck | ❌ fail |
| api  | test      | ❌ fail |
| web  | typecheck | ❌ fail |

## Failures

- [caused] api — tsc: src/handler.ts: TS2322: Type 'string' is not assignable to type 'number'.
- [unsure] web — tsc: src/page.tsx: TS2339: Property 'title' does not exist on type 'Task'. — related touched file: packages/api/src/types.ts
- [pre-existing] api — test — test/legacy.test.mjs: ✖ legacy ids are zero-padded to four digits — 'T7' !== 'T0007' (spec and src/legacy.mjs untouched)

## Skipped

none

RESULT: FAIL (1 caused, 1 unsure, 1 pre-existing)
