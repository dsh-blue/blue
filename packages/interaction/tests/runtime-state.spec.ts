/**
 * Frontend-tree interaction state isolation and disposal.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { InteractionStateService } from '../src/runtime-state.ts'
import { DEFAULT_SETTINGS } from '../src/settings.ts'

describe('InteractionStateService', () => {
  it('isolates product state between frontend trees', () => {
    const first = new InteractionStateService(new Context(), DEFAULT_SETTINGS)
    const second = new InteractionStateService(new Context(), DEFAULT_SETTINGS)
    first.draft.stashDraft('first tree')
    first.currentThemeKey = 'custom'
    first.pasteImage.pasteCount = 2

    expect(second.draft.getStashedDraft()).toBe('')
    expect(second.currentThemeKey).toBe('dark')
    expect(second.pasteImage.pasteCount).toBe(0)
  })

  it('releases cached and registered state on disposal', () => {
    const service = new InteractionStateService(new Context(), DEFAULT_SETTINGS)
    service.aliases.register('quit', ['q'])
    service.draft.stashDraft('draft')
    service.draft.stashInputMode('bash')
    service.draft.stashHistory(['one'])
    service.modelsDevCache = { at: 1, index: { lookup: vi.fn() } }
    service.fdProbe.result = Promise.resolve('fd')
    service.updateInFlight = true
    service.pasteImage.backendCooldowns.set('x11', 1)
    service.pasteImage.pastedImages.set('marker', {
      attachmentId: 'attachment' as never,
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    })
    service.pasteImage.pasteCount = 3

    service.dispose()

    expect(service.aliases.canonicalOf('q')).toBeUndefined()
    expect(service.draft.getStashedDraft()).toBe('')
    expect(service.draft.getStashedInputMode()).toBe('prompt')
    expect(service.draft.getStashedHistory()).toEqual([])
    expect(service.modelsDevCache).toBeUndefined()
    expect(service.fdProbe.result).toBeUndefined()
    expect(service.updateInFlight).toBe(false)
    expect(service.pasteImage.backendCooldowns.size).toBe(0)
    expect(service.pasteImage.pastedImages.size).toBe(0)
    expect(service.pasteImage.pasteCount).toBe(0)
  })
})
