#!/bin/bash

# Test script for AWS credentials POST endpoints
# Usage: ./scripts/test-aws-credentials.sh

BASE_URL="http://localhost:3333"

# Load environment variables from .env.local if present
if [ -f "${PWD}/.env.local" ]; then
  # shellcheck disable=SC1091
  source "${PWD}/.env.local"
fi

AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"

if [ -z "${AWS_ACCESS_KEY_ID}" ] || [ -z "${AWS_SECRET_ACCESS_KEY}" ]; then
  echo "Error: AWS credentials are not set."
  echo "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your environment or .env.local."
  exit 1
fi

echo "========================================="
echo "Testing AWS Credentials POST Endpoints"
echo "========================================="
echo ""

echo "1. Testing /api/settings/test endpoint..."
echo "----------------------------------------"
curl -X POST "${BASE_URL}/api/settings/test" \
  -H "Content-Type: application/json" \
  -d "{
    \"service\": \"aws\",
    \"settings\": {
      \"awsAccessKeyId\": \"${AWS_ACCESS_KEY_ID}\",
      \"awsSecretAccessKey\": \"${AWS_SECRET_ACCESS_KEY}\"
    }
  }" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -s | jq '.' 2>/dev/null || cat
echo ""

echo "2. Testing /api/aws-credentials POST endpoint..."
echo "----------------------------------------"
curl -X POST "${BASE_URL}/api/aws-credentials" \
  -H "Content-Type: application/json" \
  -d "{
    \"profile_name\": \"test-profile-$(date +%s)\",
    \"access_key_id\": \"${AWS_ACCESS_KEY_ID}\",
    \"secret_access_key\": \"${AWS_SECRET_ACCESS_KEY}\",
    \"region\": \"us-east-1\",
    \"default_profile\": true
  }" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -s | jq '.' 2>/dev/null || cat
echo ""

echo "3. Testing GET /api/aws-credentials to list credentials..."
echo "----------------------------------------"
curl -X GET "${BASE_URL}/api/aws-credentials" \
  -H "Content-Type: application/json" \
  -w "\n\nHTTP Status: %{http_code}\n" \
  -s | jq '.' 2>/dev/null || cat
echo ""

echo "========================================="
echo "Test Complete"
echo "========================================="



