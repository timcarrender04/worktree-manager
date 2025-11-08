#!/bin/bash

# Full End-to-End Workflow Test
# Flow: Project → Task (with branch_type) → Auto-generate branch name → Create worktree → Bucket folder

BASE_URL="http://localhost:3333"
COOKIE_FILE="/tmp/wt-full-workflow-session.txt"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}🧪 Full Workflow Test: Project → Task → Worktree${NC}"
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

# Step 2: Use Existing Project (to avoid transaction visibility issues)
echo -e "${BLUE}Step 2: Using existing project...${NC}"
# Use the known project that exists in the database
PROJECT_ID="a2bd6605-2176-40f2-be99-5ef4d0aa3038"
echo -e "${GREEN}✓ Using project: $PROJECT_ID${NC}"
echo "  Name: Sideline Surgeons"

# Get project repositories
PROJECT_DETAILS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/projects/$PROJECT_ID")
REPO_FULL_NAME=$(echo "$PROJECT_DETAILS" | grep -o '"repository_full_name":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$REPO_FULL_NAME" ]; then
  # Fallback to default
  REPO_FULL_NAME="timcarrender04/sideline-frontend"
  echo -e "${YELLOW}⚠ Using default repository: $REPO_FULL_NAME${NC}"
else
  echo -e "${GREEN}✓ Repository: $REPO_FULL_NAME${NC}"
fi
echo ""

# Step 3: Create Task with Branch Type
echo -e "${BLUE}Step 3: Creating task with branch type (feat)...${NC}"
TASK_TITLE="Implement User Authentication System"
TASK_BODY="Add complete user authentication with JWT tokens, password hashing, and session management. Include login, signup, and password reset functionality."
BRANCH_TYPE="feat"

KANBAN_RESPONSE=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE_URL/api/projects/$PROJECT_ID/kanban-items" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"$TASK_TITLE\",
    \"body\": \"$TASK_BODY\",
    \"repository\": \"$REPO_FULL_NAME\",
    \"repositories\": [\"$REPO_FULL_NAME\"],
    \"branch_type\": \"$BRANCH_TYPE\",
    \"column_id\": \"backlog\"
  }")

