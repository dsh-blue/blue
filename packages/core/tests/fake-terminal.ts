/**
 * Recording fake for pi-tui's `Terminal` interface. Writes accumulate in
 * `written`; lifecycle calls are counted. Input and resize are simulated
 * through `sendInput`/`resize`.
 */

import { setCapabilities } from '@earendil-works/pi-tui'
import type { Terminal } from '@earendil-works/pi-tui'

/** Keep renderer tests independent of the host terminal's hyperlink support. */
export function pinTestTerminalCapabilities(): void {
  setCapabilities({ images: null, trueColor: false, hyperlinks: false })
}

export class FakeTerminal implements Terminal {
  readonly written: string[] = []
  startCount = 0
  stopCount = 0
  drainCount = 0
  private inputHandler: ((data: string) => void) | undefined
  private resizeHandler: (() => void) | undefined
  private columnsValue: number
  private rowsValue: number
  /** Simulated Kitty keyboard protocol state, read by `kittyProtocolActive`. */
  kittyActive = false

  constructor(columns = 80, rows = 24) {
    this.columnsValue = columns
    this.rowsValue = rows
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.startCount += 1
    this.inputHandler = onInput
    this.resizeHandler = onResize
  }

  stop(): void {
    this.stopCount += 1
    this.inputHandler = undefined
    this.resizeHandler = undefined
  }

  drainInput(): Promise<void> {
    this.drainCount += 1
    return Promise.resolve()
  }

  write(data: string): void {
    this.written.push(data)
  }

  get columns(): number {
    return this.columnsValue
  }

  get rows(): number {
    return this.rowsValue
  }

  get kittyProtocolActive(): boolean {
    return this.kittyActive
  }

  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}

  /** Simulate one decoded input sequence arriving from the terminal. */
  sendInput(data: string): void {
    this.inputHandler?.(data)
  }

  /** Change the terminal dimensions and notify the renderer. */
  resize(columns: number, rows: number): void {
    this.columnsValue = columns
    this.rowsValue = rows
    this.resizeHandler?.()
  }

  /** All output written so far, concatenated. */
  get output(): string {
    return this.written.join('')
  }
}

/** Wait for pi-tui's throttled render pipeline to settle. */
export async function waitForRender(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.nextTick(resolve)
  })
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 25)
  })
}
