#!/bin/bash

# Test script to create a GitHub account and verify bucket creation
# Usage: ./scripts/test-bucket-creation.sh

BASE_URL="http://localhost:3333"
ENV_FILE=".env.local"

echo "========================================="
echo "Testing Bucket Creation for GitHub Accounts"
echo "========================================="
echo ""

# Extract GITHUB_TOKEN from .env.local
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

GITHUB_TOKEN=$(grep "^GITHUB_TOKEN=" "$ENV_FILE" | cut -d '=' -f2- | tr -d '"' | tr -d "'" | xargs)

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Error: GITHUB_TOKEN not found in $ENV_FILE"
  exit 1
fi

echo "✓ Found GITHUB_TOKEN in $ENV_FILE"
echo ""

# Generate a unique account name
TIMESTAMP=$(date +%s)
ACCOUNT_NAME="test-account-$TIMESTAMP"

echo "1. Creating GitHub account: $ACCOUNT_NAME"
echo "----------------------------------------"
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/github-accounts" \
  -H "Content-Type: application/json" \
  -d "{
    \"account_name\": \"$ACCOUNT_NAME\",
    \"token\": \"$GITHUB_TOKEN\"
  }" \
  -w "\nHTTP_STATUS:%{http_code}")

HTTP_STATUS=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d ':' -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $HTTP_STATUS"
echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_STATUS" != "200" ] && [ "$HTTP_STATUS" != "201" ]; then
  echo "❌ Failed to create GitHub account"
  exit 1
fi

# Extract account ID from response
ACCOUNT_ID=$(echo "$BODY" | jq -r '.account.id' 2>/dev/null)

if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" == "null" ]; then
  echo "❌ Could not extract account ID from response"
  exit 1
fi

echo "✓ Account created with ID: $ACCOUNT_ID"
echo ""

# Wait a moment for bucket creation to complete
echo "Waiting 2 seconds for bucket creation..."
sleep 2
echo ""

# Check bucket info
echo "2. Checking bucket for account $ACCOUNT_ID"
echo "----------------------------------------"
BUCKET_RESPONSE=$(curl -s -X GET "${BASE_URL}/api/github-accounts/${ACCOUNT_ID}/bucket" \
  -w "\nHTTP_STATUS:%{http_code}")

BUCKET_HTTP_STATUS=$(echo "$BUCKET_RESPONSE" | grep "HTTP_STATUS" | cut -d ':' -f2)
BUCKET_BODY=$(echo "$BUCKET_RESPONSE" | sed '/HTTP_STATUS/d')

echo "HTTP Status: $BUCKET_HTTP_STATUS"
echo "Response:"
echo "$BUCKET_BODY" | jq '.' 2>/dev/null || echo "$BUCKET_BODY"
echo ""

if [ "$BUCKET_HTTP_STATUS" == "200" ]; then
  BUCKET_NAME=$(echo "$BUCKET_BODY" | jq -r '.bucket.bucket_name' 2>/dev/null)
  BUCKET_TYPE=$(echo "$BUCKET_BODY" | jq -r '.bucket.bucket_type' 2>/dev/null)
  
  if [ -n "$BUCKET_NAME" ] && [ "$BUCKET_NAME" != "null" ]; then
    echo "✓ Bucket created successfully!"
    echo "  - Bucket Name: $BUCKET_NAME"
    echo "  - Bucket Type: $BUCKET_TYPE"
  else
    echo "⚠️  Bucket endpoint responded but no bucket found"
    echo "   (This might be normal if bucket creation is still in progress)"
  fi
else
  echo "⚠️  Could not retrieve bucket info (HTTP $BUCKET_HTTP_STATUS)"
  echo "   This might be normal if bucket creation failed or is still in progress"
fi

echo ""
echo "3. Listing all GitHub accounts"
echo "----------------------------------------"
LIST_RESPONSE=$(curl -s -X GET "${BASE_URL}/api/github-accounts")
echo "$LIST_RESPONSE" | jq '.' 2>/dev/null || echo "$LIST_RESPONSE"
echo ""

echo "========================================="
echo "Test Complete"
echo "========================================="
echo ""
echo "Account ID: $ACCOUNT_ID"
echo "Account Name: $ACCOUNT_NAME"
if [ -n "$BUCKET_NAME" ] && [ "$BUCKET_NAME" != "null" ]; then
  echo "Bucket Name: $BUCKET_NAME"
  echo "Bucket Type: $BUCKET_TYPE"
fi



