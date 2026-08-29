/** Verify a calibrated profile contains one exact Blue release. @module script/verify-installed-blue */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const expected = process.argv[2]
if (expected === undefined) throw new Error('usage: verify-installed-blue.mjs <version>')
const home = process.env.DSH_HOME
if (home === undefined || home === '') throw new Error('DSH_HOME is required')

// The profile receives the bundle and its nine runtime library dependencies;
// blue-cli itself is installed globally and is checked by the release workflow.
const PROFILE_PACKAGES = [
  'blue-api',
  'blue-ui',
  'blue-frontend',
  'blue-harness-adapter',
  'blue-conversation',
  'blue-core',
  'blue-app',
  'blue-transcript',
  'blue-interaction',
  'blue',
]

for (const name of PROFILE_PACKAGES) {
  const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'blue', 'node_modules', '@dsh-blue', name, 'package.json'), 'utf8'))
  if (manifest.version !== expected) throw new Error(`@dsh-blue/${name}: expected ${expected}, got ${manifest.version}`)
}
console.log(`installed Blue set: ${PROFILE_PACKAGES.length} profile packages at ${expected}`)
