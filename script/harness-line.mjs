// Single source for the pinned harness line: prints the HARNESS_LINE
// constant extracted from packages/interaction/src/session-commands.ts
// (the same read smoke-lib.mjs performs), so CI and scripts never carry a
// second version literal. Exits 1 when the constant is missing.

import { harnessLine } from './smoke-lib.mjs'

if (harnessLine === undefined) {
  console.error('harness-line: HARNESS_LINE constant not found in packages/interaction/src/session-commands.ts')
  process.exit(1)
}
console.log(harnessLine)
