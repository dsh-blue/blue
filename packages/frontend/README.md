# `@dsh-blue/blue-frontend`

English | [中文](README.zh.md)

Renderer-neutral frontend runtime: readonly interaction models, registries, and the provider host. Models are plain immutable data — views, lists, panels, status, dock, notifications, editor, tool presentation, and transcript entries — carrying structured `Action` payloads instead of callbacks. No model contains pi-tui, React/DOM, ANSI, terminal width, focus handles, renderer key bindings, Promises, or Harness Agent/Session objects; renderer adapters compile them into concrete components.

- `FrontendHost` owns the active provider while the host itself stays alive across swaps. Each swap serializes capture → abort → dispose → activate → restore; an activation failure falls back to the built-in `plainProvider` without disturbing the Agent loop, and late publishes are dropped by generation.
- `blueThemeModels` (`ThemeModelService`) is the semantic theme registry: immutable token tables with activation and subscription. Renderer adapters register a model and dispose it with their Fiber.
- `blueNotifications` (`NotificationModelService`) is a renderer-neutral notification registry with dedupe keys; presentation — toast, status, or log — is the renderer's choice.

This is a domain package: it contains no TUI, terminal, or renderer code.
