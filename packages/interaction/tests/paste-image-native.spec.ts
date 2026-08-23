/**
 * Tests for the native clipboard probes (`paste-image-native.ts`): the
 * win32 PowerShell staging protocol (argv pinned against the script
 * literal, env-var handoff, kind/order staging layout, exit-code
 * classification, sniffed admission) and the darwin osascript
 * list-then-read negotiation (class parsing, direct coercions, the
 * Chromium TIFF→sips leg, Finder furl batches, soft-failure retention,
 * escapes). The helpers run as PATH-injected `#!/usr/bin/env node` fakes —
 * the paste-image suite's fake-tool pattern — branching on argv and the
 * FAKE_* environment the specs set per case.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'
import {
  escapeAppleScriptString,
  parseClipboardClasses,
  POWERSHELL_ARGS,
  probeDarwin,
  probeWindows,
} from '../src/paste-image-native.ts'
import { mkdtempTracked, registerTempDirCleanup } from '../../core/tests/temp-dir.ts'

registerTempDirCleanup()

/** A 1x1 PNG (the literal shape shared with the paste-image suite). */
const PNG_1X1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
  0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80, 15,
  0, 3, 134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

/** A 1x1 GIF (the literal shape shared with the paste-image suite). */
const GIF_1X1 = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 255, 255, 255, 0, 0, 0, 33, 249, 4, 1, 0, 0,
  0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
])

/** A JPEG magic prefix, the darwin direct-coercion bytes for image/jpeg. */
const JPEG_PREFIX = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
])

const IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 10 * 1024 * 1024,
  maxImagesPerMessage: 8,
  maxMessageImageBytes: 30 * 1024 * 1024,
  maxImagePixels: 16_777_216,
  maxImageDimension: 4096,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

/**
 * The PowerShell staging script this spec pins byte-for-byte: an edit to
 * the probe's `-Command` literal must land here too, deliberately.
 */
const EXPECTED_POWERSHELL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $stage = $env:BLUE_PASTE_STAGE
  if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
    $img = [System.Windows.Forms.Clipboard]::GetImage()
    try { $img.Save((Join-Path $stage 'clipboard.png'), [System.Drawing.Imaging.ImageFormat]::Png) }
    finally { $img.Dispose() }
    [System.IO.File]::WriteAllText((Join-Path $stage 'kind'), 'image', $utf8)
    exit 0
  }
  $drop = [System.Windows.Forms.Clipboard]::GetFileDropList()
  $names = New-Object System.Collections.Generic.List[string]
  if ($drop.Count -gt 0) {
    $filesDir = Join-Path $stage 'files'
    [System.IO.Directory]::CreateDirectory($filesDir) | Out-Null
    foreach ($item in $drop) {
      if (-not [System.IO.File]::Exists($item)) { continue }
      $name = [System.IO.Path]::GetFileName($item)
      $dest = Join-Path $filesDir $name
      if ([System.IO.File]::Exists($dest)) {
        $base = [System.IO.Path]::GetFileNameWithoutExtension($name)
        $ext = [System.IO.Path]::GetExtension($name)
        $i = 1
        while ([System.IO.File]::Exists($dest)) {
          $dest = Join-Path $filesDir ($base + ' (' + $i + ')' + $ext)
          $i++
        }
      }
      [System.IO.File]::Copy($item, $dest)
      $names.Add([System.IO.Path]::GetFileName($dest))
    }
  }
  if ($names.Count -eq 0) { exit 2 }
  [System.IO.File]::WriteAllText((Join-Path $stage 'kind'), 'files', $utf8)
  [System.IO.File]::WriteAllText((Join-Path $stage 'order'), ($names -join "\`n"), $utf8)
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`

/** The `#!/usr/bin/env node` PowerShell fake body: staging writes keyed on FAKE_PS_MODE. */
const POWERSHELL_FAKE = `#!${process.execPath}
const fs = require('fs')
const stage = process.env.BLUE_PASTE_STAGE
const log = process.env.FAKE_PS_LOG
if (log) fs.appendFileSync(log, JSON.stringify({ argv: process.argv.slice(2), stage, envHandoff: stage !== undefined }) + '\\n')
const mode = process.env.FAKE_PS_MODE || 'image'
const png = Buffer.from(process.env.FAKE_PS_PNG || '', 'hex')
const gif = Buffer.from(process.env.FAKE_PS_GIF || '', 'hex')
const jpg = Buffer.from(process.env.FAKE_PS_JPG || '', 'hex')
const bytesByName = name => name.endsWith('.gif') ? gif : name.endsWith('.jpg') || name.endsWith('.jpeg') ? jpg : png
if (mode === 'exit2') process.exit(2)
if (mode === 'exit1') { console.error('boom'); process.exit(1) }
if (mode === 'silent') process.exit(0)
if (mode === 'invalid' || mode === 'image') {
  fs.writeFileSync(stage + '/kind', 'image')
  fs.writeFileSync(stage + '/clipboard.png', mode === 'invalid' ? Buffer.from('garbage!') : png)
  process.exit(0)
}
if (mode === 'marker-only') { fs.writeFileSync(stage + '/kind', 'image'); process.exit(0) }
if (mode === 'files' || mode === 'files-empty') {
  const order = mode === 'files-empty' ? '' : (process.env.FAKE_PS_ORDER || '')
  fs.mkdirSync(stage + '/files', { recursive: true })
  for (const name of order.split('\\n').filter(name => name.length > 0)) {
    fs.writeFileSync(stage + '/files/' + name, name.match(/\\.(png|gif|jpe?g)$/) ? bytesByName(name) : Buffer.from('not an image\\n'))
  }
  fs.writeFileSync(stage + '/kind', 'files')
  fs.writeFileSync(stage + '/order', order)
  process.exit(0)
}
process.exit(1)
`

