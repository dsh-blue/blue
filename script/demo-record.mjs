// Deterministic demo recorder (promo assets): boots the real dsh CLI with the
// Blue plugin under a 120x30 pseudo-terminal in a scratch git repo, drives a
// scripted conversation against the local mock LLM (a `read` tool call, then a
// streaming markdown answer, then the slash dropdown and the /help panel), and
// captures the raw terminal stream as an asciinema v2 .cast. Rendering to
// GIF/PNG is demo-render.mjs's job; this script only records and asserts.
// Run: pnpm demo:record   (self-contained: installs its own throwaway profile)
// Knobs: DEMO_COLS / DEMO_ROWS / DEMO_OUT / DEMO_PROFILE

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, chmodSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  assertDshVersion,
  cleanOutput,
  installIntoThrowawayProfile,
  registerCleanup,
  resolveDshBin,
  root,
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
  // Recording reports its own failures; permission probing stays silent.
}

const COLS = Number(process.env.DEMO_COLS ?? 120)
const ROWS = Number(process.env.DEMO_ROWS ?? 30)
const PROFILE = process.env.DEMO_PROFILE ?? 'blue-demo'
const OUT = process.env.DEMO_OUT ?? join(root, 'docs/assets/demo.cast')

// The scripted conversation. The task is TYPED (not passed on the CLI): a
// fresh boot shows no banner — it mounts on the first session attach — so
// typing the prompt shows the editor, then reveals the banner as the session
// starts. The first mock reply is a `bash` tool call (the four-option
// approval panel when the profile asks, then the terminal-output card with
// the real command output), the post-tool reply streams slowly (chunkDelayMs
// only paces `slow_success` — a plain `success` blasts the whole text in one
// burst, which reads terribly in a GIF). Content stays English-only: the
// vendored JetBrains Mono carries no CJK glyphs.
const TASK = 'Look at README.md and give me the 30-second tour.'
// The reply's first line doubles as the session title (the harness's title
// generator sees the mock's repeat-last reply) — keep it a clean short line.
const REPLY = [
  'A 30-second tour of gauge',
  '',
  '## What it is',
  'A zero-dependency renderer for Unicode gauges in the terminal — small, focused, and readable end to end.',
  '',
  '## How it fits together',
  '- `src/render.js` — the renderer core, one exported function',
  '- `src/parse.js` — spec-string parser, e.g. `75/100|CPU`',
  '- `bin/gauge.js` — a thin CLI wrapper over the two',
  '',
  '## Install',
  '```sh',
  'npm i -g gauge-term',
  '```',
  '',
  '## Usage',
  '```js',
  "import { render } from 'gauge-term'",
  "console.log(render('75/100|CPU'))",
  '```',
  '',
  'That is the whole project. Happy hacking!',
].join('\n')
const REPLY_END = 'Happy hacking!'

// A believable scratch repo: the demo cwd, so the footer shows a clean `main`
// branch and the read card previews real content. Lives under the throwaway
// home, so cleanup removes it with the profile.
const SCRATCH_README = [
  '# gauge',
  '',
  'A zero-dependency renderer for Unicode gauges in the terminal.',
  '',
  '## Install',
  '',
  '```sh',
  'npm i -g gauge-term',
  '```',
  '',
  '## Usage',
  '',
  '```js',
  "import { render } from 'gauge-term'",
  "console.log(render('75/100|CPU'))",
  '```',
  '',
  '## Layout',
  '',
  '- `src/render.js` — renderer core',
  '- `src/parse.js` — spec-string parser',
  '- `bin/gauge.js` — CLI wrapper',
  '',
  'MIT.',
  '',
].join('\n')

function makeScratchRepo(home) {
  const dir = join(home, 'gauge')
  mkdirSync(join(dir, 'src'), { recursive: true })
  mkdirSync(join(dir, 'bin'), { recursive: true })
  writeFileSync(join(dir, 'README.md'), SCRATCH_README)
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'gauge-term', version: '1.2.0', license: 'MIT', bin: { gauge: 'bin/gauge.js' } }, null, 2) + '\n',
  )
  writeFileSync(join(dir, 'src/render.js'), 'export function render(spec) {\n  const { value, max, label } = parse(spec)\n  /* …bar of `value` out of `max`… */\n}\n')
  writeFileSync(join(dir, 'src/parse.js'), 'export function parse(spec) {\n  /* `75/100|CPU` → { value: 75, max: 100, label: "CPU" } */\n}\n')
  writeFileSync(join(dir, 'bin/gauge.js'), '#!/usr/bin/env node\nimport { render } from "../src/render.js"\n')
  const identity = ['-c', 'user.name=Demo User', '-c', 'user.email=demo@example.com']
  const git = (args) =>
    spawnSync('git', [...identity, ...args], { cwd: dir, encoding: 'utf8' })
  git(['init', '-b', 'main'])
  git(['add', '.'])
  git(['commit', '-m', 'gauge 1.2.0'])
  return dir
}

const dshBin = resolveDshBin()
assertDshVersion(dshBin)
const { home, envFor } = installIntoThrowawayProfile(dshBin, PROFILE)
registerCleanup(home)
const scratch = makeScratchRepo(home)

