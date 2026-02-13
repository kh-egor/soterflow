#!/bin/bash
# Syncs soterflow fork with upstream openclaw/openclaw
# Run manually or via cron: 0 3 * * 1 (weekly Monday 3am)
#
# Usage:
#   ./scripts/sync-upstream.sh
#
set -euo pipefail

UPSTREAM_URL="https://github.com/openclaw/openclaw.git"
UPSTREAM_NAME="upstream"

cd "$(git rev-parse --show-toplevel)"

# Add upstream remote if not exists
if ! git remote get-url "$UPSTREAM_NAME" &>/dev/null; then
  echo "➕ Adding upstream remote: $UPSTREAM_URL"
  git remote add "$UPSTREAM_NAME" "$UPSTREAM_URL"
fi

echo "⬇️  Fetching upstream..."
git fetch "$UPSTREAM_NAME"

CURRENT_BRANCH=$(git branch --show-current)
echo "🔀 Merging upstream/main into $CURRENT_BRANCH..."

if git merge "$UPSTREAM_NAME/main" --no-edit; then
  echo "✅ Merge successful. Run 'git push' to update your fork."
else
  echo "❌ Merge conflict detected! Aborting merge."
  git merge --abort
  echo ""
  echo "To resolve manually:"
  echo "  git fetch upstream"
  echo "  git merge upstream/main"
  echo "  # fix conflicts, then: git add . && git merge --continue"
  exit 1
fi
