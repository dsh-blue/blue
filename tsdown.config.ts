import { defineConfig } from 'tsdown'
import { BUILD_PACKAGE_DIRS, packageDir, readManifest, sourceEntries } from './script/package-contract.mjs'

const requestedPackages = new Set((process.env.BLUE_BUILD_PACKAGES ?? '').split(',').filter(Boolean))
const packageDirs = requestedPackages.size === 0
  ? BUILD_PACKAGE_DIRS
  : BUILD_PACKAGE_DIRS.filter(relativeDir => requestedPackages.has(relativeDir))

if (requestedPackages.size > 0 && packageDirs.length !== requestedPackages.size) {
  const unknown = [...requestedPackages].filter(relativeDir => !BUILD_PACKAGE_DIRS.includes(relativeDir))
  throw new Error(`unknown BLUE_BUILD_PACKAGES entries: ${unknown.join(', ')}`)
}

/**
 * Bundle each workspace package's TypeScript entry points into the published
 * lib/ layout. tsc -b owns declaration emission; tsdown owns runtime bundling.
 * Package dependencies and peerDependencies stay external.
 */
export default defineConfig(packageDirs.map(relativeDir => ({
  cwd: packageDir(relativeDir),
  entry: sourceEntries(relativeDir, readManifest(relativeDir)),
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: relativeDir === 'packages/cli' ? { alwaysBundle: ['tar'] } : undefined,
})))
