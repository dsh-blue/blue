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
    include: ['packages/{api,frontend,harness-adapter,context,remote,core,interaction,transcript,openpencil,lark,app}', 'packages/bundle/blue'],
  },
  entry: ['lib/types/{index,invariant,chrome,startup,theme-dark,theme-light,theme-auto,theme-custom,editor-plus,status-basic,status-basic-model,status-cwd,status-git,status-context,status-title,pane-activity,pane-todo,pane-btw,pane-queue,attachments,paste-image,intent-diff,intent-terminal,banner,banner-content,pane-agents,mode-status,dock-model,tool-model,transcript-model,command-model}.js', 'packages/frontend/lib/types/{index,invariant}.js', 'packages/harness-adapter/lib/types/{index,invariant,session,projection,action,model,question}.js', 'packages/context/lib/types/{index,invariant}.js', 'packages/remote/lib/types/{index,invariant}.js', 'packages/openpencil/lib/types/{index,invariant}.js', 'packages/lark/lib/types/{index,invariant}.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