/**
 * The `#!/usr/bin/env node` osascript fake: `clipboard info`, the furl
 * listing, and coercion writes (destination unescaped from the AppleScript
 * literal) keyed on argv and FAKE_AS_MODE.
 */
const OSA_SCRIPT_FAKE = `#!${process.execPath}
const fs = require('fs')
const argv = process.argv.slice(2)
const args = argv.join('\\n')
const log = process.env.FAKE_AS_LOG
if (log) fs.appendFileSync(log, JSON.stringify(argv) + '\\n')
const mode = process.env.FAKE_AS_MODE || ''
const isInfo = args.includes('clipboard info')
const isFurl = args.includes('furl')
const hang = mode === 'hang-info' && isInfo
  || mode === 'hang-furl' && isFurl
  || mode === 'hang-write' && !isInfo && !isFurl
if (hang) {
  process.on('SIGTERM', () => {})
  require('child_process').spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
  setInterval(() => {}, 1000)
  return
}
if (isInfo) {
  if (mode === 'info-exit1') { console.error('boom'); process.exit(1) }
  process.stdout.write(process.env.FAKE_INFO || '')
  process.exit(0)
}
if (isFurl) {
  if (mode === 'furl-exit1') { console.error('no furl'); process.exit(1) }
  process.stdout.write(process.env.FAKE_FURL || '')
  process.exit(0)
}
const match = /POSIX file "(.*)"/.exec(args)
const dest = match === null ? null : match[1].replace(/\\\\(.)/g, '$1')
const token = args.includes('PNGf') ? 'png' : args.includes('JPEG picture') ? 'jpg' : args.includes('GIF picture') ? 'gif' : 'tiff'
if (mode === 'write-silent') process.exit(0)
if (mode === 'write-exit1' && token !== 'tiff') { console.error('coercion failed'); process.exit(1) }
if (mode === 'write-badbytes' && token === 'png') { fs.writeFileSync(dest, Buffer.from('garbage!')); process.exit(0) }
if (mode === 'tiff-fail-class' && args.includes('«class TIFF»')) { console.error('no TIFF class'); process.exit(1) }
if (mode === 'tiff-fail-spelled' && args.includes('TIFF picture')) { console.error('no spelled TIFF'); process.exit(1) }
if (mode === 'tiff-fail-all' && token === 'tiff') { console.error('no TIFF class'); process.exit(1) }
const hex = { png: process.env.FAKE_AS_PNG, jpg: process.env.FAKE_AS_JPG, gif: process.env.FAKE_AS_GIF, tiff: process.env.FAKE_AS_TIFF }[token]
fs.writeFileSync(dest, Buffer.from(hex || '', 'hex'))
process.exit(0)
`

