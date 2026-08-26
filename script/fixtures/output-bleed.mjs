// Child-process preload for smoke-pty-output-recovery.mjs. Profile installation
// completes before spawn, so this referenced delay lands after Blue boot while
// keeping the fixture independent of agent-loop timing.

setTimeout(() => {
  const lines = Array.from({ length: 36 }, (_, index) => ({
    index,
    code: `host-bleed-${String(index)}-${'x'.repeat(120)}`,
  }))
  console.log('[cordis:bleed-fixture]', JSON.stringify({ lines }, null, 2))
}, 3_000)
