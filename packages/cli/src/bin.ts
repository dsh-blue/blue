#!/usr/bin/env node
/**
 * The `blue` bin entry: nothing but the shebang and the hand-off — every
 * behavior lives in `main.ts` behind seams, so the specs drive the whole
 * launcher without ever executing this file.
 * @module @dsh-blue/blue-cli/bin
 */
import { main } from './main.ts'

// Run-as-binary only: under vitest (source-plane imports) this never fires.
/* v8 ignore next */
await main(process.argv.slice(2))

