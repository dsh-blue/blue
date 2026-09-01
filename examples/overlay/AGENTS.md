# `@dsh-blue-example/overlay`

Ordinary Cordis plugin injecting native `commands` and direct
`blueOverlays`. Its dsh command opens one capturing overlay. Escape dismisses
it by default; the plugin may close or refresh it through the returned handle.

The request contributes body content only. Core owns frame, focus, size, and
width. Fiber unload removes both the command and any open overlay. Keep it
opt-in and do not add gesture tokens or a host facade.
