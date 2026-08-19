#!/usr/bin/env bash
# install-dev.sh — one-shot local development install of Blue into a dsh profile.
#
# Builds the Blue workspace and link-installs all five packages into the blue
# profile (no npm publish). Code changes take effect after `pnpm run build`;
# re-run this script only when the dependency graph changes.
#
# Environment overrides:
#   DSH_BIN    dsh executable to use        (default: dsh from PATH)
#   PROFILE    target profile name          (default: blue)
#   DSH_HOME   dsh home directory           (default: dsh's own resolution)
#
# Worktree effect testing: run this from a feature worktree with
# PROFILE=blue-<short-branch-tag> to give that checkout its own dogfood
# profile (packages link from this script's checkout). Remove the profile
# directory (~/.dsh/profiles/blue-<tag>) when the branch merges.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_BIN="${DSH_BIN:-dsh}"
PROFILE="${PROFILE:-blue}"

if ! command -v "$DSH_BIN" >/dev/null 2>&1; then
  echo "error: '$DSH_BIN' not found on PATH. Install dsh or set DSH_BIN=/path/to/dsh" >&2
  exit 1
fi

echo "==> Building Blue workspace"
pnpm --dir "$REPO_ROOT" run build

echo "==> Link-installing Blue packages into profile '$PROFILE'"
"$DSH_BIN" plugin --profile "$PROFILE" add \
  "link:$REPO_ROOT/packages/bundle/blue" \
  "link:$REPO_ROOT/packages/core" \
  "link:$REPO_ROOT/packages/interaction" \
  "link:$REPO_ROOT/packages/transcript" \
  "link:$REPO_ROOT/packages/app"

cat <<EOF

Done. Blue is linked into profile '$PROFILE'.

  Run:      $DSH_BIN --profile $PROFILE [task]
  Resume:   $DSH_BIN --profile $PROFILE --resume <sessionId>
  Iterate:  edit src -> pnpm --dir "$REPO_ROOT" run build -> re-run dsh

Note: four "declares no dsh.bundle" warnings during install are expected —
only the bundle package contributes a layer.
EOF
