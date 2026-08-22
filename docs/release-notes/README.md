# Release notes template

One file per tag, named `v<version>.md` next to this template. Commit it with
(or before) the version bump — the release workflow's `release` job picks it
up automatically when the tag lands and builds the GitHub Release page from
it (no `CHANGELOG.md` to keep in sync; the tag ↔ Release pairing is 1:1).

Three sections, kept short — link out for detail:

````markdown
# Blue <version>

<one paragraph: what this release is — preview line, theme of the release>

## Highlights

- <the few things a user should notice, feature-shaped>

## Fixes

- <notable fixes since the previous tag>

## Known issues

- <honest, short — link docs/blue-roadmap.md's parked section for the list>
````

Notes for rc tags should state the preview semantics (rc dist-tag, pinned
harness line) every time — readers land on any release page cold.
