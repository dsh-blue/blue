import { defineConfig } from 'tsdown'
import { PACKAGE_DIRS, packageDir, readManifest, sourceEntries } from './script/package-contract.mjs'

/**
 * Bundle runtime entries directly from source. Each package config derives its
 * entry map from exports/bin, removing the hand-maintained third side of the
 * old exports/files/tsdown triangle. tsc owns declaration-only emission.
 */
export default defineConfig(PACKAGE_DIRS.map(relativeDir => ({
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
