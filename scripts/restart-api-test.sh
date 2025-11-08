#!/bin/bash

# Script to restart Docker and test the API endpoints

echo "🛑 Stopping containers..."
docker-compose down

echo "🚀 Starting containers..."
docker-compose up -d

echo "⏳ Waiting for Next.js to start (10 seconds)..."
sleep 10

echo ""
echo "🧪 Testing API endpoints..."
echo ""

echo "1. Testing /api/repos endpoint:"
curl -s http://localhost:3021/api/repos | python3 -m json.tool | grep -A 2 "url"

echo ""
echo "2. Testing /api/worktrees endpoint:"
curl -s http://localhost:3021/api/worktrees | python3 -m json.tool

echo ""
echo "✅ API test complete!"
echo ""
echo "📋 Container status:"
docker-compose ps



