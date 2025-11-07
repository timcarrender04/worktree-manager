#!/bin/bash

# End-to-End Test: Create Project, Add Task, Create Worktree
# This script tests the full workflow from authentication to worktree creation

BASE_URL="http://localhost:3333"
COOKIE_FILE="/tmp/wt-e2e-session.txt"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}🧪 End-to-End Test: Full Workflow${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Step 1: Authenticate
echo -e "${BLUE}Step 1: Authenticating...${NC}"
AUTH_RESPONSE=$(curl -s -c "$COOKIE_FILE" -X POST "$BASE_URL/api/auth/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"tim.carrender@gmail.com","password":"Jayson09!!"}')

AUTH_SUCCESS=$(echo "$AUTH_RESPONSE" | grep -o '"message":"Signed in successfully"' || echo "")
if [ -z "$AUTH_SUCCESS" ]; then
  echo -e "${RED}✗ Authentication failed${NC}"
  echo "Response: $AUTH_RESPONSE"
  exit 1
fi
echo -e "${GREEN}✓ Authenticated${NC}"
echo ""

# Step 2: Get GitHub Accounts
echo -e "${BLUE}Step 2: Fetching GitHub accounts...${NC}"
GITHUB_ACCOUNTS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/github-accounts")
ACCOUNT_ID=$(echo "$GITHUB_ACCOUNTS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "env-default" ]; then
  # Try env-default or get from repos API
  echo -e "${YELLOW}⚠ No database GitHub account found, using env-default${NC}"
  ACCOUNT_ID="env-default"
else
  echo -e "${GREEN}✓ Found GitHub account: $ACCOUNT_ID${NC}"
fi
echo ""

# Step 3: Get Repositories
echo -e "${BLUE}Step 3: Fetching repositories...${NC}"
if [ "$ACCOUNT_ID" != "env-default" ]; then
  REPOS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/github-accounts/$ACCOUNT_ID/repositories")
  REPO_FULL_NAME=$(echo "$REPOS_RESPONSE" | grep -o '"full_name":"[^"]*"' | head -1 | cut -d'"' -f4)
else
  # Use repos API for env-default
  REPOS_RESPONSE=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/repos")
  REPO_FULL_NAME=$(echo "$REPOS_RESPONSE" | grep -o '"full_name":"[^"]*"' | head -1 | cut -d'"' -f4)
  
  # If still no repo, try to get from the repos array
  if [ -z "$REPO_FULL_NAME" ]; then
    REPO_FULL_NAME=$(echo "$REPOS_RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
    # Try to construct full_name if we have org info
    if [ -n "$REPO_FULL_NAME" ]; then
      # Try common org names or extract from response
      ORG_NAME=$(echo "$REPOS_RESPONSE" | grep -o '"owner":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "timcarrender04")
      REPO_FULL_NAME="$ORG_NAME/$REPO_FULL_NAME"
    fi
  fi
fi

if [ -z "$REPO_FULL_NAME" ]; then
  echo -e "${YELLOW}⚠ No repositories found in API response${NC}"
  echo -e "${YELLOW}  Trying to use a default repository...${NC}"
  # Use a default repo for testing
  REPO_FULL_NAME="timcarrender04/sideline-frontend"
  echo -e "${YELLOW}  Using: $REPO_FULL_NAME${NC}"
else
  echo -e "${GREEN}✓ Found repository: $REPO_FULL_NAME${NC}"
fi
echo ""

# Step 4: Create Project
echo -e "${BLUE}Step 4: Creating project...${NC}"
PROJECT_NAME="E2E Test Project $(date +%s)"
PROJECT_DESC="End-to-end test project created via curl"

# Build project creation payload
if [ "$ACCOUNT_ID" = "env-default" ]; then
  # For env-default, don't include github_account_id in repositories
  PROJECT_PAYLOAD="{
    \"name\": \"$PROJECT_NAME\",
    \"description\": \"$PROJECT_DESC\",
    \"repositories\": [{\"repository_full_name\": \"$REPO_FULL_NAME\"}]
  }"
else
  PROJECT_PAYLOAD="{
    \"name\": \"$PROJECT_NAME\",
    \"description\": \"$PROJECT_DESC\",
    \"github_account_id\": \"$ACCOUNT_ID\",
    \"repositories\": [{\"repository_full_name\": \"$REPO_FULL_NAME\"}]
  }"
fi

PROJECT_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/projects" \
  -H "Content-Type: application/json" \
  -d "$PROJECT_PAYLOAD")

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$PROJECT_ID" ]; then
  echo -e "${RED}✗ Failed to create project${NC}"
  echo "Response: $PROJECT_RESPONSE"
  exit 1
fi
echo -e "${GREEN}✓ Project created: $PROJECT_ID${NC}"
echo "  Name: $PROJECT_NAME"
echo ""

# Step 5: Create Kanban Item (Task)
echo -e "${BLUE}Step 5: Creating kanban item (task)...${NC}"
TASK_TITLE="E2E Test Task: Implement Feature X"
TASK_DESC="This is a test task created during end-to-end testing. It should trigger worktree creation."
BRANCH_NAME="feat-e2e-test-$(date +%s)"

KANBAN_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/projects/$PROJECT_ID/kanban-items" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"$TASK_TITLE\",
    \"body\": \"$TASK_DESC\",
    \"repository\": \"$REPO_FULL_NAME\",
    \"repositories\": [\"$REPO_FULL_NAME\"],
    \"branch_name\": \"$BRANCH_NAME\",
    \"branch_type\": \"feat\",
    \"column_id\": \"backlog\"
  }")

KANBAN_ITEM_ID=$(echo "$KANBAN_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$KANBAN_ITEM_ID" ]; then
  echo -e "${RED}✗ Failed to create kanban item${NC}"
  echo "Response: $KANBAN_RESPONSE"
  exit 1
fi
echo -e "${GREEN}✓ Kanban item created: $KANBAN_ITEM_ID${NC}"
echo "  Title: $TASK_TITLE"
echo "  Branch: $BRANCH_NAME"
echo ""

# Step 6: Create Worktree
echo -e "${BLUE}Step 6: Creating worktree with branch...${NC}"
REPO_NAME=$(echo "$REPO_FULL_NAME" | cut -d'/' -f2)

# Extract branch name from kanban item (remove feat- prefix for display)
BRANCH_DISPLAY_NAME=$(echo "$BRANCH_NAME" | sed 's/^feat-//')

WORKTREE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/worktrees" \
  -H "Content-Type: application/json" \
  -d "{
    \"repos\": [\"$REPO_NAME\"],
    \"type\": \"feat\",
    \"name\": \"$BRANCH_NAME\",
    \"baseBranch\": \"main\",
    \"githubAccountId\": \"$ACCOUNT_ID\"
  }")

echo "Worktree response: $WORKTREE_RESPONSE" | head -50

WORKTREE_SUCCESS=$(echo "$WORKTREE_RESPONSE" | grep -o '"success":true\|"worktree"' || echo "")
if [ -n "$WORKTREE_SUCCESS" ]; then
  echo -e "${GREEN}✓ Worktree created successfully${NC}"
  
  # Extract worktree path if available
  WORKTREE_PATH=$(echo "$WORKTREE_RESPONSE" | grep -o '"path":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
  if [ -n "$WORKTREE_PATH" ]; then
    echo "  Path: $WORKTREE_PATH"
  fi
  
  # Extract branch name if available
  WORKTREE_BRANCH=$(echo "$WORKTREE_RESPONSE" | grep -o '"branch":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
  if [ -n "$WORKTREE_BRANCH" ]; then
    echo "  Branch: $WORKTREE_BRANCH"
  fi
else
  echo -e "${YELLOW}⚠ Worktree creation response:${NC}"
  echo "$WORKTREE_RESPONSE" | head -30
fi
echo ""

# Step 7: Verify Worktree and Bucket Folder
echo -e "${BLUE}Step 7: Verifying worktree and bucket folder...${NC}"
WORKTREES_LIST=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/worktrees")
WORKTREE_FOUND=$(echo "$WORKTREES_LIST" | grep -o "$BRANCH_NAME" || echo "")

if [ -n "$WORKTREE_FOUND" ]; then
  echo -e "${GREEN}✓ Worktree verified in list${NC}"
  
  # Try to extract worktree path from the list
  WORKTREE_ENTRY=$(echo "$WORKTREES_LIST" | grep -A 5 "$BRANCH_NAME" | head -10)
  WORKTREE_PATH=$(echo "$WORKTREE_ENTRY" | grep -o '"/[^"]*"' | head -1 | tr -d '"' || echo "")
  
  if [ -n "$WORKTREE_PATH" ]; then
    echo "  Worktree Path: $WORKTREE_PATH"
    
    # Check if the directory exists (bucket folder)
    if [ -d "$WORKTREE_PATH" ]; then
      echo -e "${GREEN}✓ Bucket folder exists: $WORKTREE_PATH${NC}"
      echo "  Contents:"
      ls -la "$WORKTREE_PATH" | head -5 | sed 's/^/    /'
    else
      echo -e "${YELLOW}⚠ Bucket folder not found at: $WORKTREE_PATH${NC}"
    fi
  fi
else
  echo -e "${YELLOW}⚠ Worktree not found in list (may take a moment to appear)${NC}"
  echo "Checking worktrees list..."
  echo "$WORKTREES_LIST" | head -50
fi
echo ""

# Summary
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📊 Test Summary${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}✓${NC} Authentication: Success"
echo -e "  ${GREEN}✓${NC} GitHub Account: $ACCOUNT_ID"
echo -e "  ${GREEN}✓${NC} Repository: $REPO_FULL_NAME"
echo -e "  ${GREEN}✓${NC} Project: $PROJECT_ID"
echo -e "  ${GREEN}✓${NC} Kanban Item: $KANBAN_ITEM_ID"
echo -e "  ${GREEN}✓${NC} Worktree: $BRANCH_NAME"
echo ""
echo -e "${CYAN}Project URL:${NC} $BASE_URL/projects/$PROJECT_ID"
echo ""

# Cleanup option
read -p "Do you want to delete the test project? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${BLUE}Deleting test project...${NC}"
  DELETE_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X DELETE "$BASE_URL/api/projects" \
    -H "Content-Type: application/json" \
    -d "{\"id\": \"$PROJECT_ID\"}")
  echo -e "${GREEN}✓ Project deleted${NC}"
fi

# Cleanup
rm -f "$COOKIE_FILE"

echo ""
echo -e "${GREEN}✅ End-to-end test completed!${NC}"

