// Interactive PTY smoke (D45, manual — not in CI): boots the real dsh CLI
// with the Blue plugin under a real pseudo-terminal at a deliberately
// narrow 40 columns and drives it through the raw-mode key path — a turn
// against a local mock LLM, the slash-command dropdown (a WrappingSelectList
// width seat), double-Escape, and the double-Ctrl-C exit. Green means
// exit 0 with no width-guard crash and no uncaught frames.
// Run: pnpm smoke:pty (self-contained: installs its own throwaway profile)

import { createRequire } from 'node:module'
import { existsSync, readdirSync, chmodSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertDshVersion,
  cleanOutput,
  installIntoThrowawayProfile,
  registerCleanup,
  resolveDshBin,
} from './smoke-lib.mjs'

const require = createRequire(import.meta.url)
const pty = require('node-pty')

// macOS-local pitfall (the kimi-code fix-node-pty-perms pattern): pnpm
// stores can drop the execute bit on node-pty's spawn-helper; chmod it back
// where present. A no-op on Linux.
try {
  const store = join(import.meta.dirname, '..', 'node_modules', '.pnpm')
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('node-pty@')) continue
      const helper = join(store, entry, 'node_modules', 'node-pty', 'spawn-helper')
      if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) {
        chmodSync(helper, 0o755)
        console.log(`==> Restored spawn-helper execute bit under ${entry}`)
      }
    }
  }
} catch {
  // The smoke reports its own failures; permission probing stays silent.
}

const dshBin = resolveDshBin()
assertDshVersion(dshBin)
const { home, envFor } = installIntoThrowawayProfile(dshBin, 'blue-smoke-pty')
registerCleanup(home)

const PATHOLOGICAL = `unbroken-${'x'.repeat(160)}`

const { startMockLlmServer } = require('@deepseek-ai/dsh-llm-mock-server')
const server = await startMockLlmServer({
  port: 0,
  sequence: ['success'],
  repeatLast: true,
  successText: `${PATHOLOGICAL} done`,
  chunkSize: 6,
  chunkDelayMs: 5,
})

console.log('==> PTY boot: dsh --profile blue-smoke-pty at 40x24')
const term = pty.spawn(dshBin, ['--profile', 'blue-smoke-pty'], {
  name: 'xterm-256color',
  cols: 40,
  rows: 24,
  cwd: import.meta.dirname,
  // A PTY provides its own size; the COLUMNS/LINES carried in the ambient
  // environment must not win over it.
  env: envFor({
    DEEPSEEK_BASE_URL: `${server.baseURL}/v1`,
    DEEPSEEK_API_KEY: 'blue-smoke-key',
    COLUMNS: undefined,
    LINES: undefined,
  }),
})

let out = ''
let exitCode = null
term.onData(data => { out += data })
term.onExit(({ exitCode: code }) => { exitCode = code })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = Date.now() + 120_000
async function waitFor(predicate, label) {
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(200)
  }
  console.error(`FAIL: timed out waiting for ${label}`)
  return false
}

const clean = () => cleanOutput(out)

try {
  if (!(await waitFor(() => clean().includes('deepseek-v4-flash'), 'the statusline boot frame'))) throw new Error('boot')
  term.write('ping\r')
  if (!(await waitFor(() => clean().includes('unbroken-xxxx'), 'the streamed reply'))) throw new Error('reply')
  // The slash dropdown: WrappingSelectList at 40 columns.
  term.write('/')
  await waitFor(() => cleanOutput(out.slice(-4000)).includes('/'), 'the command dropdown')
  await sleep(400)
  term.write('\x1b')
  await sleep(250)
  term.write('\x1b')
  await sleep(250)
  // The double-Ctrl-C exit path.
  term.write('\x03')
  await sleep(400)
  term.write('\x03')
  if (!(await waitFor(() => exitCode !== null, 'clean exit'))) throw new Error('exit')
} catch (error) {
  console.error(`FAIL: ${error.message}`)
  console.error('--- PTY output tail ---')
  console.error(clean().slice(-2000))
  term.kill()
  await server.close()
  process.exit(1)
}
await server.close()

const final = clean()
const ok = exitCode === 0
  && !final.includes('exceeds terminal width')
  && !final.includes('Uncaught')
  && !final.includes('pi-crash.log')
if (!ok) {
  console.error(`FAIL: exit=${exitCode}`)
  console.error(final.slice(-2000))
  process.exit(1)
}
console.log(`PTY_SMOKE_PASS exit=${exitCode}`)
