# Theming

Every visual surface in Blue is driven by one **semantic color table**. The `/theme` command hot-switches between providers of that table — a switch rebuilds the render tree, but your input draft, history, and input mode survive through a draft stash.

## /theme usage

```
usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]
```

- `/theme` — open the **theme picker**: move Up/Down to **live-preview** every palette (the whole UI recolors, banner whale gradient included), `↵` keeps the highlighted theme, `esc` reverts to the theme live when the panel opened. Without display services (a headless context) the bare command falls back to a plain text listing
- `/theme dark` / `light` / `ocean` / `paper` — switch to a built-in palette directly
- `/theme auto` — follow the terminal background (OSC 11 detection)
- `/theme custom <path> [dark|light|ocean|paper]` — mount a file palette, with `base` as the fallback (default `dark`)

## Built-in palettes

| key | style | banner whale gradient |
| --- | --- | --- |
| `dark` | the default dark (pi lineage, brand-blue highlights) | deep navy → sky (the brand sweep) |
| `light` | light (GitHub primer family, one gray tier deeper so it never reads pale) | deep navy → brand blue |
| `ocean` | blue-tinted dark (sky-blue primary, teal accent) | deep sea teal → pale lagoon |
| `paper` | warm light (burnt-orange primary, ink-teal accent) | burnt umber → parchment |

A switch replaces the provider's fiber wholesale; theme-dependent plugins (transcript, input) reload with it. A failed mount falls back to the built-in dark palette — the UI is never left without a theme. The picker re-seats itself after every live-preview switch (the input rebuild briefly unmounts the panel and restores it immediately).

## The persisted default theme

`/theme` switches the theme **for the session**; the persisted default lives in the `blue:` section of settings.yaml (or the `/settings` panel's Theme row — it cycles the value, applies live, and writes through):

```yaml
blue:
  theme: ocean   # dark | light | ocean | paper | auto
```

The default applies at startup; an in-session `/theme` pick overrides it, and unrelated settings writes never stomp that pick. Custom palettes (`/theme custom <path>`) stay session-only — they never persist.

## custom: JSON palettes

The custom theme reads a JSON file mapping tokens to `#rrggbb` hexes, layered over a `base` (any of the four built-ins):

```json
{
  "primary": "#4fa8ff",
  "accent": "#2bc8e8",
  "roleUser": "#4d6bfe",
  "selectedBg": "#3a3a4a",
  "modelHighlight": "#8ca8ff",
  "logoGradient": ["#2a3bd0", "#3247db", "#3b53e7", "#445ff2", "#4d6bfe", "#617cfe", "#758efe", "#899ffe", "#9db1ff"]
}
```

Rules:

- only write the tokens you want to override; the rest fall through to base;
- **unknown tokens** (not in the table below) and **invalid colors** (not `#rrggbb`) are dropped with a warning, falling back to the base entry;
- `logoGradient` is the one array-valued token: one `#rrggbb` per whale row, top to bottom; an empty array, an invalid entry, or a non-array falls back to the **whole** base gradient, and a **short** array repeats its last entry for the remaining rows;
- an unreadable or non-object file falls back to the whole base palette.

## Semantic tokens

Reference values from the dark palette (light/ocean/paper have their own; auto picks between dark and light per OSC 11):

### Base

| token | dark | used for |
| --- | --- | --- |
| `text` | `#e0e0e0` | body text, brightest footer tier (model, context) |
| `textStrong` | `#ffffff` | emphasized text |
| `muted` | `#888888` | secondary text, middle footer tier (cwd, git badge) |
| `textMuted` | `#6b6b6b` | deepest gray tier (tool summary rows, tips, code block borders) |
| `accent` | `#2bc8e8` | secondary highlight (pointers, secondary emphasis) |
| `primary` | `#4fa8ff` | primary (slash-mode editor, running tool dots, links) |
| `border` | `#5a5a5a` | regular borders |
| `borderFocus` | `#e8a838` | focused border (approval panel rules) |
| `success` | `#4ec87e` | success state |
| `error` | `#e85454` | failure state |
| `warning` | `#e8a838` | caution state |
| `selectedBg` | `#3a3a4a` | selected list row background |
| `roleUser` | `#4d6bfe` | user-message `❯` rail |
| `shellMode` | `#bd93f9` | `!` bash mode (editor, `$ ` prefix) |

### Brand pieces (banner)

| token | dark | used for |
| --- | --- | --- |
| `modelHighlight` | `#8ca8ff` | the banner's model-row highlight |
| `logoGradient` | 9-entry array (`#2a3bd0` → `#9db1ff`) | the whale logo's per-row sweep, top to bottom |

### Markdown rendering

| token | dark | used for |
| --- | --- | --- |
| `mdHeading` | `#e0e0e0` | headings |
| `mdLink` | `#4fa8ff` | link text |
| `mdLinkUrl` | `#6b6b6b` | link URLs |
| `mdCode` | `#4fa8ff` | inline code |
| `mdCodeBlock` | `#e0e0e0` | code block body |
| `mdCodeBlockBorder` | `#6b6b6b` | code block borders |
| `mdQuote` | `#888888` | quote body |
| `mdQuoteBorder` | `#888888` | quote rails |
| `mdHr` | `#5a5a5a` | horizontal rules |
| `mdListBullet` | `#e0e0e0` | list bullets |

### diff coloring

| token | dark | used for |
| --- | --- | --- |
| `diffAdded` | `#4ec87e` | added lines |
| `diffRemoved` | `#e85454` | removed lines |
| `diffAddedStrong` | `#7ad99b` | added lines (emphasized) |
| `diffRemovedStrong` | `#f08585` | removed lines (emphasized) |
| `diffGutter` | `#6b6b6b` | diff line-number gutter |
| `diffMeta` | `#888888` | diff file-header metadata |
