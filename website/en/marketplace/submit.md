# Submission guide

Listing your plugin in the [plugin marketplace](/en/marketplace/) is a single pull request to the [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace) repository. This page covers the listing criteria, the registry fields, how to write the detail pages, and the review process.

## Listing criteria

- **Installable**: the plugin installs from a public source via `blue plugin add <spec>` (a GitHub source is enough; npm is not a requirement — an npm source can be added after publishing). The package name must contain `blue`, `frontend`, or `adapter`, matching the main repository's validation rule;
- **Public capabilities only**: the plugin uses only the five capabilities open in phase one — `commands` / `status` / `status.provider` / `dock` / `notifications` — and the declaration matches reality (see the capability contracts in [Core concepts](/en/plugins/concepts));
- **Bilingual basics**: `title` and `tagline` must be provided in both Chinese and English; the tagline is one action sentence describing what the plugin does (Chinese ≤60 characters, English ≤100 characters, English ends with a period, no emoji);
- **Accurate metadata**: `version` and `license` match the source repository.

To learn how plugins are written and verified, start with the [quickstart](/en/plugins/quickstart); run your plugin through [debugging and validation](/en/plugins/testing) before submitting.

## Registry fields

A listing is one entry appended to the **end** of the `plugins` array in `registry.json`:

| Field | Required | Description |
| --- | --- | --- |
| `id` | ✓ | Unique id — also the marketplace URL slug and the `content/<id>/` directory name; `^[a-z0-9][a-z0-9-]*$`; `submit` is reserved |
| `package` | ✓ | Target package name (matching `name` in the source repository's `package.json`) |
| `version` | ✓ | Display version |
| `title` | ✓ | Display name in both languages `{ "zh": ..., "en": ... }` |
| `tagline` | ✓ | One-line description in both languages (style rules above) |
| `author` | ✓ | Author display name |
| `repo` | ✓ | `https://github.com/<owner>/<repo>` source repository |
| `install` | ✓ | Install sources (at least one; **order is the preference order**, the card shows the first): `{ "kind": "github" \| "git" \| "npm" \| "tarball", "spec": ... }` — `spec` plugs directly into `blue plugin add <spec>` |
| `capabilities` | ✓ | Blue capabilities used |
| `categories` | ✓ | Categories from the vocabulary in `categories.json` |
| `license` | ✓ | SPDX identifier |
| `verified` | ✓ | Always `false` when submitting; maintainers flip it during review |
| `added` | ✓ | Listing date `YYYY-MM-DD` |
| `npm` |  | Package name once published to npm, `null` before; must not be `null` when an `npm` install source is present |
| `image` |  | Card cover / detail hero image, a relative path under `content/<id>/assets/`; `null` for now |

The first listed entry, `blue-doudizhu`, is a good reference:

```json
{
  "id": "blue-doudizhu",
  "package": "@dsh-blue/blue-doudizhu",
  "version": "0.1.0",
  "title": { "zh": "斗地主", "en": "Doudizhu" },
  "tagline": {
    "zh": "在 Dock 面板里打斗地主：字符牌局、本地 Bot 对手与积分排行榜。",
    "en": "Play Doudizhu in a dock pane: a character-drawn card table, local bots, and a score leaderboard."
  },
  "author": "dsh-blue",
  "repo": "https://github.com/dsh-blue/blue-doudizhu",
  "install": [
    { "kind": "github", "spec": "github:dsh-blue/blue-doudizhu" },
    { "kind": "git", "spec": "git+https://github.com/dsh-blue/blue-doudizhu.git" }
  ],
  "capabilities": ["commands", "dock"],
  "categories": ["games"],
  "license": "MIT",
  "verified": true,
  "npm": null,
  "image": null,
  "added": "2026-08-27"
}
```

## Writing the detail pages

Each plugin ships bilingual detail pages `content/<id>/zh.md` and `content/<id>/en.md`, rendered by the website at `/marketplace/<id>/` and `/en/marketplace/<id>/`. Conventions:

- Start the file with frontmatter `title:` and include a level-one heading in the body;
- Structure as needed: overview → prerequisites (installing Blue) → installation → commands/usage → capabilities → features → FAQ;
- **Never hand-copy install commands or metadata**: render them from the registry with the global components — `<InstallCommand command="blue plugin add <spec>" />` for a copyable install command, and `<PluginMeta id="<id>" />` for version/license/repository metadata. That way version numbers live in exactly one place, `registry.json`;
- Site-internal links use absolute paths with the language prefix (Chinese pages `/plugins/...`, English pages `/en/plugins/...`); end the page with a "back to the marketplace" link.

See [`content/blue-doudizhu/`](https://github.com/dsh-blue/marketplace/tree/master/content/blue-doudizhu) in the marketplace repository for a full example.

## Pull request process

1. Fork [dsh-blue/marketplace](https://github.com/dsh-blue/marketplace) and create a branch;
2. Append the entry to the end of `registry.json` and add `content/<id>/zh.md` and `en.md`;
3. Open a PR titled `add: <id>`;
4. **One plugin per PR**; you may only touch `registry.json` and your own `content/<id>/` directory (the same applies when updating your plugin later) — changes to other entries are rejected;
5. Set `verified` to `false`; once CI and human review pass, the PR is merged and the site updates by the next day (daily rebuild).

## Automated checks

Every PR runs [validate-registry](https://github.com/dsh-blue/marketplace/blob/master/script/validate-registry.mjs); you can run `node script/validate-registry.mjs` locally before submitting. It checks: JSON parses; field whitelist (unknown keys fail, so typos are never silently dropped); `id` uniqueness, format, and reserved words; package-name rule; `repo` format; install-source validity (`npm` field non-null when an npm source is present); capabilities and categories within their vocabularies; tagline bilingual completeness, length, and style; bilingual detail files present with frontmatter `title` and a level-one heading; `content/` directories matching entries one-to-one; and **a PR by a non-maintainer that introduces `"verified": true` fails outright**.

## Human review checklist

Before merging, maintainers verify:

- The plugin **actually installs** via the first `install` source (`blue plugin add <spec>`), and after a Blue restart the commands/panes appear;
- `capabilities` match what the plugin really uses; `version` and `license` match the source repository;
- The tagline is equivalent in both languages and leads with a verb; detail-page internal links carry the correct language prefix.
