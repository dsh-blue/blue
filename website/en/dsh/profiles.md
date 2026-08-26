# Profiles & directories

## What a profile is

A profile is a **named assembly stored in the Harness home**: it lists the bundles it layers, holds its own `cordis.patch.yml` override, and owns its independently installed plugins. Booting `dsh --profile blue` composes layers in this order:

1. **The bundles**, in the order the profile lists them (`dsh-base` is always the first layer: model adapters, tools, persistence, sandbox & approval policies, settings, credentials)
2. **The profile's own `cordis.patch.yml`** (inside the profile directory)
3. **The home-level `cordis.patch.yml`** (`$DSH_HOME/cordis.patch.yml`, machine-local global preferences)
4. **`--patch` overlays** (appended from the command line, repeatable)

A patch locates an entry by id and either replaces its entire config or inserts a new entry — **upper layers always overwrite lower ones**, which is the mechanical guarantee that every surface is customizable. The distribution ships `web` and `headless` as template profiles; installing Blue means placing the Blue bundle into your own profile (see [Quickstart](/en/guide/)).

The most direct way to inspect the composition:

```sh
dsh --profile blue --dump-config     # print the actual assembled plugin tree
```

## Directory layout

The `DSH_HOME` environment variable names the Harness home (default `~/.dsh`):

| Path | Contents |
| --- | --- |
| `$DSH_HOME/profiles/<name>/` | a profile: `cordis.patch.yml`, `package.json`, `node_modules`, … — a self-contained pnpm workspace |
| `$DSH_HOME/sessions/` | session persistence (JSONL event logs powering `--resume` and cross-interface restore) |
| `$DSH_HOME/storages/` | per-plugin storage areas |
| `$DSH_HOME/skills/` | user-level skills (see [Skills](/en/dsh/skills)) |
| `$DSH_HOME/cordis.patch.yml` | the home-level global patch overlay |
| `$DSH_HOME/attachments/` | the attachment store (Blue's default location; relocatable via `DSH_BLUE_ATTACHMENT_DIR`) |

## A profile is a pnpm workspace

`dsh plugin --profile <name> add <pkg>` forwards verbatim to pnpm inside the profile directory — so:

- local checkouts install the release closure plus selected validation adapters via the `link:` protocol during development;
- only dependency-graph changes need another `add`/`install` — code changes just need a rebuild;
- done with a profile? Delete `$DSH_HOME/profiles/<name>/` — it's self-contained with no global residue.
