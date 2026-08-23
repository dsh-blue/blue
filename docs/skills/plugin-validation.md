# Plugin Validation Skill

The loadable repository skill is `.agents/skills/plugin-validation/SKILL.md`.
This page is its human-facing summary.

`node script/blue-plugin-validate.mjs <package>` performs the static boundary
audit and verifies package exports, build output, and a Fiber lifecycle marker.
Run it together with the full Blue gate and `script/install-dev.sh` against a
tagged non-production profile. Record the profile name, Harness line, width
scenarios, fallback result, and unload/late-result result in the fixture log.
