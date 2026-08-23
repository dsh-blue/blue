# `@dsh-blue/blue-context`

Renderer-neutral dsh-context interaction adapter and `/context` model. It reads the official Harness session-projection service (`contextTimeline`, `contextPressure`, `contextBreakdown`, and `tokenUsage`), coalesces same-sequence key pushes into a consistent cut, and follows the current Blue session without exposing Agent or Session objects.

The model covers provider usage, context occupancy, composition, current-surface categories, and recent request/context events. Projection keys may unload independently; the corresponding model sections and capabilities disappear on the next official cut. Compatibility sources may also expose a structured refresh action. The package contains no terminal or renderer dependency.
