#!/bin/bash

# Script to rebuild and restart the worktree-manager container
# This ensures a fresh build without cache

set -e

echo "🛑 Stopping and removing containers..."
docker-compose down

echo "🧹 Removing old images and cache..."
docker-compose rm -f
docker image rm worktree-manager_worktree-manager 2>/dev/null || true

echo "🔨 Building fresh image (no cache)..."
docker-compose build --no-cache --pull

echo "🚀 Starting containers..."
docker-compose up -d

echo "✅ Container restarted with fresh build!"
echo "📋 Waiting for Next.js to start..."
sleep 5

echo "📊 Container status:"
docker-compose ps

echo ""
echo "🔍 Checking logs (press Ctrl+C to exit):"
docker-compose logs -f
