// Real-process mouse smoke: boots the production Blue bundle through a
// pseudo-terminal, verifies button-motion mouse reporting, sends an SGR wheel
// report, and compares the rendered VT screen before/after the event. This is
// intentionally separate from the keyboard-focused smoke so a broken mouse
// path cannot hide behind a successful Ctrl-C/escape path.

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
  // The smoke reports failures below; permission probing is best effort.
}

const dshBin = resolveDshBin()
assertDshVersion(dshBin)
const { home, envFor } = installIntoThrowawayProfile(dshBin, 'blue-smoke-pty-mouse')
registerCleanup(home)

const { startMockLlmServer } = require('@deepseek-ai/dsh-llm-mock-server')
const successText = Array.from({ length: 60 }, (_, index) => `mouse-line-${String(index).padStart(2, '0')}`).join('\n')
const server = await startMockLlmServer({
  port: 0,
  sequence: ['success'],
  repeatLast: true,
  successText,
  chunkSize: 12,
  chunkDelayMs: 4,
})

const term = pty.spawn(dshBin, ['--profile', 'blue-smoke-pty-mouse'], {
  name: 'xterm-256color',
  cols: 40,
  rows: 24,
  cwd: import.meta.dirname,
  env: envFor({
    DEEPSEEK_BASE_URL: `${server.baseURL}/v1`,
    DEEPSEEK_API_KEY: 'blue-smoke-key',
    COLUMNS: undefined,
    LINES: undefined,
  }),
})
const vt = new HeadlessTerminal({ cols: 40, rows: 24, scrollback: 1000, allowProposedApi: true })
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
    await sleep(200)
  }
  console.error(`FAIL: timed out waiting for ${label}`)
  return false
}

async function screen() {
  await new Promise(resolve => vt.write('', resolve))
  const buffer = vt.buffer.active
  return Array.from({ length: vt.rows }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '')
}

const clean = () => cleanOutput(out)
try {
  if (!(await waitFor(() => clean().includes('deepseek-v4-flash'), 'statusline'))) throw new Error('boot')
  if (!out.includes('\x1b[?1002h') || !out.includes('\x1b[?1006h')) throw new Error('mouse reporting was not enabled')

  term.write('ping\r')
  if (!(await waitFor(() => clean().includes('mouse-line-59'), 'streamed transcript'))) throw new Error('reply')
  await sleep(600)
  const before = await screen()

  // SGR button 64 is wheel-up. The app must consume it as a viewport event,
  // not pass it through as editor input.
  term.write('\x1b[<64;2;2M')
  await sleep(400)
  const after = await screen()
  if (before.join('\n') === after.join('\n')) throw new Error('mouse wheel did not move the VT screen')

  term.write('\x03')
  await sleep(400)
  term.write('\x03')
  if (!(await waitFor(() => exitCode !== null, 'clean exit'))) throw new Error('exit')
} catch (error) {
  console.error(`FAIL: ${error.message}`)
  console.error(clean().slice(-2500))
  term.kill()
  vt.dispose()
  await server.close()
  process.exit(1)
}

await server.close()
vt.dispose()
const final = clean()
const ok = exitCode === 0 && !final.includes('exceeds terminal width') && !final.includes('Uncaught')
if (!ok) {
  console.error(`FAIL: exit=${exitCode}`)
  console.error(final.slice(-2500))
  process.exit(1)
}
console.log(`PTY_MOUSE_SMOKE_PASS exit=${exitCode}`)
