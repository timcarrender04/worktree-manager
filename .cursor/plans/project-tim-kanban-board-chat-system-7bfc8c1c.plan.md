<!-- 7bfc8c1c-f68f-4c0d-85ed-ff581814dced 75a53e8f-52d8-4244-a198-9ff03629214b -->
# Project Tim Kanban Board & Chat System Implementation

## Overview

Transform Project Tim from a project management interface into a public-facing Kanban board viewer with real-time chat, multi-project viewing for super admin, and GitHub webhook integration for automatic task status updates.

## Database Changes

### 1. Migration to Neon PostgreSQL

- Replace Supabase client with direct PostgreSQL connection (`pg` or `postgres` package)
- Create `lib/db/client.ts` for Neon database connection using provided connection string
- Update all API routes to use PostgreSQL client instead of Supabase client
- Remove RLS policies (handle authorization in application code)

### 2. Schema Updates

**File**: `lib/supabase/migrations/003_kanban_chat_updates.sql`

- Update `kanban_boards` table: Change column defaults from `(backlog, active, finished)` to `(backlog, ready, in_progress, review, done)`
- Update `kanban_items` table: Ensure `column_id` and `status` support new values: `backlog`, `ready`, `in_progress`, `review`, `done`
- Create `project_chat_messages` table:
- `id` UUID PRIMARY KEY
- `project_id` UUID REFERENCES projects(id) ON DELETE CASCADE
- `user_id` UUID REFERENCES auth.users(id) ON DELETE SET NULL
- `message` TEXT NOT NULL
- `created_at` TIMESTAMP WITH TIME ZONE DEFAULT NOW()
- Index on `project_id` and `created_at`

**File**: `lib/supabase/migrations/004_super_admin.sql`

- Create `user_roles` table or add `is_super_admin` BOOLEAN to users/auth system
- Add super admin check functions/helpers

## API Routes

### 3. Database Client Library

**File**: `lib/db/client.ts`

- Create PostgreSQL connection pool using Neon connection string
- Export `query()` function for parameterized queries
- Handle connection pooling and error handling

### 4. Kanban Board API

**File**: `app/api/projects/[id]/board/route.ts`

- `GET`: Fetch kanban board with items grouped by column
- `PATCH`: Update kanban item column/status (with permission checks)

### 5. Chat API

**File**: `app/api/projects/[id]/chat/route.ts`

- `GET`: Fetch chat messages for project (paginated)
- `POST`: Create new chat message (authenticated users only)

### 6. GitHub Webhook Handler

**File**: `app/api/webhooks/github/route.ts`

- `POST`: Receive GitHub webhook events
- Handle `pull_request` merged event: Find kanban item by branch_name and move to `review`
- Handle `delete` branch event: Find kanban item by branch_name and move to `done`
- Verify webhook signature for security
- Update kanban item status in database

### 7. Projects API Updates

**File**: `app/api/projects/route.ts`

- Update `GET` to filter projects by user permissions
- Add super admin check: if user is super admin, return all projects
- Add multi-select support query parameter

## Frontend Components

### 8. Database Connection Updates

**Files**: All files in `app/api/**/*.ts`

- Replace `createClient()` from Supabase with `query()` from `lib/db/client.ts`
- Update authentication to use direct auth check (not Supabase Auth)
- Handle authorization in application layer (check user_id, project membership, super admin status)

### 9. Main Layout with Project Selection

**File**: `app/page.tsx` or new `app/dashboard/page.tsx`

- List all accessible projects (filtered by permissions)
- Super admin sees all projects with multi-select checkbox
- Selected projects appear as tabs in a tabbed viewer
- Default: Show single project if user has access, or first project for super admin

### 10. Multi-Project Tabbed Viewer

**File**: `app/components/MultiProjectViewer.tsx`

- Tabbed interface component for viewing multiple projects simultaneously
- Each tab shows a Kanban board for that project
- Tabs are closable/switchable
- Only visible to super admin users

### 11. Kanban Board Component

**File**: `app/components/KanbanBoard.tsx`

