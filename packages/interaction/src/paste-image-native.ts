/**
 * Native clipboard probes for the `blue-paste-image` plugin: win32 through
 * one PowerShell staging spawn, darwin through osascript's list-then-read
 * negotiation. Neither probe lets image bytes or file paths cross a tool's
 * stdout — PowerShell saves into a staging directory handed over through
 * the `BLUE_PASTE_STAGE` environment variable (console codepages mojibake
 * non-ASCII stdout), and AppleScript writes its coercions into the same
 * directory through `open for access` (the hex-dump check Claude Code used
 * overflows stdout buffers on large images). The darwin probe lists the
 * pasteboard classes first (`clipboard info`) and reads the first admitted
 * class directly; a TIFF-only clipboard — every Chromium/Electron app copy,
 * which places `public.png` without the legacy `«class PNGf»` type —
 * converts through sips; a Finder `«class furl»` listing becomes the
 * copied-file batch. WinForms `Clipboard.ContainsImage`/`GetImage` read the
 * Windows clipboard because `Get-Clipboard -Format Image` mishandles the
 * raw CF_DIB bitmaps PrintScreen and Win+Shift+S place; `Add-Type
 * -AssemblyName` loads precompiled assemblies, so no runtime csc compile
 * trips endpoint defenses. Failure kinds follow D49/D55: each names what is
 * missing, nothing is installed or worked around on the user's behalf.
 *
 * @module @dsh-blue/blue-interaction/paste-image-native
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImageAttachmentLimits, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { sniffImageMediaType } from './attachments.ts'
import {
  type ClipboardImageResult,
  classifyNativeFailure,
  readCopiedPaths,
  runTool,
  withStagingDir,
} from './clipboard-probe.ts'

/** PowerShell cold starts run ~0.5-1s+; the shared 3s budget is too tight. */
const WIN32_TOOL_TIMEOUT_MS = 10_000
/** osascript spawns cost ~300-500ms each; the darwin probe makes up to four. */
const DARWIN_TOOL_TIMEOUT_MS = 5_000

/** Environment variable carrying the staging directory into PowerShell. */
const POWERSHELL_STAGE_ENV = 'BLUE_PASTE_STAGE'

/**
 * The single-spawn PowerShell staging script (D55): a bitmap clipboard is
 * saved as `clipboard.png`, a FileDropList is copied into `files/` with an
 * `order` manifest (collision-renamed, directories skipped), and the run
 * reports through a kind marker plus an exit code — 0 staged, 2 nothing to
 * paste, 1 error with the message on stderr. Image bytes and file names
 * never cross stdout. Pinned byte-for-byte by the native spec.
 */
