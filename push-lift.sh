#!/usr/bin/env bash
# push-lift.sh — add/commit/push for your Lift App repo

set -euo pipefail

REPO_DIR="/c/Users/josho/OneDrive/Desktop/Lift App"

# 1) Go to repo
if [[ ! -d "$REPO_DIR" ]]; then
  echo "❌ Repo directory not found: $REPO_DIR"
  exit 1
fi
cd "$REPO_DIR"

# 2) Make sure we're in a git repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "❌ Not a git repository: $REPO_DIR"
  exit 1
fi

# 3) Determine commit message
if [[ $# -gt 0 ]]; then
  COMMIT_MSG="$*"
else
  read -rp "Commit message: " COMMIT_MSG
fi
if [[ -z "${COMMIT_MSG:-}" ]]; then
  COMMIT_MSG="Update: $(date '+%Y-%m-%d %H:%M:%S')"
fi

# 4) Stage changes (including new + deleted files)
git add -A

# If there’s nothing to commit, skip commit but still allow push
if git diff --cached --quiet; then
  echo "ℹ️  No staged changes to commit. Skipping commit."
else
  git commit -m "$COMMIT_MSG"
fi

# 5) Verify remote/branch, then push to main
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "❌ No 'origin' remote configured. Add it with:"
  echo "   git remote add origin <YOUR_REPO_URL>"
  exit 1
fi

# Ensure we’re on main (optional; remove if you don’t want auto-switch)
current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "main" ]]; then
  echo "ℹ️  You are on '$current_branch'. Switching to 'main'..."
  git checkout main || {
    echo "❌ Couldn't switch to 'main'. Create it with:"
    echo "   git checkout -b main"
    exit 1
  }
fi

# Push (use -u first time, harmless later)
git push -u origin main
echo "✅ Pushed to origin/main."
