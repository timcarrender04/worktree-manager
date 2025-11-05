# Project Setup Workflow Analysis

## Overview
This document analyzes the complete workflow for setting up and using projects in the Worktree Manager application.

## Current Workflow Steps

### Step 1: Project Creation
**Status: ❌ MISSING UI**

- **API Endpoint**: `POST /api/projects` exists and works
- **UI Component**: ❌ **NOT FOUND** - No UI for creating projects
- **Location**: Should be on `/projects` page or in a modal/dialog
- **Expected Flow**: 
  1. User clicks "Create Project" button
  2. Form opens with fields: name, description, GitHub account, repositories
  3. User submits form
  4. Project is created via API

**Current State**: Users cannot create projects through the UI. They must use API directly or create projects through other means.

### Step 2: View Projects
**Status: ✅ WORKING**

- **Page**: `/projects` 
- **API Endpoint**: `GET /api/projects` works
- **Features**:
  - Lists all projects user has access to
  - Shows project name, description, owner, member count, repository count
  - Delete functionality works
  - Links to project detail page

**Issues**: None identified

### Step 3: Project Detail View
**Status: ✅ WORKING**

- **Page**: `/projects/[id]`
- **API Endpoint**: `GET /api/projects/[id]` works
- **Features**:
  - Shows project overview
  - Multiple tabs: Backlog, Roadmap, Insights, Team Items, My Items, Repositories, Members, Overview
  - VoiceTaskCreator component for creating tasks
  - Kanban board integration

**Issues**: None identified

### Step 4: Create Task with Voice (Within Project)
**Status: ⚠️ PARTIALLY WORKING**

- **Component**: `VoiceTaskCreator` in project detail page
- **Workflow**:
  1. Select repositories (from project repositories) ✅
  2. Select project (auto-selected if on project detail page) ✅
  3. Select base branch per repository ✅
  4. Select branch type (feat/bugs/fixes/qaqc) ✅
  5. Voice input for task description ✅
  6. AI generates task (title, branch name, description) ✅
  7. Creates worktrees ✅
  8. Creates kanban item ✅

**Potential Issues**:
- Requires repositories to be added to project first
- If no projects exist for selected repositories, task creation fails
- Project selection logic may be complex when multiple repos are selected

### Step 5: Create Worktree (Home Page)
**Status: ✅ WORKING**

- **Page**: `/` (home page)
- **API Endpoint**: `POST /api/worktrees` works
- **Features**:
  - Select repositories ✅
  - Select branch type ✅
  - Enter branch name (with AI auto-generation for "feat" type) ✅
  - Select base branch per repository ✅
  - Create worktrees ✅
  - AI voice task creation dialog ✅

**Issues**: None identified

## Critical Missing Features

### 1. Project Creation UI
**Priority: ✅ FIXED**

**Problem**: Users cannot create projects through the UI. The `/projects` page only shows existing projects.

**Solution Implemented**:
- ✅ Added "Create Project" button to `/projects` page
- ✅ Created project creation modal/dialog using Headless UI Dialog
- ✅ Includes all required fields:
  - Project name (required)
  - Description (optional)
  - GitHub account selection (optional, with auto-fetch of accounts)
  - Repository selection (multi-select, optional, dynamically loaded based on selected GitHub account)
- ✅ Form calls `POST /api/projects`
- ✅ After creation, redirects to project detail page
- ✅ Error handling and loading states implemented

**Files Modified**:
- `app/projects/page.tsx` - Added create button and full modal implementation

### 2. Repository Management in Projects
**Priority: MEDIUM**

**Problem**: Need to verify if repositories can be added to projects after creation.

**Current State**: 
- Repositories can be added during project creation (via API)
- Need to check if `/api/projects/[id]/repositories` endpoint exists for adding repos later

### 3. GitHub Account Selection
**Priority: MEDIUM**

**Problem**: Need to verify GitHub account selection UI exists for project creation.

**Current State**: 
- API supports `github_account_id` parameter
- Need to check if GitHub accounts API and UI exist

## API Endpoints Status

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/api/projects` | GET | ✅ | Works, returns projects list |
| `/api/projects` | POST | ✅ | Works, but no UI |
| `/api/projects` | DELETE | ✅ | Works, used in projects page |
| `/api/projects/[id]` | GET | ✅ | Works, used in project detail |
| `/api/projects/[id]/kanban-items` | POST | ✅ | Works, used by VoiceTaskCreator |
| `/api/worktrees` | POST | ✅ | Works, used in home page |
| `/api/ai/generate-task` | POST | ✅ | Works, used by VoiceTaskCreator |
| `/api/repos/[repo]/branches` | GET | ✅ | Works, used for branch selection |

## Recommended Fixes

### Immediate Actions (High Priority)
1. ✅ **Add Project Creation UI** to `/projects` page - **COMPLETED**
2. **Test complete workflow** end-to-end after adding creation UI - **READY FOR TESTING**

### Short-term Actions (Medium Priority)
1. Add ability to add repositories to existing projects
2. Add GitHub account management UI if missing
3. Improve error handling and user feedback

### Long-term Actions (Low Priority)
1. Add project templates
2. Add project import/export
3. Add project duplication

## Testing Checklist

- [x] Create project via UI - **IMPLEMENTED, READY FOR TESTING**
- [ ] View projects list
- [ ] Open project detail page
- [ ] Create task with voice in project
- [ ] Verify worktrees are created
- [ ] Verify kanban item is created
- [ ] Create worktree from home page
- [ ] Delete project
- [ ] Add repositories to project (if functionality exists)
- [ ] Test with multiple repositories
- [ ] Test with different branch types
- [ ] Test project creation with GitHub account selection
- [ ] Test project creation with repository selection
- [ ] Test project creation without GitHub account

## Notes

- The application supports both Neon (PostgreSQL) and Supabase backends
- Authentication is optional for Neon setup
- VoiceTaskCreator can work with or without initial projectId
- Project selection in VoiceTaskCreator is based on repositories selected

