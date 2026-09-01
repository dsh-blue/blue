/** Headless terminal evidence for the direct-service whole tree.
 * @module @dsh-blue/blue/tests/vt-snapshot
 */

import { afterEach, describe, expect, it } from 'vitest'
import { waitForRender } from '../../../core/tests/fake-terminal.ts'
import { cwdNormalizer, VtTerminal } from './vt-terminal.ts'
import { bootDirectBlue, currentAgent, executeDirectOverlay, resetDirectBlue } from './e2e-boot.ts'

afterEach(async () => { await resetDirectBlue() })

async function frame(columns: number, overlay = false): Promise<string> {
  const terminal = new VtTerminal(columns, 16)
  const tree = await bootDirectBlue({ terminal })
  await currentAgent(tree)
  if (overlay) await executeDirectOverlay(tree)
  tree.ctx.blueScreen.requestRender(true)
  await waitForRender()
  return terminal.frame(cwdNormalizer())
}

describe('direct-service VT frames', () => {
  it.each([32, 80])('renders the sibling pane within %i columns', async (columns) => {
    const output = await frame(columns)
    expect(output).toContain('native dsh + Blue seam')
    for (const row of output.split('\n')) expect([...row]).toHaveLength(Math.min(columns, [...row].length))
  })

  it('renders the direct capturing overlay over the same tree', async () => {
    const output = await frame(80, true)
    expect(output).toContain('Direct overlay')
    expect(output).toContain('opened through the direct Blue service')
  })
})
