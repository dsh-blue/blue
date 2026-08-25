import { defineConfig } from 'tsdown'
import { BUILD_PACKAGE_DIRS, packageDir, readManifest, sourceEntries } from './script/package-contract.mjs'

/**
 * Bundle each workspace package's TypeScript entry points into the published
 * lib/ layout. tsc -b owns declaration emission; tsdown owns runtime bundling.
 * Package dependencies and peerDependencies stay external.
 */
export default defineConfig(BUILD_PACKAGE_DIRS.map(relativeDir => ({
  cwd: packageDir(relativeDir),
  entry: sourceEntries(relativeDir, readManifest(relativeDir)),
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})))
