import { defineConfig } from 'tsdown'

/**
 * Bundle each workspace package's tsc-emitted entry points (lib/types/*.js)
 * into the published lib/ layout. tsc -b owns type emission; tsdown owns
 * runtime bundling. Package dependencies and peerDependencies stay external.
 */
export default defineConfig({
  // Explicit package list: a bare 'packages/*' would also match the
  // packages/bundle group directory (no package.json of its own).
  workspace: {
    include: ['packages/{core,interaction,transcript,app}', 'packages/bundle/blue'],
  },
  entry: ['lib/types/{index,invariant,startup,theme-dark}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