const POWERSHELL_READ_SCRIPT = `
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
try {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $stage = $env:${POWERSHELL_STAGE_ENV}
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

/** PowerShell invocation: no profile or interactivity, STA for the OLE
 * clipboard, and the script as one `-Command` argument. The native spec
 * pins this argv and the script literal against drift. */
export const POWERSHELL_ARGS: readonly string[] = ['-NoProfile', '-NonInteractive', '-STA', '-Command', POWERSHELL_READ_SCRIPT]

/**
 * Read the staging kind marker (`image` or `files`); an unreadable or
 * absent marker resolves undefined.
 * @param stage - the staging directory.
 * @returns the marker text, or undefined.
 */
async function readStagingKind(stage: string): Promise<string | undefined> {
  try {
    return (await readFile(join(stage, 'kind'), 'utf8')).trim()
  } catch {
    return undefined
  }
}

/**
 * Read the Windows clipboard through one PowerShell staging probe (D55).
 * Exit 2 is no image and no files; every other nonzero exit is classified
 * (ENOENT is the missing binary, a kill is the timeout, stderr carries the
 * raw detail). A staged image is sniffed as PNG before admission; a staged
 * FileDropList goes through the shared copied-path preflight — the staged
 * copies are regular files the script created itself, so the win32 read
 * path has no symlink surface (`O_NOFOLLOW` is POSIX-only and moot here).
 * @param limits - deployment image limits bounding any file batch.
 * @returns the clipboard read.
 */
export async function probeWindows(limits: ImageAttachmentLimits): Promise<ClipboardImageResult> {
  return withStagingDir(async stage => {
    try {
      const run = await runTool('powershell.exe', POWERSHELL_ARGS, {
        timeoutMs: WIN32_TOOL_TIMEOUT_MS,
        env: { ...process.env, [POWERSHELL_STAGE_ENV]: stage },
      })
      if (!run.ok) {
        if (run.code === 2) return { kind: 'no-image' }
        return classifyNativeFailure('powershell.exe', run)
      }
      const kind = await readStagingKind(stage)
      if (kind === 'image') {
        const data = await readFile(join(stage, 'clipboard.png'))
        if (sniffImageMediaType(data) !== 'image/png') {
          return { kind: 'failed', detail: 'powershell.exe returned invalid bytes for image/png' }
        }
        return { kind: 'image', data, mediaType: 'image/png', backend: 'win32' }
      }
      if (kind === 'files') {
        const order = (await readFile(join(stage, 'order'), 'utf8'))
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0)
        const result = await readCopiedPaths(order.map(name => join(stage, 'files', name)), limits)
        return result.kind === 'images' ? { ...result, backend: 'win32' } : result
      }
      return { kind: 'failed', detail: 'powershell.exe exited without writing the clipboard staging marker' }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return { kind: 'failed', detail: `powershell.exe staging read failed (${String(code)})` }
    }
  })
}

/** Direct AppleScript coercions in preference order: the `clipboard info`
 * token, the coercion expression, the admitted media type, the extension. */
const DARWIN_DIRECT_CLASSES: ReadonlyArray<readonly [token: string, coercion: string, mediaType: ImageMediaType, ext: string]> = [
  ['PNGf', '«class PNGf»', 'image/png', 'png'],
  ['JPEG', 'JPEG picture', 'image/jpeg', 'jpg'],
  ['GIF', 'GIF picture', 'image/gif', 'gif'],
]

/** macOS clipboard classes that hold images the store never admits; their
 * media types surface through the unsupported failure kind. */
const DARWIN_UNSUPPORTED_IMAGE_CLASSES: Readonly<Record<string, string>> = {
  '8BPS': 'image/vnd.adobe.photoshop',
  jp2: 'image/jp2',
  BMP: 'image/bmp',
  PICT: 'image/x-pict',
  ICO: 'image/x-icon',
  icns: 'image/icns',
}

/**
 * Extract the pasteboard class tokens from `clipboard info` output: both
 * the `«class XXXX»` four-character form and the spelled-out `TIFF
 * picture` form. Sizes are ignored.
 * @param info - the `clipboard info` stdout text.
 * @returns the class tokens present.
 */
export function parseClipboardClasses(info: string): Set<string> {
  const classes = new Set<string>()
  for (const match of info.matchAll(/«class\s*([^»]+?)\s*»|\b([A-Za-z]+)\s+picture\b/g)) {
    classes.add((match[1] ?? match[2])!.trim())
  }
  return classes
}

/**
 * Escape a path for an AppleScript double-quoted string literal. macOS temp
 * paths never contain either character; this defends regardless.
 * @param value - the raw path.
 * @returns the escaped literal body.
 */
export function escapeAppleScriptString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/**
 * Build the osascript argv that writes one clipboard coercion into a
 * destination file. The `set eof` line truncates, so re-runs into a reused
 * staging directory stay well-defined.
 * @param coercion - the `the clipboard as …` expression.
 * @param destination - the staging file to write.
 * @returns the osascript arguments.
 */
function darwinWriteArgs(coercion: string, destination: string): string[] {
  return [
    '-e', `set imageData to (the clipboard as ${coercion})`,
    '-e', `set fileRef to open for access POSIX file "${escapeAppleScriptString(destination)}" with write permission`,
    '-e', 'set eof of fileRef to 0',
    '-e', 'write imageData to fileRef',
    '-e', 'close access fileRef',
  ]
}

/** Build the osascript argv listing Finder-copied file POSIX paths, one per line. */
function darwinFileListArgs(): string[] {
  return [
    '-e', 'set filePaths to (the clipboard as «class furl») as list',
    '-e', 'set pathLines to ""',
    '-e', 'repeat with filePath in filePaths',
    '-e', 'set pathLines to pathLines & (POSIX path of filePath) & linefeed',
    '-e', 'end repeat',
    '-e', 'return pathLines',
  ]
}

/**
 * Read one direct coercion into the staging dir and cross-check the bytes.
 * A hard failure kind (missing tool, timeout) stops the probe; a raw run
 * failure stays soft and lets the next class try.
 * @param stage - the staging directory.
 * @param coercion - the `the clipboard as …` expression.
 * @param mediaType - the admitted type the bytes must sniff as.
 * @param ext - the staging file extension.
 * @returns the read outcome for this class.
 */
async function readDarwinDirect(stage: string, coercion: string, mediaType: ImageMediaType, ext: string): Promise<ClipboardImageResult> {
  const destination = join(stage, `clipboard.${ext}`)
  const run = await runTool('osascript', darwinWriteArgs(coercion, destination), { timeoutMs: DARWIN_TOOL_TIMEOUT_MS })
  if (!run.ok) return classifyNativeFailure('osascript', run)
  try {
    const data = await readFile(destination)
    if (sniffImageMediaType(data) !== mediaType) {
      return { kind: 'failed', detail: `osascript returned invalid bytes for ${mediaType}` }
    }
    return { kind: 'image', data, mediaType, backend: 'darwin' }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { kind: 'failed', detail: `osascript staging read failed (${String(code)})` }
  }
}

/**
 * Read the TIFF class and convert it through sips: Chromium/Electron apps
 * place `public.png` on the pasteboard without the legacy `«class PNGf»`
 * type but always alongside TIFF, so this leg is what makes their copies
 * pasteable (D55). Both AppleScript spellings are tried; each successful
 * write converts through one sips invocation whose PNG bytes are sniffed
 * before admission.
 * @param stage - the staging directory.
 * @returns the converted read, or the failure verdict.
 */
async function readDarwinTiff(stage: string): Promise<ClipboardImageResult> {
  const tiffPath = join(stage, 'clipboard.tiff')
  const pngPath = join(stage, 'clipboard.png')
  const softFailures: ClipboardImageResult[] = []
  for (const coercion of ['«class TIFF»', 'TIFF picture']) {
    const write = await runTool('osascript', darwinWriteArgs(coercion, tiffPath), { timeoutMs: DARWIN_TOOL_TIMEOUT_MS })
    if (!write.ok) {
      const failure = classifyNativeFailure('osascript', write)
      if (failure.kind !== 'failed') return failure
      softFailures.push(failure)
      continue
    }
    const convert = await runTool('sips', ['-s', 'format', 'png', tiffPath, '--out', pngPath], { timeoutMs: DARWIN_TOOL_TIMEOUT_MS })
    if (!convert.ok) return classifyNativeFailure('sips', convert)
    try {
      const data = await readFile(pngPath)
      if (sniffImageMediaType(data) !== 'image/png') {
        return { kind: 'failed', detail: 'sips returned invalid bytes for image/png' }
      }
      return { kind: 'image', data, mediaType: 'image/png', backend: 'darwin' }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return { kind: 'failed', detail: `sips staging read failed (${String(code)})` }
    }
  }
  // Both spellings failed softly; the first detail is the verdict.
  return softFailures[0]!
}

/**
 * Read the macOS clipboard through osascript (D55): `clipboard info` lists
 * the pasteboard classes first, the first admitted class is coerced
 * straight into the staging dir, a TIFF-only clipboard converts through
 * sips, a Finder furl listing becomes the copied-file batch, and leftover
 * image classes name themselves unsupported.
 * @param limits - deployment image limits bounding any file batch.
 * @returns the clipboard read.
 */
export async function probeDarwin(limits: ImageAttachmentLimits): Promise<ClipboardImageResult> {
  return withStagingDir(async stage => {
    const info = await runTool('osascript', ['-e', 'clipboard info'], { timeoutMs: DARWIN_TOOL_TIMEOUT_MS })
    if (!info.ok) return classifyNativeFailure('osascript', info)
    const classes = parseClipboardClasses(info.stdout.toString('utf8'))
    let softFailure: ClipboardImageResult | undefined
    for (const [token, coercion, mediaType, ext] of DARWIN_DIRECT_CLASSES) {
      if (!classes.has(token)) continue
      const read = await readDarwinDirect(stage, coercion, mediaType, ext)
      if (read.kind === 'image') return read
      if (read.kind !== 'failed') return read
      softFailure ??= read
    }
    if (classes.has('TIFF')) {
      const tiff = await readDarwinTiff(stage)
      if (tiff.kind === 'image') return tiff
      if (tiff.kind !== 'failed') return tiff
      softFailure ??= tiff
    }
    if (classes.has('furl')) {
      const list = await runTool('osascript', darwinFileListArgs(), { timeoutMs: DARWIN_TOOL_TIMEOUT_MS })
      if (!list.ok) {
        const failure = classifyNativeFailure('osascript', list)
        if (failure.kind !== 'failed') return failure
        softFailure ??= failure
      } else {
        const paths = list.stdout.toString('utf8')
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
        const files = await readCopiedPaths(paths, limits)
        if (files.kind === 'images') return { ...files, backend: 'darwin' }
        if (files.kind !== 'no-image') return files
      }
    }
    if (softFailure !== undefined) return softFailure
    for (const [token, mediaType] of Object.entries(DARWIN_UNSUPPORTED_IMAGE_CLASSES)) {
      if (classes.has(token)) return { kind: 'unsupported', mediaType }
    }
    return { kind: 'no-image' }
  })
}

