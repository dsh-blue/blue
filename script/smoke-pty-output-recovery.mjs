// Real-process regression for Host stdout/stderr bypassing the alternate-
// screen renderer. A child preload logs a large JSON value after the turn has
// settled; Blue must repaint the editor/footer cells, and Up must recover the
// user's prompt rather than the out-of-band JSON.

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
const { Terminal: HeadlessTerminal } = require('@xterm/headless')
const { startMockLlmServer } = require('@deepseek-ai/dsh-llm-mock-server')

try {
  const store = join(import.meta.dirname, '..', 'node_modules', '.pnpm')
  if (existsSync(store)) {
    for (const entry of readdirSync(store)) {
      if (!entry.startsWith('node-pty@')) continue
      const helper = join(store, entry, 'node_modules', 'node-pty', 'spawn-helper')
      if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755)
    }
  }
} catch {
  // The smoke reports spawn failures below; permission probing is best effort.
}

const dshBin = resolveDshBin()
assertDshVersion(dshBin)
const { home, envFor } = installIntoThrowawayProfile(dshBin, 'blue-smoke-pty-output')
registerCleanup(home)
const preload = join(import.meta.dirname, 'fixtures', 'output-bleed.mjs')

const server = await startMockLlmServer({
  port: 0,
  sequence: ['success'],
  repeatLast: true,
  successText: 'turn-finished',
  chunkDelayMs: 0,
})

const term = pty.spawn(dshBin, ['--profile', 'blue-smoke-pty-output'], {
  name: 'xterm-256color',
  cols: 56,
  rows: 24,
  cwd: '/tmp',
  env: envFor({
    DEEPSEEK_BASE_URL: `${server.baseURL}/v1`,
    DEEPSEEK_API_KEY: 'blue-smoke-key',
    NODE_OPTIONS: `--import=${preload}`,
    COLUMNS: undefined,
    LINES: undefined,
  }),
})
const vt = new HeadlessTerminal({ cols: 56, rows: 24, scrollback: 1000, allowProposedApi: true })
let out = ''
let exitCode = null
term.onData(data => {
  out += data
  vt.write(data)
})
term.onExit(({ exitCode: code }) => { exitCode = code })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = Date.now() + 120_000
async function waitFor(predicate, label) {
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function screen() {
  await new Promise(resolve => vt.write('', resolve))
  const buffer = vt.buffer.active
  return Array.from({ length: vt.rows }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '')
}

const clean = () => cleanOutput(out)
try {
  await waitFor(() => clean().includes('deepseek-v4-flash'), 'statusline')
  term.write('history prompt\r')
  await waitFor(() => clean().includes('turn-finished'), 'settled turn')
  await sleep(300)

  await waitFor(() => clean().includes('[cordis:bleed-fixture]'), 'delayed Host console output')
  if (!clean().includes('host-bleed-35')) throw new Error('large Host JSON did not reach the raw PTY stream')

  await sleep(250)
  const recovered = (await screen()).join('\n')
  if (recovered.includes('[cordis:bleed-fixture]') || recovered.includes('host-bleed-')) {
    throw new Error('Host JSON remained in the renderer frame')
  }
  if (!recovered.includes('deepseek-v4-flash')) throw new Error('footer was not restored')

  term.write('\x1b[A')
  await sleep(250)
  const history = (await screen()).join('\n')
  if (!history.includes('history prompt')) throw new Error('Up did not restore the user prompt')
  if (history.includes('host-bleed-')) throw new Error('Host JSON entered editor history')

  term.write('\x03')
  await sleep(400)
  term.write('\x03')
  await sleep(400)
  term.write('\x03')
  await waitFor(() => exitCode !== null, 'clean exit')
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`)
  console.error((await screen()).join('\n'))
  console.error(clean().slice(-3000))
  term.kill()
  vt.dispose()
  await server.close()
  process.exit(1)
}

await server.close()
vt.dispose()
const final = clean()
if (exitCode !== 0 || final.includes('exceeds terminal width') || final.includes('Uncaught')) {
  console.error(`FAIL: exit=${String(exitCode)}`)
  console.error(final.slice(-3000))
  process.exit(1)
}
console.log(`PTY_OUTPUT_RECOVERY_PASS exit=${String(exitCode)}`)
