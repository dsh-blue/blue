// Real-process smoke (D45, in CI): boots the shipped Blue plugin tree
// through the real dsh CLI in a throwaway profile, drives one turn against
// a local mock LLM whose reply is deliberately width-hostile (an unbroken
// 160-column token, CJK, emoji, a deep path), and renders the whole session
// at COLUMNS=40 — narrow enough that any untruncated row trips pi-tui's
// width guard and kills the process. Green means: exit 0, the statusline
// and the pathological reply both rendered, no width-guard crash, and the
// D45 exit clamp's blue-overflow.log stays empty (a clamped row is still a
// component bug). Run: pnpm smoke:happy

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertDshVersion,
  cleanOutput,
  installIntoThrowawayProfile,
  registerCleanup,
  resolveDshBin,
  root,
} from './smoke-lib.mjs'

const require = createRequire(import.meta.url)
const dshBin = resolveDshBin()
assertDshVersion(dshBin)
const profile = process.env.SMOKE_PROFILE ?? 'blue-smoke'

// Width-hostile reply: every row-shape family the width-scan corpus holds.
const PATHOLOGICAL = [
  `unbroken-${'x'.repeat(160)}`,
  '你好，世界。宽度守卫崩溃族修复：中文长句在窄终端下逐行折返而不溢出。',
  'family 👨‍👩‍👧‍👦 tone ✌🏽 flags 🇨🇳 spark ✨',
  '/home/x/dev/deepseek-harness-plugin/blue/blue/.claude/worktrees/a-rather-deep-checkout-name/src',
].join('\n')

const { home, piAgent, envFor } = installIntoThrowawayProfile(dshBin, profile)
registerCleanup(home)

const { startMockLlmServer } = require('@deepseek-ai/dsh-llm-mock-server')
const server = await startMockLlmServer({
  port: 0,
  sequence: ['success'],
  repeatLast: true,
  successText: PATHOLOGICAL,
  chunkSize: 6,
  chunkDelayMs: 5,
})

console.log(`==> Booting dsh --profile ${profile} at COLUMNS=40 against the mock LLM`)
const dsh = spawn(dshBin, ['--profile', profile], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: envFor({
    DEEPSEEK_BASE_URL: `${server.baseURL}/v1`,
    DEEPSEEK_API_KEY: 'blue-smoke-key',
    COLUMNS: '40',
    LINES: '24',
    NO_COLOR: '1',
  }),
})

let out = ''
let exitCode = null
dsh.stdout.on('data', chunk => { out += String(chunk) })
dsh.stderr.on('data', chunk => { out += String(chunk) })
dsh.on('exit', code => { exitCode = code })

const deadline = Date.now() + 120_000
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(predicate, label) {
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(200)
  }
  console.error(`FAIL: timed out waiting for ${label}`)
  return false
}

const clean = () => cleanOutput(out)

// Boot marker: the statusline's model label (the banner mounts only after
// a session attaches, which the fresh boot does not have yet).
if (!(await waitFor(() => clean().includes('deepseek-v4-flash'), 'the statusline boot frame'))) {
  console.error(clean().slice(-2500))
  dsh.kill()
  await server.close()
  process.exit(1)
}

dsh.stdin.write('ping\r')
if (!(await waitFor(() => clean().includes(PATHOLOGICAL.slice(0, 24)), 'the streamed reply'))) {
  console.error(clean().slice(-2500))
  dsh.kill()
  await server.close()
  process.exit(1)
}

// The turn settled: quit through the app's own double-Ctrl-C path, then
// EOF, then force.
dsh.stdin.write('\x03')
await sleep(400)
dsh.stdin.write('\x03')
if (!(await waitFor(() => exitCode !== null, 'exit after double Ctrl-C'))) {
  dsh.stdin.end()
  if (!(await waitFor(() => exitCode !== null, 'exit after EOF'))) {
    console.error(clean().slice(-1500))
    dsh.kill('SIGKILL')
    await server.close()
    process.exit(1)
  }
}
await server.close()

const overflowLog = join(piAgent, 'blue-overflow.log')
const overflow = existsSync(overflowLog) ? readFileSync(overflowLog, 'utf8') : ''
const final = clean()
const ok = exitCode === 0
  && final.includes('deepseek-v4-flash')
  && final.includes(PATHOLOGICAL.slice(0, 24))
  && !final.includes('exceeds terminal width')
  && !final.includes('pi-crash.log')
  && overflow.trim() === ''
if (!ok) {
  console.error(`FAIL: exit=${exitCode}`)
  if (overflow.trim() !== '') {
    console.error('--- blue-overflow.log (clamped rows are component bugs) ---')
    console.error(overflow.slice(-2000))
  }
  console.error('--- output tail ---')
  console.error(final.slice(-2500))
  process.exit(1)
}
console.log(`HAPPY_SMOKE_PASS exit=${exitCode}`)
