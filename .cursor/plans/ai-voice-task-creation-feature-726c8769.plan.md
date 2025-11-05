<!-- 726c8769-abe1-4e92-b9d3-1db6ab785fa8 5ff104d9-bd4d-4146-82fd-f3ff0d986588 -->
# AI Voice Task Creation Feature

## Overview

Add a new workflow that integrates AI-powered voice-to-text task creation with worktree management and kanban board integration. The feature will allow users to select a project, repositories, branches, and use voice input to generate task titles, descriptions, and branch names via AI.

## Architecture

### Database Schema

- No new tables needed - uses existing `projects`, `kanban_boards`, `kanban_items` tables
- Kanban items will be created with:
- `title`: AI-generated from voice input
- `body`: AI-generated description
- `branch_name`: AI-generated short branch name
- `repository`: Selected repository full name
- `column_id`: 'backlog' (default)
- `status`: 'backlog' (default)
- `board_id`: Project's kanban board ID

### Flow

1. User selects: GitHub Account → Repositories (multiple) → Base Branch (per repo) → Branch Type (feat/bugs/qaqc)
2. Voice input → Speech-to-text conversion
3. AI processing → Generate title, branch name, and description
4. Create worktrees for all selected repos with generated branch name
5. Create kanban item in project's kanban board
6. Auto-update kanban item when PR is merged to dev branch (via webhook)

## Implementation Steps

### 1. UI Components (`app/page.tsx`)

**Project Creation/Selection Section:**

- Toggle between "Create New Project" and "Select Existing Project"
- If creating: GitHub account dropdown → Repository multi-select → Project name input → Create button
- If selecting: Project dropdown → Show project repositories

**Task Creation Section (after project is selected/created):**

- Repository multi-select (from project)
- Branch Type selector (feat/bugs/qaqc)
- Base Branch selector (per repository)
- Voice input component with microphone button
- AI-generated task preview (title, branch name, description)
- Submit button to create worktrees and kanban item

### 2. Voice-to-Text API (`app/api/ai/voice-to-text/route.ts`)

- Use Web Speech API on client side OR
- Create server endpoint using browser's SpeechRecognition API
- Handle microphone permissions
- Return transcribed text

### 3. AI Task Generation API (`app/api/ai/generate-task/route.ts`)

- Install Langchain dependencies (`langchain`, `@langchain/openai` or similar)
- Create Langchain agent/prompt that acts as project manager
- Input: voice transcript, branch type (feat/bugs/qaqc)
- Output: 
- `title`: Short, descriptive task title
- `branchName`: Short branch name (kebab-case, max 50 chars)
- `description`: Full task description for kanban body

### 4. Enhanced Worktree API (`app/api/worktrees/route.ts`)

- Modify POST endpoint to accept:
- `projectId`: UUID
- `repositories`: Array of { repo, baseBranch }
- `branchName`: AI-generated branch name
- `branchType`: feat/bugs/qaqc
- Create worktrees for all repositories
- Return success/error status per repo

### 5. Kanban Item Creation API (`app/api/projects/[id]/kanban-items/route.ts`)

- Create new endpoint to insert kanban items
- Fetch project's kanban board (auto-created per project)
- Insert kanban item with:
- Generated title and description
- Branch name
- Repository full name
- Default status: 'backlog'
- Return created item

### 6. Integration Endpoint (`app/api/tasks/create-with-ai/route.ts`)

- Orchestrates the full flow:

1. Generate task from voice input
2. Create worktrees for all repos
3. Create kanban item
4. Return combined result

### 7. Dependencies

- Add to `package.json`:
- `langchain` - AI agent framework
- `@langchain/openai` or `@langchain/anthropic` - LLM provider
- Browser Speech API (client-side, no package needed)

### 8. Environment Variables

- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` - For AI generation
- `DATABASE_URL` - Already configured (Neon Postgres)

### 9. Future: PR Webhook Integration

- GitHub webhook handler to detect PR merges to dev branch
- Update kanban item status to 'finished' when PR merged
- This will be separate implementation later

## Files to Create/Modify

**New Files:**

- `app/api/ai/voice-to-text/route.ts` - Voice transcription
- `app/api/ai/generate-task/route.ts` - AI task generation
- `app/api/projects/[id]/kanban-items/route.ts` - Kanban item CRUD
- `app/api/tasks/create-with-ai/route.ts` - Orchestration endpoint
- `components/VoiceInput.tsx` - Voice input UI component
- `lib/ai/task-generator.ts` - Langchain agent setup

**Modified Files:**

- `app/page.tsx` - Add new UI flow with project selection
- `app/api/worktrees/route.ts` - Enhance to support project-based workflow
- `package.json` - Add Langchain dependencies

## Key Implementation Details

1. **Branch Name Generation**: AI should create short, kebab-case names (e.g., "feat-login-button", "fix-auth-error")
2. **Multi-Repo Support**: All selected repos get worktrees with same branch name
3. **Kanban Integration**: One kanban item per task (not per repo), but references all repos
4. **Error Handling**: Graceful degradation if AI fails, allow manual override
5. **Voice Input**: Use browser SpeechRecognition API, fallback to text input

## Testing Considerations

- Test voice input with various accents/languages
- Test AI generation with different branch types
- Test multi-repo worktree creation
- Test kanban item creation and retrieval
- Test error scenarios (AI failure, worktree creation failure)