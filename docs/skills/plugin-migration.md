# Plugin Migration Skill

Run `node script/blue-plugin-validate.mjs <package>` before migration. Record
each finding under Domain, Projection, Action, Interaction model, Renderer UI,
Bundle rows, scope, and deletion condition.

Flag direct pi-tui/ANSI/raw-terminal/DOM imports, Agent or Session object leaks,
event folding in UI code, module-level mutable state, implicit bundle ordering,
and providers without an unload path. Extract domain and projection first;
then add a Blue adapter and keep the old renderer as a golden baseline until
the replacement fixture passes.