- Display columns: Backlog, Ready, In Progress, Review, Done
- Render kanban items as cards in appropriate columns
- Drag-and-drop functionality (if user has edit permissions)
- Read-only mode for viewers (no drag-and-drop)
- Card displays: title, body (layman terms), repository, branch name

### 12. Project Detail Page Updates

**File**: `app/projects/[id]/page.tsx`

- Replace current tabs with Kanban board as main view
- Add Kanban board tab (make it default/primary view)
- Keep existing Repositories, Members, Settings tabs
- Add chat component at bottom of Kanban board

### 13. Chat Component

**File**: `app/components/ChatBox.tsx`

- Display chat messages for project (scrolled to bottom)
- Input field for new messages (all authenticated users can send)
- Real-time updates via polling (fetch every 2-3 seconds) or WebSocket if needed
- Show user info and timestamp for each message
- Styled to appear at bottom of Kanban board

### 14. Permission System

**Files**: `app/components/auth/AuthProvider.tsx`, permission helpers

- Update auth system to work without Supabase Auth (or keep Supabase Auth but use Neon for data)
- Add `isSuperAdmin()` helper function
- Add `canEditProject(projectId, userId)` helper
- Add `canViewProject(projectId, userId)` helper

## Configuration

### 15. Environment Variables

**File**: `.env.local` (or `.env.example`)

- `DATABASE_URL`: Neon PostgreSQL connection string (provided)
- `GITHUB_WEBHOOK_SECRET`: Secret for verifying GitHub webhooks
- `SUPER_ADMIN_USER_ID`: UUID of super admin user (or manage in database)

## Implementation Order

1. Database migration (003, 004) - Update schema
2. Database client (`lib/db/client.ts`) - Connection setup
3. Update all API routes to use PostgreSQL client
4. GitHub webhook handler
5. Kanban board API endpoints
6. Chat API endpoints
7. Frontend: Kanban board component
8. Frontend: Chat component
9. Frontend: Multi-project viewer (super admin)
10. Frontend: Main layout updates
11. Permission system updates
12. Testing and integration

## Email Invitation System

### 16. Email Service Setup

**File**: `lib/email/client.ts` (new)

- Configure SMTP/IMAP client using Gmail credentials
- Use `nodemailer` package for SMTP sending
- Support for Gmail OAuth2 or app-specific password
- Export `sendInvitationEmail()` function

### 17. Invitation API

**File**: `app/api/invitations/route.ts` (new)

- `POST`: Create invitation and send email
- Generate invitation token/code
- Store invitation in database with expiration
- Send email via Gmail SMTP
- Include signup link with token
- `GET`: List sent invitations (admin only)

### 18. Invitation Database Schema

**File**: `lib/supabase/migrations/005_invitations.sql` (new)

- Create `user_invitations` table:
- `id` UUID PRIMARY KEY
- `email` VARCHAR(255) NOT NULL
- `invitation_token` VARCHAR(255) UNIQUE NOT NULL
- `invited_by` UUID REFERENCES auth.users(id)
- `status` VARCHAR(20) DEFAULT 'pending' (pending, accepted, expired)
- `expires_at` TIMESTAMP WITH TIME ZONE
- `created_at` TIMESTAMP WITH TIME ZONE DEFAULT NOW()
- Index on `email` and `invitation_token`

### 19. Signup Page with Invitation

**File**: `app/signup/[token]/page.tsx` (new)

- Validate invitation token
- Show signup form pre-filled with email
- Create user account on successful signup
- Mark invitation as accepted
- Redirect to login or dashboard

### 20. Email Templates

**File**: `lib/email/templates.ts` (new)

- HTML email template for invitations
- Include project name(s) if pre-assigned
- Signup link with token
- Expiration notice

## Admin Panel for Project Assignment

### 21. Admin Panel Layout

**File**: `app/admin/page.tsx` (new)

- Super admin only access
- List all users with their assigned projects
- Search/filter users
- Add/remove project access for users
- View invitation history

### 22. User Management API

**File**: `app/api/admin/users/route.ts` (new)

