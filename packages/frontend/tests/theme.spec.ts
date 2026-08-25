import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ThemeModelService } from '../src/theme.ts'
import type { ThemeModel } from '../src/models.ts'

const theme = (id: string): ThemeModel => ({ kind: 'theme', id, name: id, colors: { text: '#fff' }, dark: id === 'dark' })

describe('ThemeModelService', () => {
  it('registers, activates, observes and unloads semantic themes', () => {
    const service = new ThemeModelService(new Context()); const seen: Array<string | undefined> = []; const off = service.subscribe(model => seen.push(model?.id)); const dark = service.register(theme('dark')); const light = service.register(theme('light')); expect(service.current?.id).toBe('dark'); expect(service.activate('light')).toBe(true); expect(service.activate('missing')).toBe(false); expect(service.current?.id).toBe('light'); expect(service.list()).toHaveLength(2); light(); light(); expect(service.current?.id).toBe('dark'); dark(); dark(); off(); service.dispose(); expect(seen).toContain('light')
  })
  it('rejects duplicate ids and handles empty activation', () => { const service = new ThemeModelService(new Context()); expect(service.activate('none')).toBe(false); const dispose = service.register(theme('one')); expect(() => service.register(theme('one'))).toThrow(/already registered/); dispose(); expect(service.current).toBeUndefined(); service.dispose() })
  it('removes a non-active model without changing the active selection', () => { const service = new ThemeModelService(new Context()); service.register(theme('active')); const dispose = service.register(theme('other')); dispose(); expect(service.current?.id).toBe('active'); service.dispose() })
})
