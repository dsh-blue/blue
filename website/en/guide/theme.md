# Theming

Every visual surface in Blue is driven by one **semantic color table**. The `/theme` command hot-switches between providers of that table — a switch rebuilds the render tree, but your input draft, history, and input mode survive through a draft stash.

## /theme usage

```
usage: /theme [dark|light|ocean|paper|auto|custom <path> [dark|light|ocean|paper]]
```

- `/theme` — list every theme and mark the current one (`dark, light, ocean, paper, auto, custom`)
- `/theme dark` / `/theme light` / `/theme ocean` / `/theme paper` — switch to a built-in palette
- `/theme auto` — follow the terminal background (OSC 11 detection)
- `/theme custom <path> [dark|light]` — mount a file palette, with `base` as the fallback (default `dark`)

A switch replaces the provider's fiber wholesale; theme-dependent plugins (transcript, input) reload with it. A failed mount falls back to the built-in dark palette — the UI is never left without a theme.

## The persisted default theme

`/theme` switches the theme **for the session**; the persisted default lives in the `blue:` section of settings.yaml (or the `/settings` panel's Theme row — it cycles the value, applies live, and writes through):

```yaml
blue:
  theme: ocean   # dark | light | ocean | paper | auto
```

The default applies at startup; an in-session `/theme` pick overrides it, and unrelated settings writes never stomp that pick. Custom palettes (`/theme custom <path>`) stay session-only — they never persist.

## custom: JSON palettes

The custom theme reads a JSON file mapping tokens to `#rrggbb` hexes, layered over a `base` (dark or light):

```json
{
  "primary": "#4fa8ff",
  "accent": "#5bc0be",
  "roleUser": "#ffcb6b",
  "selectedBg": "#3a3a4a"
}
```

Rules:

- only write the tokens you want to override; the rest fall through to base;
- **unknown tokens** (not in the table below) and **invalid colors** (not `#rrggbb`) are dropped with a warning, falling back to the base entry;
- an unreadable or non-object file falls back to the whole base palette.

## Semantic tokens

Reference values from the dark palette (light/auto have their own; auto picks per OSC 11):

### Base

| token | dark | used for |
| --- | --- | --- |
| `text` | `#e0e0e0` | body text, brightest footer tier (model, context) |
| `textStrong` | `#ffffff` | emphasized text |
| `muted` | `#888888` | secondary text, middle footer tier (cwd, git badge) |
| `textMuted` | `#6b6b6b` | dimmest tier (tool summary lines, tips, code-block borders) |
| `accent` | `#5bc0be` | accent (banner model line) |
| `primary` | `#4fa8ff` | primary (slash-context editor frame, running tool dot, links) |
| `border` | `#5a5a5a` | regular borders |
| `borderFocus` | `#e8a838` | focused border (approval panel rule) |
| `success` | `#4ec87e` | success |
| `error` | `#e85454` | error |
| `warning` | `#e8a838` | warning |
| `selectedBg` | `#3a3a4a` | selected list-row background |
| `roleUser` | `#ffcb6b` | user-message `❯` gutter |
| `shellMode` | `#bd93f9` | `!` bash mode (editor frame, `$ ` prefix) |

### Markdown

| token | dark | used for |
| --- | --- | --- |
| `mdHeading` | `#e0e0e0` | headings |
| `mdLink` | `#4fa8ff` | link text |
| `mdLinkUrl` | `#6b6b6b` | link URLs |
| `mdCode` | `#4fa8ff` | inline code |
| `mdCodeBlock` | `#e0e0e0` | code-block body |
| `mdCodeBlockBorder` | `#6b6b6b` | code-block border |
| `mdQuote` | `#888888` | quote text |
| `mdQuoteBorder` | `#888888` | quote bar |
| `mdHr` | `#5a5a5a` | horizontal rules |
| `mdListBullet` | `#e0e0e0` | list bullets |

### Diff

| token | dark | used for |
| --- | --- | --- |
| `diffAdded` | `#4ec87e` | added lines |
| `diffRemoved` | `#e85454` | removed lines |
| `diffAddedStrong` | `#7ad99b` | added lines (strong) |
| `diffRemovedStrong` | `#f08585` | removed lines (strong) |
| `diffGutter` | `#6b6b6b` | diff gutter |
| `diffMeta` | `#888888` | diff file headers |
