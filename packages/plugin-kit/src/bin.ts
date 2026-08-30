#!/usr/bin/env node
/**
 * Published author command for Blue plugin scaffolding and conformance.
 *
 * @module @dsh-blue/blue-plugin-kit/bin
 */

import { spawnSync } from 'node:child_process'
import { runBluePluginCli } from './cli.ts'
import { bluePluginRuntimePath } from './index.ts'

/* v8 ignore next -- the executable shim is covered by the packed-bin process fixture. */
process.exitCode = await runBluePluginCli(process.argv.slice(2), {
  stdout: value => process.stdout.write(value),
  stderr: value => process.stderr.write(value),
  runRuntime: (name, args) => {
    const script = bluePluginRuntimePath(name)
    const child = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' })
    if (child.error !== undefined) {
      process.stderr.write(`blue-plugin: ${child.error.message}\n`)
      return 1
    }
    return child.status ?? 1
  },
})
