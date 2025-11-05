<!-- 3f3ae195-4d62-44ef-810f-16e652bac09f c11809f4-3be6-471f-aec9-0628f40b5d1b -->
# Comprehensive Project Management Suite Implementation

## Overview

Transform the application into a full-featured project management tool similar to GitHub Projects, with a modern Kanban board using @dnd-kit, beautiful UI with shadcn/ui components, and complete task management capabilities.

## Tech Stack Additions

- **@dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities**: Modern drag-and-drop for Kanban
- **shadcn/ui**: High-quality React components (dialogs, forms, dropdowns, etc.)
- **@radix-ui/react-dialog, @radix-ui/react-dropdown-menu**: Base components for shadcn
- **date-fns**: Date utilities for Roadmap view
- **recharts**: Charts for Insights/Analytics

## Implementation Plan

### Phase 1: Setup & Dependencies

1. Install required packages:

- `@dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
- `shadcn/ui` components via CLI
- `date-fns` for date handling
- `recharts` for analytics charts
- `clsx tailwind-merge` for className utilities

2. Initialize shadcn/ui:

- Run `npx shadcn@latest init` to setup
- Install components: button, dialog, input, textarea, dropdown-menu, select, badge, card, popover

3. Create component structure:

- `components/ui/` - shadcn components
- `components/projects/` - project-specific components
- `components/kanban/` - Kanban board components
- `components/roadmap/` - Roadmap components
- `components/insights/` - Analytics components

### Phase 2: Enhanced Kanban Board with @dnd-kit

1. Replace custom KanbanBoard with @dnd-kit implementation:

- File: `components/kanban/KanbanBoard.tsx`
- Use `DndContext`, `SortableContext`, `useSortable`
- Implement drag-and-drop between columns
- Add visual feedback during drag operations

2. Create Kanban components:

- `components/kanban/KanbanColumn.tsx` - Sortable column container
- `components/kanban/KanbanCard.tsx` - Sortable task card
- `components/kanban/KanbanCardDetails.tsx` - Expanded card view

3. Add column management:

- Create/edit/delete columns
- Reorder columns via drag-and-drop
- Store column config in database (`kanban_boards.columns` JSONB field)

### Phase 3: Task CRUD Operations

1. Update API endpoints:

- **Update `app/api/projects/[id]/kanban-items/[itemId]/route.ts`**:
- Add PATCH handler for updating title, body, branch_name, repositories
- Support partial updates
- **Enhance DELETE endpoint** (already exists):
- Verify it properly handles worktree cleanup

2. Create task editing UI:

- `components/kanban/TaskEditor.tsx` - Modal/dialog for editing tasks
- Editable title (input)
- Editable body (textarea with markdown support)
- Edit repositories (multi-select)
- Edit branch name
- Save/Cancel buttons
- Inline editing on card click
- Quick edit via dropdown menu on card

3. Add task actions:

- Right-click context menu: Edit, Delete, Duplicate
- Keyboard shortcuts (E for edit, Delete for delete)
- Bulk operations (select multiple cards)

### Phase 4: Project Views & Navigation

1. Create project layout with tabs:

- File: `app/projects/[id]/layout.tsx` or update `page.tsx`
- Tabs: Backlog (Kanban), Roadmap, Insights, Team Items, My Items
- GitHub Projects-style navigation

2. Implement Roadmap view:

- File: `app/projects/[id]/roadmap/page.tsx`
- Timeline view of tasks grouped by date
- Gantt-style visualization
- Filter by date range, repositories, branch types

3. Implement Insights view:

- File: `app/projects/[id]/insights/page.tsx`
- Charts: tasks by status, velocity, completion rate
- Repository breakdown
- Branch type distribution
- Time-based analytics

4. Add Filters & Search:

- Global filter bar component
- Filter by: repository, branch type, assignee, date range
- Search by title, body text
- Saved filter presets

### Phase 5: UI Polish & GitHub Projects Aesthetic

1. Update styling to match GitHub Projects:

- Dark mode support (GitHub-style)
- Card hover effects
- Smooth transitions
- Column headers with item counts
- Estimate/burndown indicators

2. Add shadcn/ui components throughout:

- Replace Headless UI dropdowns with shadcn
- Use shadcn Dialog for modals
- shadcn Select for dropdowns
- shadcn Badge for labels/tags

3. Create hero components:

- Project header with title, description, actions
- Stats cards (total tasks, completion rate, etc.)
- Quick actions toolbar

### Phase 6: Database Enhancements

1. Add migration for column configuration:

- `lib/supabase/migrations/004_kanban_columns.sql`
- Add `columns` JSONB field to `kanban_boards`
- Store column order, titles, colors, limits

2. Add indexes for performance:

- Index on `kanban_items.column_id`
- Index on `kanban_items.status`
- Composite index for common queries

### Phase 7: Multi-Instance Support

1. Ensure database compatibility:

- All worktree managers use same Neon connection
- No local state conflicts
- Real-time updates (optional: WebSocket/SSE)

2. Add connection pooling:

- Verify Neon connection string works for multiple instances
- Test concurrent access

## File Changes Summary

### New Files

- `components/ui/` - shadcn components (auto-generated)
- `components/kanban/KanbanBoard.tsx` - New @dnd-kit implementation
- `components/kanban/KanbanColumn.tsx`
- `components/kanban/KanbanCard.tsx`
- `components/kanban/TaskEditor.tsx`
- `components/projects/ProjectHeader.tsx`
- `components/projects/FilterBar.tsx`
- `app/projects/[id]/roadmap/page.tsx`
- `app/projects/[id]/insights/page.tsx`
- `lib/supabase/migrations/004_kanban_columns.sql`

### Modified Files

- `app/api/projects/[id]/kanban-items/[itemId]/route.ts` - Add PATCH for title/body updates
- `app/projects/[id]/page.tsx` - Add tab navigation, integrate new Kanban
- `components/KanbanBoard.tsx` - Replace with new implementation
- `package.json` - Add dependencies
- `tailwind.config.ts` - Add shadcn theme config

## Key Features

- Full CRUD: Create, Read, Update (title, body, metadata), Delete tasks
- Drag-and-drop Kanban with @dnd-kit
- Multiple views: Kanban, Roadmap, Insights
- GitHub Projects-style UI with shadcn/ui
- Filters and search
- Multi-instance database support (Neon)

### To-dos

- [ ] Install @dnd-kit packages, shadcn/ui, date-fns, recharts and initialize shadcn
- [ ] Create new Kanban board with @dnd-kit: KanbanBoard, KanbanColumn, KanbanCard components
- [ ] Update API endpoint to support PATCH for title, body, branch_name, repositories updates
- [ ] Build TaskEditor component with dialog for editing task title, body, and metadata
- [ ] Create tab navigation and implement Roadmap and Insights views
- [ ] Implement filter bar and search functionality across all views
- [ ] Add migration for kanban_boards.columns JSONB field to store column configuration
- [ ] Apply GitHub Projects styling, add dark mode, polish interactions and animations