const { startMockLlmServer } = require('@deepseek-ai/dsh-llm-mock-server')
const server = await startMockLlmServer({
  port: 0,
  sequence: ['tool_call_success', 'slow_success'],
  // The harness fires non-transcript LLM requests alongside the conversation
  // (the session-title provider); repeat-last keeps them from exhausting the
  // script (the smoke scripts ride the same posture).
  repeatLast: true,
  toolName: 'bash',
  toolArguments: JSON.stringify({ command: 'cat README.md', description: 'Read the project README' }),
  successText: REPLY,
  chunkSize: 16,
  chunkDelayMs: 90,
})

// --- .cast (asciinema v2) capture -------------------------------------------
const recorded = Date.now()
const events = []
let out = ''
let exitCode = null
const note = (type, data) => {
  events.push([Number(((Date.now() - recorded) / 1000).toFixed(6)), type, data])
}
const writeCast = () => {
  mkdirSync(join(root, OUT.slice(0, OUT.lastIndexOf('/'))), { recursive: true })
  const header = {
    version: 2,
    width: COLS,
    height: ROWS,
    timestamp: Math.floor(recorded / 1000),
    env: { TERM: 'xterm-256color', SHELL: '/bin/bash' },
  }
  const lines = [JSON.stringify(header), ...events.map(event => JSON.stringify(event))]
  writeFileSync(OUT, `${lines.join('\n')}\n`)
}

console.log(`==> Demo record: dsh --profile ${PROFILE} at ${COLS}x${ROWS}, cwd ${scratch}`)
const term = pty.spawn(dshBin, ['--profile', PROFILE], {
  name: 'xterm-256color',
  cols: COLS,
  rows: ROWS,
  cwd: scratch,
  // A PTY provides its own size; the COLUMNS/LINES carried in the ambient
  // environment must not win over it.
  env: envFor({
    DEEPSEEK_BASE_URL: `${server.baseURL}/v1`,
    DEEPSEEK_API_KEY: 'blue-demo-key',
    COLUMNS: undefined,
    LINES: undefined,
  }),
})
term.onData(data => {
  out += data
  note('o', data)
})
term.onExit(({ exitCode: code }) => {
  exitCode = code
})

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deadline = Date.now() + 180_000
async function waitFor(predicate, label) {
  while (Date.now() < deadline) {
    if (predicate()) return true
    await sleep(200)
  }
  console.error(`FAIL: timed out waiting for ${label}`)
  return false
}
const clean = () => cleanOutput(out)
// Type like a human: per-character with a short settle, recorded as input
// events so the asciinema replay shows keystrokes.
async function type(text) {
  for (const ch of text) {
    term.write(ch)
    note('i', ch)
    await sleep(55)
  }
}

try {
  // 1. Boot: statusline and the empty editor, held for a beat.
  if (!(await waitFor(() => clean().includes('deepseek-v4-flash'), 'the statusline boot frame'))) throw new Error('boot')
  await sleep(1200)

  // 2. The task, typed like a human — the banner reveals as the session
  //    attaches on first submit.
  await type(TASK)
  term.write('\r')
  note('i', '\r')
  if (!(await waitFor(() => clean().includes('Welcome to Blue'), 'the banner'))) throw new Error('banner')
  await sleep(800)

  // 3. The `bash` tool: the terminal-output card titled with the command and
  //    carrying its real output. The demo profile auto-allows bash (no
  //    approval panel in this posture); should that change, accept the
  //    default after a readable hold.
  const approvalDue = Date.now() + 8000
  while (Date.now() < approvalDue && !clean().includes('Allow once')) await sleep(200)
  if (clean().includes('Allow once')) {
    await sleep(1700)
    term.write('\r')
    note('i', '\r')
  }
  if (!(await waitFor(() => clean().includes('cat README.md'), 'the bash tool card'))) throw new Error('bash-card')

  // 4. The streaming markdown answer.
  if (!(await waitFor(() => clean().includes(REPLY_END), 'the streamed markdown reply'))) throw new Error('reply')
  await sleep(2200)

  // 5. Session-mode toggle (Shift+Tab cycles normal ↔ yolo in this build):
  //    two presses land back on normal, both banner messages on record.
  for (let cycle = 0; cycle < 2; cycle += 1) {
    term.write('\x1b[Z')
    note('i', '\x1b[Z')
    await sleep(1800)
  }

  // 7. The todo pane (Ctrl-T): the dock pane toggles over the editor.
  term.write('\x14')
  note('i', '\x14')
  await sleep(2300)
  term.write('\x14')
  note('i', '\x14')
  await sleep(700)

  // 8. The slash dropdown — the live command registry with fuzzy filter and
  //    argument hints; shown, never submitted (the list's active item is a
  //    /resume session suggestion, and Enter there would send a message).
  await type('/')
  await sleep(2000)
  term.write('\x1b')
  note('i', '\x1b')
  await sleep(350)

  // 9. The double-Ctrl-C exit path (a Ctrl-C that dismisses an overlay does
  //    not arm the exit — send up to three, one beat apart).
  for (let attempt = 0; attempt < 3 && exitCode === null; attempt += 1) {
    term.write('\x03')
    note('i', '\x03')
    await sleep(500)
  }
  if (!(await waitFor(() => exitCode !== null, 'clean exit'))) throw new Error('exit')
} catch (error) {
  console.error(`FAIL: ${error.message}`)
  console.error('--- PTY output tail ---')
  console.error(clean().slice(-2500))
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
  console.error(final.slice(-2500))
  process.exit(1)
}
writeCast()
console.log(`DEMO_RECORD_PASS cast=${OUT} events=${events.length} duration=${((Date.now() - recorded) / 1000).toFixed(1)}s`)
