// A66: the maintenance and probe scripts the tests import are plain `.mjs` with no type declarations, so the
// test typecheck (tsconfig.test.json) would report TS7016 "could not find a declaration file" for each import.
// They are untyped JS, so their test imports are typed `any` here. This does NOT weaken the check A66 adds —
// that the test files type-check against the SRC (`.ts`) types, which is where the drift this defect is about
// hides. A hand-written `.d.ts` per script (giving printable.mjs et al. real types) is a separate enhancement.
declare module '*.mjs';
