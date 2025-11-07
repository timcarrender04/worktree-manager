#!/bin/bash

# Test script to test bucket creation with existing account or create new one
# Usage: ./test-bucket-with-existing.sh [account_id]

BASE_URL="http://localhost:3333"
ACCOUNT_ID="$1"

echo "========================================="
echo "Testing Bucket Creation"
echo "========================================="
echo ""

if [ -z "$ACCOUNT_ID" ]; then
  echo "No account ID provided. Let's create a new account first."
  echo ""
  echo "Please provide a GitHub token to test with:"
  read -p "GitHub Token: " GITHUB_TOKEN
  
  if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GitHub token is required"
    exit 1
  fi
  
  TIMESTAMP=$(date +%s)
  ACCOUNT_NAME="test-account-$TIMESTAMP"
  
  echo ""
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
  
  ACCOUNT_ID=$(echo "$BODY" | jq -r '.account.id' 2>/dev/null)
  
  if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" == "null" ]; then
    echo "❌ Could not extract account ID from response"
    exit 1
  fi
  
  echo "✓ Account created with ID: $ACCOUNT_ID"
  echo ""
  echo "Waiting 3 seconds for bucket creation..."
  sleep 3
else
  echo "Using existing account ID: $ACCOUNT_ID"
  echo ""
fi

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
    echo "✅ Bucket created successfully!"
    echo "   - Bucket Name: $BUCKET_NAME"
    echo "   - Bucket Type: $BUCKET_TYPE"
  else
    echo "⚠️  No bucket found. Let's try creating one manually..."
    echo ""
    echo "3. Creating bucket manually"
    echo "----------------------------------------"
    CREATE_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/github-accounts/${ACCOUNT_ID}/bucket" \
      -w "\nHTTP_STATUS:%{http_code}")
    
    CREATE_HTTP_STATUS=$(echo "$CREATE_RESPONSE" | grep "HTTP_STATUS" | cut -d ':' -f2)
    CREATE_BODY=$(echo "$CREATE_RESPONSE" | sed '/HTTP_STATUS/d')
    
    echo "HTTP Status: $CREATE_HTTP_STATUS"
    echo "Response:"
    echo "$CREATE_BODY" | jq '.' 2>/dev/null || echo "$CREATE_BODY"
  fi
else
  echo "⚠️  Could not retrieve bucket info (HTTP $BUCKET_HTTP_STATUS)"
fi

echo ""
echo "4. Checking database directly"
echo "----------------------------------------"
echo "Account info from DB:"
PGHOST=ep-patient-meadow-a40e0xcs-pooler.us-east-1.aws.neon.tech \
PGUSER=neondb_owner \
PGDATABASE=neondb \
PGPASSWORD=npg_S8RNJ3QkCpsY \
psql -c "SELECT id, account_name, bucket_name FROM github_accounts WHERE id = '$ACCOUNT_ID';" 2>&1 | grep -v "password"

echo ""
echo "Bucket info from DB:"
PGHOST=ep-patient-meadow-a40e0xcs-pooler.us-east-1.aws.neon.tech \
PGUSER=neondb_owner \
PGDATABASE=neondb \
PGPASSWORD=npg_S8RNJ3QkCpsY \
psql -c "SELECT github_account_id, bucket_name, bucket_type, region FROM account_buckets WHERE github_account_id = '$ACCOUNT_ID';" 2>&1 | grep -v "password"

echo ""
echo "========================================="
echo "Test Complete"
echo "========================================="


