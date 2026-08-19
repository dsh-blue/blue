/**
 * The persistent hint content module: fragment composition, enhancement
 * existence gates, and the drop of keyless fragments, over injected fact
 * sources.
 */

import { describe, expect, it } from 'vitest'
import { idleHint, runningHint, type HintSources } from '../src/hint-content.ts'

/** All interaction actions bound, no optional enhancement present. */
const baseline: HintSources = {
  keys: action =>
    action === 'blue.interaction.steer' ? ['ctrl+s']
      : action === 'blue.interaction.interrupt' ? ['ctrl+c']
        : action === 'blue.interaction.cancel' ? ['escape']
          : [],
  editorPlus: false,
  pasteImage: false,
}

describe('idleHint', () => {
  it('lists the baseline affordances with keymap-driven labels', () => {
    expect(idleHint(baseline)).toBe('/ commands · ctrl+s steer · ctrl+c exit')
  })

  it('adds the bash and @ fragments while editor-plus is attached', () => {
    expect(idleHint({ ...baseline, editorPlus: true }))
      .toBe('! bash · / commands · @ files · ctrl+s steer · ctrl+c exit')
  })

  it('adds the paste-image fragment between steer and exit while registered', () => {
    expect(idleHint({ ...baseline, pasteImage: true, keys: action => action === 'blue.image.paste' ? ['ctrl+v'] : baseline.keys(action) }))
      .toBe('/ commands · ctrl+s steer · ctrl+v paste image · ctrl+c exit')
  })

  it('drops the paste-image fragment when its action carries no keys', () => {
    expect(idleHint({ ...baseline, pasteImage: true, keys: () => [] })).toBe('/ commands')
  })

  it('drops key-named fragments whose action carries no keys', () => {
    expect(idleHint({ ...baseline, keys: () => [] })).toBe('/ commands')
  })
})

describe('runningHint', () => {
  it('pairs interrupt with steer from the keymap', () => {
    expect(runningHint(baseline)).toBe('escape interrupt · ctrl+s steer')
  })

  it('keeps whichever fragment still has keys', () => {
    expect(runningHint({ ...baseline, keys: action => action === 'blue.interaction.steer' ? ['ctrl+s'] : [] }))
      .toBe('ctrl+s steer')
    expect(runningHint({ ...baseline, keys: () => [] })).toBe('')
  })
})
