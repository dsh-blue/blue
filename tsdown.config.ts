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
    include: ['packages/{api,core,interaction,transcript,app,cli}', 'packages/bundle/blue'],
  },
  // `bin` is the cli package's launcher entry (S37): the only name in this
  // list its workspace owns, so the shared brace form keeps working.
  entry: ['lib/types/{index,invariant,chrome,startup,theme-dark,theme-light,theme-ocean,theme-paper,theme-auto,theme-custom,editor-plus,status-basic,status-cwd,status-git,status-context,status-title,pane-activity,pane-todo,pane-btw,pane-queue,attachments,paste-image,intent-diff,intent-terminal,banner,banner-content,pane-agents,mode-status,bin}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
