/**
 * Frontend-tree-owned mutable state shared by interaction child Fibers.
 * Theme swaps rebuild renderer-dependent children while this parent service
 * survives, so drafts and registries remain available without crossing into
 * another Cordis tree or process-wide module state.
 *
 * @module @dsh-blue/blue-interaction/runtime-state
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { CommandAliasRegistry } from './command-meta.ts'
import { DraftStash } from './draft-stash.ts'
import type { FdProbeRuntimeState } from './file-mention.ts'
import type { ModelsDevIndex } from './models-dev.ts'
import type { BlueSettings } from './settings.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { blueInteractionState: InteractionStateService }
}

/** Mutable state for clipboard-image paste within one frontend tree. */
export interface PasteImageRuntimeState {
  backendOverride: 'auto' | 'wayland' | 'x11' | undefined
  readonly backendCooldowns: Map<string, number>
  readonly pastedImages: Map<string, ImageAttachmentRef>
  pasteCount: number
}

/** Mutable interaction state whose lifetime is the parent frontend tree. */
export class InteractionStateService extends Service {
  readonly aliases = new CommandAliasRegistry()
  readonly draft = new DraftStash()
  settingsSource: () => BlueSettings
  lastAppliedTheme: BlueSettings['theme'] = 'dark'
  currentThemeKey = 'dark'
  modelsDevCache: { at: number, index: ModelsDevIndex } | undefined
  readonly fdProbe: FdProbeRuntimeState = { result: undefined }
  updateInFlight = false
  readonly pasteImage: PasteImageRuntimeState = {
    backendOverride: undefined,
    backendCooldowns: new Map(),
    pastedImages: new Map(),
    pasteCount: 0,
  }

  constructor(ctx: Context, defaultSettings: BlueSettings) {
    super(ctx, 'blueInteractionState')
    this.settingsSource = () => defaultSettings
  }

  dispose(): void {
    this.aliases.clear()
    this.draft.clearAll()
    this.modelsDevCache = undefined
    this.fdProbe.result = undefined
    this.pasteImage.backendCooldowns.clear()
    this.pasteImage.pastedImages.clear()
    this.pasteImage.pasteCount = 0
    this.updateInFlight = false
  }
}