/** The `#!/usr/bin/env node` sips fake: copies the PNG (or FAKE_SIPS_MODE bytes) to --out. */
const SIPS_FAKE = `#!${process.execPath}
const fs = require('fs')
const argv = process.argv.slice(2)
const log = process.env.FAKE_SIPS_LOG
if (log) fs.appendFileSync(log, JSON.stringify(argv) + '\\n')
const out = argv[argv.indexOf('--out') + 1]
const mode = process.env.FAKE_SIPS_MODE || 'ok'
if (mode === 'exit1') { console.error('sips boom'); process.exit(1) }
if (mode === 'silent') process.exit(0)
fs.writeFileSync(out, Buffer.from(mode === 'badbytes' ? (process.env.FAKE_AS_GIF || '') : (process.env.FAKE_AS_PNG || ''), 'hex'))
process.exit(0)
`

/** Write one executable fake tool into the bin directory. */
function tool(bin: string, name: string, body: string): void {
  const path = join(bin, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

/** A fresh fake bin directory with the given tools installed. */
function fakeBin(withSips = true): { bin: string, log: string, sipsLog: string } {
  const bin = mkdtempTracked('blue-native-bin-')
  const log = join(bin, 'as-log.jsonl')
  const sipsLog = join(bin, 'sips-log.jsonl')
  tool(bin, 'powershell.exe', POWERSHELL_FAKE)
  tool(bin, 'osascript', OSA_SCRIPT_FAKE)
  if (withSips) tool(bin, 'sips', SIPS_FAKE)
  return { bin, log, sipsLog }
}

/** One JSONL entry per logged fake invocation. */
function readLog(path: string): unknown[] {
  return readFileSync(path, 'utf8').split('\n').filter(line => line.length > 0).map(line => JSON.parse(line))
}

describe('parseClipboardClasses', () => {
  it('parses the four-character class form, ignoring sizes', () => {
    expect([...parseClipboardClasses('«class PNGf» 3971, «class utf8» 11')].sort()).toEqual(['PNGf', 'utf8'])
  })

  it('parses the spelled-out picture form', () => {
    expect([...parseClipboardClasses('TIFF picture 4810, JPEG picture 111841')].sort()).toEqual(['JPEG', 'TIFF'])
  })

  it('mixes both forms and tolerates trimming inside the guillemets', () => {
    expect([...parseClipboardClasses('«class PNGf » 3970, GIF picture 60, «class furl» 412')].sort())
      .toEqual(['GIF', 'PNGf', 'furl'])
  })

  it('returns nothing for a text-only or empty clipboard', () => {
    expect(parseClipboardClasses('«class utf8» 25').has('utf8')).toBe(true)
    expect([...parseClipboardClasses('')]).toEqual([])
  })
})

describe('escapeAppleScriptString', () => {
  it('leaves plain POSIX paths alone', () => {
    expect(escapeAppleScriptString('/var/folders/t/blue-paste-1/clipboard.png')).toBe('/var/folders/t/blue-paste-1/clipboard.png')
  })

  it('escapes backslashes and double quotes', () => {
    expect(escapeAppleScriptString('a\\b"c')).toBe('a\\\\b\\"c')
  })
})

describe('probeWindows', () => {
  const savedPath = process.env.PATH
  const savedTmpdir = process.env.TMPDIR

  beforeEach(() => {
    process.env.FAKE_PS_PNG = Buffer.from(PNG_1X1).toString('hex')
    process.env.FAKE_PS_GIF = Buffer.from(GIF_1X1).toString('hex')
    process.env.FAKE_PS_JPG = Buffer.from(JPEG_PREFIX).toString('hex')
  })

  afterEach(() => {
    process.env.PATH = savedPath
    if (savedTmpdir === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = savedTmpdir
    for (const key of ['FAKE_PS_MODE', 'FAKE_PS_PNG', 'FAKE_PS_GIF', 'FAKE_PS_JPG', 'FAKE_PS_ORDER', 'FAKE_PS_LOG']) delete process.env[key]
  })

  it('admits a staged bitmap image, pins the script argv, and removes the staging dir', async () => {
    const { bin, log } = fakeBin()
    const psLog = join(bin, 'ps-log.jsonl')
    process.env.PATH = bin
    process.env.FAKE_PS_LOG = psLog
    const result = await probeWindows(IMAGE_LIMITS)
    expect(result).toMatchObject({ kind: 'image', mediaType: 'image/png', backend: 'win32' })
    if (result.kind !== 'image') throw new Error('unreachable')
    expect(Uint8Array.from(result.data)).toEqual(PNG_1X1)
    const entries = readLog(psLog) as { argv: string[], stage: string, envHandoff: boolean }[]
    expect(entries).toHaveLength(1)
    expect(entries[0]!.argv).toEqual(['-NoProfile', '-NonInteractive', '-STA', '-Command', EXPECTED_POWERSHELL_SCRIPT])
    expect(entries[0]!.argv).toEqual(POWERSHELL_ARGS)
    expect(entries[0]!.envHandoff).toBe(true)
    expect(existsSync(entries[0]!.stage)).toBe(false)
    expect(existsSync(log)).toBe(false)
  })

  it('admits a staged FileDropList batch in manifest order', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_PS_MODE = 'files'
    process.env.FAKE_PS_ORDER = 'a.png\nb.gif'
    const result = await probeWindows(IMAGE_LIMITS)
    expect(result).toMatchObject({ kind: 'images', backend: 'win32' })
    if (result.kind !== 'images') throw new Error('unreachable')
    expect(result.images.map(image => ({ name: image.name, mediaType: image.mediaType }))).toEqual([
      { name: 'a.png', mediaType: 'image/png' },
      { name: 'b.gif', mediaType: 'image/gif' },
    ])
    expect(Uint8Array.from(result.images[0]!.data)).toEqual(PNG_1X1)
    expect(Uint8Array.from(result.images[1]!.data)).toEqual(GIF_1X1)
  })

  it('maps exit 2 to no-image', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_PS_MODE = 'exit2'
    await expect(probeWindows(IMAGE_LIMITS)).resolves.toEqual({ kind: 'no-image' })
  })

  it('carries the first stderr line on exit 1', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_PS_MODE = 'exit1'
    await expect(probeWindows(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'powershell.exe exited with code 1: boom' })
  })

  it('notices an exit 0 run that wrote no staging marker', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_PS_MODE = 'silent'
    await expect(probeWindows(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'powershell.exe exited without writing the clipboard staging marker' })
  })

  it('refuses staged bytes that do not sniff as PNG', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_PS_MODE = 'invalid'
    await expect(probeWindows(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'powershell.exe returned invalid bytes for image/png' })
  })

  it('refuses a staged batch containing a non-image file', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_PS_MODE = 'files'
    process.env.FAKE_PS_ORDER = 'img.png\nnotes.txt'
    const result = await probeWindows(IMAGE_LIMITS)
    expect(result).toMatchObject({ kind: 'file-failed' })
    if (result.kind !== 'file-failed') throw new Error('unreachable')
    expect(result.detail).toContain('notes.txt is not a supported PNG, JPEG, WebP, or GIF image')
  })

  it('maps an empty file manifest to no-image', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_PS_MODE = 'files-empty'
    await expect(probeWindows(IMAGE_LIMITS)).resolves.toEqual({ kind: 'no-image' })
  })

  it('degrades a missing staged image file to a staging read failure', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_PS_MODE = 'marker-only'
    await expect(probeWindows(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'powershell.exe staging read failed (ENOENT)' })
  })

  it('classifies an absent powershell.exe as the missing tool', async () => {
    const { bin } = fakeBin()
    rmSync(join(bin, 'powershell.exe'))
    process.env.PATH = bin
    await expect(probeWindows(IMAGE_LIMITS)).resolves.toEqual({ kind: 'missing-tool' })
  })
})

