#!/usr/bin/env bash
# install-dev.sh — one-shot local development install of Blue into a dsh profile.
#
# Builds the Blue workspace and link-installs the bundle plus all eight
# runtime library packages into a dev
# profile (no npm publish). Code changes take effect after `pnpm run build`;
# re-run this script only when the dependency graph changes.
#
# Environment overrides:
#   DSH_BIN    dsh executable to use        (default: dsh from PATH)
#   PROFILE    target profile name          (default: blue-dev)
#   DSH_HOME   dsh home directory           (default: dsh's own resolution)
#   PROFILE_INSTALL_FLAGS
#              extra flags for the profile's `pnpm install` (default: none).
#              CI consumers pass --no-frozen-lockfile: CI=true flips pnpm's
#              frozen-lockfile default on, and ensure-loader-entries' package
#              additions then read as lockfile violations.
#
# Lane rule (D51 aftermath): `blue` is the production profile — npm
# installs only, never link:; `blue-dev` links this checkout; a worktree
# gets its own `blue-<tag>`. Never link into `blue`: a later npm upgrade
# half-overwrites the links and boots a Frankenstein tree.
#
# Worktree effect testing: run this from a feature worktree with
# PROFILE=blue-<short-branch-tag> to give that checkout its own dogfood
# profile (packages link from this script's checkout). Remove the profile
# directory (~/.dsh/profiles/blue-<tag>) when the branch merges.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_BIN="${DSH_BIN:-dsh}"
PROFILE="${PROFILE:-blue-dev}"

if ! command -v "$DSH_BIN" >/dev/null 2>&1; then
  echo "error: '$DSH_BIN' not found on PATH. Install dsh or set DSH_BIN=/path/to/dsh" >&2
  exit 1
fi

echo "==> Building Blue workspace"
pnpm --dir "$REPO_ROOT" run build

echo "==> Link-installing Blue packages into profile '$PROFILE'"
"$DSH_BIN" plugin --profile "$PROFILE" add \
  "link:$REPO_ROOT/packages/bundle/blue" \
  "link:$REPO_ROOT/packages/api" \
  "link:$REPO_ROOT/packages/frontend" \
  "link:$REPO_ROOT/packages/harness-adapter" \
  "link:$REPO_ROOT/packages/context" \
  "link:$REPO_ROOT/packages/core" \
  "link:$REPO_ROOT/packages/interaction" \
  "link:$REPO_ROOT/packages/transcript" \
  "link:$REPO_ROOT/packages/app"

# Harness packages the bundle patch references as loader entries resolve from
# the profile root at boot; the global CLI bundles only what dsh-base needs.
# Without this step a fresh profile boot-crashes on entries outside that
# closure (first hit: dsh-session-title-all-prompts-llm).
PROFILE_DIR="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE"
echo "==> Ensuring harness loader entries resolve from profile '$PROFILE'"
node "$REPO_ROOT/script/ensure-loader-entries.mjs" \
  "$REPO_ROOT/packages/bundle/blue" "$PROFILE_DIR" "$DSH_BIN"
# shellcheck disable=SC2086 — PROFILE_INSTALL_FLAGS is a word-split flag list
pnpm --dir "$PROFILE_DIR" install ${PROFILE_INSTALL_FLAGS:-} >/dev/null

cat <<EOF

Done. Blue is linked into profile '$PROFILE'.

  Run:      $DSH_BIN --profile $PROFILE [task]
  Resume:   $DSH_BIN --profile $PROFILE --resume <sessionId>
  Iterate:  edit src -> pnpm --dir "$REPO_ROOT" run build -> re-run dsh

Note: eight "declares no dsh.bundle" warnings during install are expected —
only the bundle package contributes a layer.
EOF
