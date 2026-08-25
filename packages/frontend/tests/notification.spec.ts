import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { NotificationModelService } from '../src/notification.ts'
import type { NotificationModel } from '../src/models.ts'

const note = (id: string, dedupeKey?: string): NotificationModel => ({ kind: 'notification', id, severity: 'info', message: id, ...(dedupeKey === undefined ? {} : { dedupeKey }) })

describe('NotificationModelService', () => {
  it('deduplicates, publishes immutable snapshots, and dismisses idempotently', () => { const service = new NotificationModelService(new Context()); const seen: number[] = []; const off = service.subscribe(models => seen.push(models.length)); const first = service.push(note('one', 'same')); const second = service.push(note('two', 'same')); expect(service.list().map(model => model.id)).toEqual(['two']); expect(service.dismiss('missing')).toBe(false); expect(service.dismiss('two')).toBe(true); expect(service.dismiss('two')).toBe(false); first(); first(); second(); off(); service.dispose(); expect(seen).toEqual([0, 1, 1, 0]) })
  it('keeps independent notifications and supports direct dismissal', () => { const service = new NotificationModelService(new Context()); const one = service.push(note('one')); const two = service.push(note('two')); expect(service.list()).toHaveLength(2); expect(service.list()[0]).toEqual(note('one')); expect(service.dismiss('one')).toBe(true); two(); one(); service.dispose() })
})