describe('probeDarwin', () => {
  const savedPath = process.env.PATH
  const savedTmpdir = process.env.TMPDIR

  beforeEach(() => {
    process.env.FAKE_AS_PNG = Buffer.from(PNG_1X1).toString('hex')
    process.env.FAKE_AS_GIF = Buffer.from(GIF_1X1).toString('hex')
    process.env.FAKE_AS_JPG = Buffer.from(JPEG_PREFIX).toString('hex')
    process.env.FAKE_AS_TIFF = Buffer.from('MMfake-tiff-bytes').toString('hex')
  })

  afterEach(() => {
    process.env.PATH = savedPath
    if (savedTmpdir === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = savedTmpdir
    for (const key of ['FAKE_AS_MODE', 'FAKE_AS_PNG', 'FAKE_AS_GIF', 'FAKE_AS_JPG', 'FAKE_AS_TIFF', 'FAKE_INFO', 'FAKE_FURL', 'FAKE_AS_LOG', 'FAKE_SIPS_LOG', 'FAKE_SIPS_MODE']) delete process.env[key]
  })

  /** The staging directory extracted from the fake's logged write argv. */
  function loggedStage(call: string[]): string {
    const open = call.find(arg => arg.startsWith('set fileRef to open for access POSIX file '))
    const match = /^set fileRef to open for access POSIX file "(.*)" with write permission$/.exec(open ?? '')
    if (match === null) throw new Error('no open-for-access line logged')
    return match[1]!.replace(/\/clipboard\.[a-z]+$/, '')
  }

  it('reads a PNGf clipboard directly, pinning the write argv', async () => {
    const { bin, log } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_LOG = log
    process.env.FAKE_INFO = '«class PNGf» 3971, «class utf8» 11'
    const result = await probeDarwin(IMAGE_LIMITS)
    expect(result).toMatchObject({ kind: 'image', mediaType: 'image/png', backend: 'darwin' })
    if (result.kind !== 'image') throw new Error('unreachable')
    expect(Uint8Array.from(result.data)).toEqual(PNG_1X1)
    const calls = readLog(log) as string[][]
    expect(calls[0]).toEqual(['-e', 'clipboard info'])
    const stage = loggedStage(calls[1]!)
    expect(calls[1]).toEqual([
      '-e', 'set imageData to (the clipboard as «class PNGf»)',
      '-e', `set fileRef to open for access POSIX file "${stage}/clipboard.png" with write permission`,
      '-e', 'set eof of fileRef to 0',
      '-e', 'write imageData to fileRef',
      '-e', 'close access fileRef',
    ])
  })

  it('reads the spelled-out GIF and JPEG picture classes directly', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_INFO = 'GIF picture 43'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toMatchObject({ kind: 'image', mediaType: 'image/gif', backend: 'darwin' })
    process.env.FAKE_INFO = 'JPEG picture 111841'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toMatchObject({ kind: 'image', mediaType: 'image/jpeg', backend: 'darwin' })
  })

  it('converts a TIFF-only clipboard through sips — the Chromium case', async () => {
    const { bin, log, sipsLog } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_LOG = log
    process.env.FAKE_SIPS_LOG = sipsLog
    process.env.FAKE_INFO = 'TIFF picture 4810, «class utf8» 11'
    const result = await probeDarwin(IMAGE_LIMITS)
    expect(result).toMatchObject({ kind: 'image', mediaType: 'image/png', backend: 'darwin' })
    const calls = readLog(log) as string[][]
    const stage = loggedStage(calls[1]!)
    const sipsCalls = readLog(sipsLog) as string[][]
    expect(sipsCalls).toEqual([['-s', 'format', 'png', `${stage}/clipboard.tiff`, '--out', `${stage}/clipboard.png`]])
  })

  it('falls back to the second TIFF spelling when the class form fails', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'tiff-fail-class'
    process.env.FAKE_INFO = 'TIFF picture 4810'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toMatchObject({ kind: 'image', mediaType: 'image/png', backend: 'darwin' })
  })

  it('surfaces the first soft detail when both TIFF spellings fail', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'tiff-fail-all'
    process.env.FAKE_INFO = 'TIFF picture 4810'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'osascript exited with code 1: no TIFF class' })
  })

  it('surfaces a soft direct-coercion failure when no other class can supply the image', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'write-exit1'
    process.env.FAKE_INFO = '«class PNGf» 3971'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'osascript exited with code 1: coercion failed' })
  })

  it('refuses direct bytes that do not sniff as the declared class type', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'write-badbytes'
    process.env.FAKE_INFO = '«class PNGf» 3971'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'osascript returned invalid bytes for image/png' })
  })

  it('degrades a silent write success to a staging read failure', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'write-silent'
    process.env.FAKE_INFO = '«class PNGf» 3971'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'osascript staging read failed (ENOENT)' })
  })

  it('prefers the direct class over the TIFF conversion when both are listed', async () => {
    const { bin, sipsLog } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_SIPS_LOG = sipsLog
    process.env.FAKE_INFO = '«class PNGf» 3970, TIFF picture 4810'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toMatchObject({ kind: 'image', mediaType: 'image/png' })
    expect(existsSync(sipsLog)).toBe(false)
  })

  it('admits a Finder furl batch with space and CJK names, order preserved', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    const dir = mkdtempTracked('blue-native-furl-')
    const spaced = join(dir, 'a b.png')
    const cjk = join(dir, '图.gif')
    writeFileSync(spaced, PNG_1X1)
    writeFileSync(cjk, GIF_1X1)
    process.env.FAKE_INFO = '«class furl» 412'
    process.env.FAKE_FURL = `${spaced}\n${cjk}`
    const result = await probeDarwin(IMAGE_LIMITS)
    expect(result).toMatchObject({ kind: 'images', backend: 'darwin' })
    if (result.kind !== 'images') throw new Error('unreachable')
    expect(result.images.map(image => ({ name: image.name, mediaType: image.mediaType }))).toEqual([
      { name: 'a b.png', mediaType: 'image/png' },
      { name: '图.gif', mediaType: 'image/gif' },
    ])
  })

  it('refuses a furl batch containing a non-image file', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    const dir = mkdtempTracked('blue-native-furl-')
    const notes = join(dir, 'notes.txt')
    writeFileSync(notes, 'not an image\n')
    process.env.FAKE_INFO = '«class furl» 412'
    process.env.FAKE_FURL = notes
    const result = await probeDarwin(IMAGE_LIMITS)
    expect(result).toMatchObject({ kind: 'file-failed' })
    if (result.kind !== 'file-failed') throw new Error('unreachable')
    expect(result.detail).toContain('notes.txt is not a supported PNG, JPEG, WebP, or GIF image')
  })

  it('maps an empty furl listing to no-image', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_INFO = '«class furl» 412'
    process.env.FAKE_FURL = ''
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'no-image' })
  })

  it('surfaces the soft detail of a failed furl listing', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'furl-exit1'
    process.env.FAKE_INFO = '«class furl» 412'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'osascript exited with code 1: no furl' })
  })

  it('times out when the furl listing hangs', { timeout: 15_000 }, async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'hang-furl'
    process.env.FAKE_INFO = '«class furl» 412'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'timeout' })
  })

  it('times out when a direct coercion write hangs', { timeout: 15_000 }, async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'hang-write'
    process.env.FAKE_INFO = '«class PNGf» 3971'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'timeout' })
  })

  it('times out when the first TIFF coercion write hangs', { timeout: 15_000 }, async () => {
    // TIFF-only clipboard: the direct loop stays empty, so the hang lands on
    // the «class TIFF» write and the timeout returns as a hard failure from
    // inside the TIFF leg rather than surfacing as a soft detail.
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'hang-write'
    process.env.FAKE_INFO = 'TIFF picture 4810'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'timeout' })
  })

  it('times out when clipboard info itself hangs', { timeout: 15_000 }, async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'hang-info'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'timeout' })
  })

  it('names an unadmitted image class as unsupported', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_INFO = '«class 8BPS» 4610'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'unsupported', mediaType: 'image/vnd.adobe.photoshop' })
  })

  it('maps a text-only clipboard to no-image', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_INFO = '«class utf8» 25'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'no-image' })
  })

  it('classifies an absent osascript as the missing tool', async () => {
    const { bin } = fakeBin()
    rmSync(join(bin, 'osascript'))
    process.env.PATH = bin
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'missing-tool' })
  })

  it('carries the first stderr line when clipboard info exits 1', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_MODE = 'info-exit1'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'osascript exited with code 1: boom' })
  })

  it('classifies an absent sips as the missing tool', async () => {
    const { bin } = fakeBin(false)
    process.env.PATH = bin
    process.env.FAKE_INFO = 'TIFF picture 4810'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'missing-tool' })
  })

  it('carries the sips stderr line when the conversion exits 1', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_SIPS_MODE = 'exit1'
    process.env.FAKE_INFO = 'TIFF picture 4810'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'sips exited with code 1: sips boom' })
  })

  it('refuses converted bytes that do not sniff as PNG', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_SIPS_MODE = 'badbytes'
    process.env.FAKE_INFO = 'TIFF picture 4810'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'sips returned invalid bytes for image/png' })
  })

  it('degrades a silent sips success to a staging read failure', async () => {
    const { bin } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_SIPS_MODE = 'silent'
    process.env.FAKE_INFO = 'TIFF picture 4810'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toEqual({ kind: 'failed', detail: 'sips staging read failed (ENOENT)' })
  })

  it('escapes the staging path embedded in the AppleScript literal', async () => {
    const { bin, log } = fakeBin()
    process.env.PATH = bin
    process.env.FAKE_AS_LOG = log
    // A temp root whose path contains an AppleScript-hostile backslash and
    // double quote: the write argv must carry the escaped form while the
    // fake still resolves the real directory.
    const hostile = join(mkdtempTracked('blue-native-hostile-'), 'q"uote\\back')
    mkdirSync(hostile)
    process.env.TMPDIR = hostile
    process.env.FAKE_INFO = '«class PNGf» 3971'
    await expect(probeDarwin(IMAGE_LIMITS)).resolves.toMatchObject({ kind: 'image', mediaType: 'image/png' })
    const calls = readLog(log) as string[][]
    const open = calls[1]!.find(arg => arg.includes('open for access')) ?? ''
    // The escaped hostile root must open into the probe's mkdtemp staging
    // child; the probe's success already proves the fake unescaped it.
    const escapedRoot = hostile.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    expect(open).toContain(`POSIX file "${escapedRoot}/blue-paste-`)
    expect(open.endsWith('clipboard.png" with write permission')).toBe(true)
  })
})

// The fake-bin scaffolding doubles as the staging-handoff witness: nothing
// here runs the real PowerShell or AppleScript — the real-machine matrix in
// the S39 acceptance checklist covers those.
