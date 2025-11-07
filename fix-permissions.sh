#!/bin/bash
# Script to fix permissions on repos directory
# Run this after creating worktrees if you encounter permission issues

REPOS_DIR="${REPO_ROOT:-${HOST_REPO_ROOT:-/home/ert/projects/backend/repo-hub/repos}}"
USER_ID="${USER_ID:-$(id -u)}"
GROUP_ID="${GROUP_ID:-$(id -g)}"

if [ ! -d "$REPOS_DIR" ]; then
  echo "❌ Repository directory '$REPOS_DIR' does not exist."
  echo "    Set REPO_ROOT or HOST_REPO_ROOT to the correct path and re-run this script."
  exit 1
fi

echo "Fixing permissions on $REPOS_DIR..."
sudo chown -R "$USER_ID":"$GROUP_ID" "$REPOS_DIR"
sudo chmod -R u+rwX,g+rwX,o+rX "$REPOS_DIR"

# Make .git directories writable (needed for worktree operations)
echo "Making .git directories writable..."
find "$REPOS_DIR" -type d -name ".git" -exec sudo chmod -R u+rwX,g+rwX,o+rX {} \;
find "$REPOS_DIR" -type d -name "refs" -exec sudo chmod -R u+rwX,g+rwX,o+rX {} \;

# Make Tree directory writable
if [ -d "$REPOS_DIR/Tree" ]; then
    sudo chmod -R u+rwX,g+rwX,o+rX "$REPOS_DIR/Tree"
fi

echo "✅ Permissions fixed!"
echo ""
echo "Current ownership:"
ls -la "$REPOS_DIR" | head -5
echo ""
echo "⚠️  Note: For a permanent fix, rebuild the container with:"
echo "   docker-compose down"
echo "   docker-compose build --no-cache"
echo "   docker-compose up -d"

