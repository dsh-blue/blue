# `@dsh-blue/blue-frontend`

This package owns renderer-neutral frontend data plus locale, theme, and
notification services. It must not import pi-tui, React/DOM, ANSI, terminal
width, raw keys, Agent, Session, or renderer objects.

Models are immutable semantic facts. Transcript and tool presentation models
use canonical `BlueUiNode` values and structured actions. No parallel view
vocabulary or provider lifecycle belongs here.

`BlueLocaleService` owns one frontend tree's English/Simplified Chinese
catalogs, preference revision, interpolation, and subscriptions.
`ThemeModelService` stores immutable semantic color tokens.
`NotificationModelService` stores renderer-neutral notices with dedupe keys.
Registrations and listeners are Fiber-disposable and no product mutable state
may be a module singleton.

Do not restore provider hosts, provider candidates, swap/rollback state,
renderer adapters, or dsh service wrappers. Public model changes require
architecture-boundary tests and `pnpm run verify:full`.
