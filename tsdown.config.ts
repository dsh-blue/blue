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
  entry: ['lib/types/{index,invariant,chrome,startup,theme-dark,theme-light,theme-auto,theme-custom,editor-plus,status-basic,status-cwd,status-git,status-context,status-tips,pane-activity,pane-todo,pane-btw,pane-queue,attachments,paste-image,intent-diff,intent-terminal,banner}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