- `GET`: List all users with their project assignments
- `POST`: Create invitation and optionally pre-assign projects
- `PATCH`: Update user project assignments
- `DELETE`: Revoke user access to projects

### 23. Project Assignment API

**File**: `app/api/admin/users/[userId]/projects/route.ts` (new)

- `GET`: Get projects assigned to user
- `POST`: Assign project to user (add to `project_members` with 'viewer' role)
- `DELETE`: Remove project access from user

### 24. Invitation with Pre-Assigned Projects

**File**: `app/api/invitations/route.ts` (update)

- Allow super admin to specify projects when creating invitation
- Store project assignments in `user_invitations` or link to `project_members` on acceptance
- When user signs up, automatically add them to specified projects

### 25. Access Control Updates

**File**: `app/api/projects/route.ts` (update)

- `GET`: Filter projects based on explicit `project_members` assignments only
- Users only see projects where they exist in `project_members` table
- Super admin sees all projects (bypass filter)
- Remove automatic ownership-based access (only explicit assignments)

### 26. Database Schema Updates

**File**: `lib/supabase/migrations/005_invitations.sql` (update)

- Add `pre_assigned_projects` JSONB column to `user_invitations` table
- Store array of project IDs that should be assigned on signup
- Or create `invitation_project_assignments` junction table:
- `invitation_id` UUID REFERENCES user_invitations(id)
- `project_id` UUID REFERENCES projects(id)
- Automatically create `project_members` entries when invitation is accepted

## Updated Implementation Order

1. Database migration (003, 004, 005) - Update schema
2. Database client (`lib/db/client.ts`) - Connection setup
3. **Email service setup (`lib/email/client.ts`)**
4. **Invitation database schema (005)**
5. **Invitation API endpoints**
6. **Signup page with invitation validation**
7. **Admin panel for project assignment**
8. Update all API routes to use PostgreSQL client
9. Update access control to use explicit project assignments
10. GitHub webhook handler
11. Kanban board API endpoints
12. Chat API endpoints
13. Frontend: Admin panel
14. Frontend: Kanban board component
15. Frontend: Chat component
16. Frontend: Multi-project viewer (super admin)
17. Frontend: Main layout updates
18. Permission system updates
19. Testing and integration

## Key Files to Modify

- `lib/db/client.ts` (new)
- `lib/email/client.ts` (new)
- `lib/email/templates.ts` (new)
- `lib/supabase/migrations/003_kanban_chat_updates.sql` (new)
- `lib/supabase/migrations/004_super_admin.sql` (new)
- `lib/supabase/migrations/005_invitations.sql` (new)
- `app/api/invitations/route.ts` (new)
- `app/api/admin/users/route.ts` (new)
- `app/api/admin/users/[userId]/projects/route.ts` (new)
- `app/api/projects/[id]/board/route.ts` (new)
- `app/api/projects/[id]/chat/route.ts` (new)
- `app/api/webhooks/github/route.ts` (new)
- `app/admin/page.tsx` (new)
- `app/signup/[token]/page.tsx` (new)
- `app/components/KanbanBoard.tsx` (new)
- `app/components/ChatBox.tsx` (new)
- `app/components/MultiProjectViewer.tsx` (new)
- `app/projects/[id]/page.tsx` (update)
- `app/page.tsx` (update)
- `app/api/projects/route.ts` (update - access control)
- All files in `app/api/**/*.ts` (update database calls)

## Notes

- WorkTree Manager feeds tasks to projects via API (already exists)
- Project Tim is the central public-facing viewer for all WorkTree Manager instances
- Multiple WorkTree Manager instances point to same database, create tasks for different GitHub accounts
- Kanban columns: backlog → ready → in_progress → review → done
- Viewers can see and chat but cannot move cards
- Editors/owners can move cards between columns
- Super admin can view all projects and use multi-project tabs
- **Email invitations via Gmail SMTP/IMAP**
- **Users only see projects explicitly assigned via admin panel (need-to-know access)**
- **Super admin manages project assignments through admin panel**