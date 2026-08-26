# Plugin Development Skill

The loadable repository skill is
`.agents/skills/plugin-development/SKILL.md`. This page is its human-facing
summary.

Use this checklist when adding an external Blue plugin.

1. Classify the contribution as Domain, Interaction, Renderer, or Composition.
2. Declare scope (`host`, `agent`, `session`, `frontend`) and the narrowest Cordis `inject` list.
3. Put domain facts in a projection and writes in an action; expose readonly frontend models and structured actions.
4. Mount every subscription, timer, registry contribution, and provider in the plugin Fiber.
5. Provide capability-absent and plain fallback behavior before adding a TUI consumer.
6. Add headless, swap, unload, width-scan, and bundle-row fixtures before changing the default row.

The generated package shape is `domain` plus an optional `-blue` adapter. The adapter may import `@dsh-blue/blue-frontend`; domain code must not import Blue or renderer packages.