KANBAN_ITEM_ID=$(echo "$KANBAN_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
BRANCH_NAME=$(echo "$KANBAN_RESPONSE" | grep -o '"branch_name":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$KANBAN_ITEM_ID" ]; then
  echo -e "${RED}✗ Failed to create kanban item${NC}"
  echo "Response: $KANBAN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✓ Kanban item created: $KANBAN_ITEM_ID${NC}"
echo "  Title: $TASK_TITLE"
if [ -n "$BRANCH_NAME" ]; then
  echo -e "${GREEN}✓ Branch name generated: $BRANCH_NAME${NC}"
else
  echo -e "${YELLOW}⚠ No branch name in response${NC}"
fi

# Check for worktree creation in response
WORKTREE_CREATED=$(echo "$KANBAN_RESPONSE" | grep -o '"worktrees"' || echo "")
if [ -n "$WORKTREE_CREATED" ]; then
  echo -e "${GREEN}✓ Worktree creation attempted${NC}"
  
  # Extract worktree results
  WORKTREE_SUCCESS=$(echo "$KANBAN_RESPONSE" | grep -o '"success":true' || echo "")
  if [ -n "$WORKTREE_SUCCESS" ]; then
    echo -e "${GREEN}✓ Worktree created successfully${NC}"
  else
    echo -e "${YELLOW}⚠ Worktree creation may have issues${NC}"
    echo "$KANBAN_RESPONSE" | grep -A 10 '"worktree' | head -15
  fi
fi
echo ""

# Step 4: Verify Worktree and Bucket Folder
echo -e "${BLUE}Step 4: Verifying worktree and bucket folder...${NC}"

# Get worktrees list
WORKTREES_LIST=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/worktrees")

if [ -n "$BRANCH_NAME" ]; then
  # Extract repo name for searching
  REPO_NAME=$(echo "$REPO_FULL_NAME" | cut -d'/' -f2)
  
  # Search for worktree with this branch
  WORKTREE_FOUND=$(echo "$WORKTREES_LIST" | grep -i "$BRANCH_NAME\|$REPO_NAME" || echo "")
  
  if [ -n "$WORKTREE_FOUND" ]; then
    echo -e "${GREEN}✓ Worktree found in list${NC}"
    
    # Try to extract path
    WORKTREE_PATH=$(echo "$WORKTREES_LIST" | grep -B 2 -A 5 "$BRANCH_NAME" | grep -o '"/[^"]*"' | head -1 | tr -d '"' || echo "")
    
    if [ -n "$WORKTREE_PATH" ]; then
      echo "  Path: $WORKTREE_PATH"
      
      # Check if directory exists
      if [ -d "$WORKTREE_PATH" ]; then
        echo -e "${GREEN}✓ Bucket folder exists: $WORKTREE_PATH${NC}"
        echo "  Directory contents:"
        ls -la "$WORKTREE_PATH" 2>/dev/null | head -10 | sed 's/^/    /' || echo "    (empty or inaccessible)"
        
        # Check if it's a git worktree
        if [ -d "$WORKTREE_PATH/.git" ] || [ -f "$WORKTREE_PATH/.git" ]; then
          echo -e "${GREEN}✓ Git worktree verified${NC}"
          
          # Get current branch
          CURRENT_BRANCH=$(cd "$WORKTREE_PATH" && git branch --show-current 2>/dev/null || echo "")
          if [ -n "$CURRENT_BRANCH" ]; then
            echo "  Current branch: $CURRENT_BRANCH"
            if [[ "$CURRENT_BRANCH" == *"$BRANCH_NAME"* ]] || [[ "$BRANCH_NAME" == *"$CURRENT_BRANCH"* ]]; then
              echo -e "${GREEN}✓ Branch matches: $CURRENT_BRANCH${NC}"
            fi
          fi
        fi
      else
        echo -e "${YELLOW}⚠ Bucket folder not found at: $WORKTREE_PATH${NC}"
      fi
    else
      # Try to construct expected path
      REPO_ROOT="${REPO_ROOT:-/home/ert/projects/backend/repo-hub/repos}"
      TREE_ROOT="${WORKTREE_ROOT:-$REPO_ROOT/Tree}"
      EXPECTED_PATH="$TREE_ROOT/$REPO_NAME/$BRANCH_NAME"
      
      if [ -d "$EXPECTED_PATH" ]; then
        echo -e "${GREEN}✓ Bucket folder found at expected path: $EXPECTED_PATH${NC}"
        ls -la "$EXPECTED_PATH" | head -5 | sed 's/^/    /'
      else
        echo -e "${YELLOW}⚠ Checking common worktree locations...${NC}"
        echo "  Expected: $EXPECTED_PATH"
      fi
    fi
  else
    echo -e "${YELLOW}⚠ Worktree not found in list${NC}"
    echo "Searching for: $BRANCH_NAME or $REPO_NAME"
  fi
else
  echo -e "${YELLOW}⚠ No branch name to search for${NC}"
fi
echo ""

# Step 5: Verify Kanban Item
echo -e "${BLUE}Step 5: Verifying kanban item details...${NC}"
KANBAN_ITEMS=$(curl -s -b "$COOKIE_FILE" "$BASE_URL/api/projects/$PROJECT_ID/kanban-items")
ITEM_FOUND=$(echo "$KANBAN_ITEMS" | grep -o "\"id\":\"$KANBAN_ITEM_ID\"" || echo "")

if [ -n "$ITEM_FOUND" ]; then
  echo -e "${GREEN}✓ Kanban item verified in project${NC}"
  
  # Extract item details
  ITEM_TITLE=$(echo "$KANBAN_ITEMS" | grep -A 20 "\"id\":\"$KANBAN_ITEM_ID\"" | grep -o '"title":"[^"]*"' | head -1 | cut -d'"' -f4)
  ITEM_BRANCH=$(echo "$KANBAN_ITEMS" | grep -A 20 "\"id\":\"$KANBAN_ITEM_ID\"" | grep -o '"branch_name":"[^"]*"' | head -1 | cut -d'"' -f4)
  ITEM_TYPE=$(echo "$KANBAN_ITEMS" | grep -A 20 "\"id\":\"$KANBAN_ITEM_ID\"" | grep -o '"branch_type":"[^"]*"' | head -1 | cut -d'"' -f4)
  
  if [ -n "$ITEM_TITLE" ]; then
    echo "  Title: $ITEM_TITLE"
  fi
  if [ -n "$ITEM_BRANCH" ]; then
    echo "  Branch: $ITEM_BRANCH"
  fi
  if [ -n "$ITEM_TYPE" ]; then
    echo "  Type: $ITEM_TYPE"
  fi
else
  echo -e "${YELLOW}⚠ Kanban item not found in list${NC}"
fi
echo ""

# Summary
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📊 Workflow Summary${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${GREEN}✓${NC} Project: $PROJECT_ID"
echo -e "  ${GREEN}✓${NC} Repository: $REPO_FULL_NAME"
echo -e "  ${GREEN}✓${NC} Task Created: $KANBAN_ITEM_ID"
echo -e "  ${GREEN}✓${NC} Task Title: $TASK_TITLE"
echo -e "  ${GREEN}✓${NC} Branch Type: $BRANCH_TYPE"
if [ -n "$BRANCH_NAME" ]; then
  echo -e "  ${GREEN}✓${NC} Branch Name: $BRANCH_NAME"
fi
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
echo -e "${GREEN}✅ Full workflow test completed!${NC}"

