# Database Migration Instructions

## Run Migration 002: AI Task Support

To enable the AI voice task creation feature, you need to run the database migration that adds the required columns.

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of `lib/supabase/migrations/002_ai_task_support.sql`
4. Paste and run the migration
5. Verify the columns were added by checking the `kanban_items` table

### Option 2: Using psql (Direct Database Connection)

```bash
# If using Neon PostgreSQL
psql $DATABASE_URL -f lib/supabase/migrations/002_ai_task_support.sql

# Or manually connect
psql -h your-db-host -U postgres -d your-database -f lib/supabase/migrations/002_ai_task_support.sql
```

### Option 3: Using Supabase CLI

```bash
# Install Supabase CLI if not already installed
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Run migrations
supabase db push
```

## What the Migration Adds

The migration adds three columns to the `kanban_items` table:

1. **`branch_type`** (VARCHAR(50)) - Stores the branch type (feat, bugs, qaqc)
2. **`repositories`** (JSONB) - Array of repository full names for multi-repo tasks
3. **`branch_status`** (JSONB) - Tracks branch creation status per repository

## Verification

After running the migration, verify it worked:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'kanban_items' 
AND column_name IN ('branch_type', 'repositories', 'branch_status');
```

You should see all three columns listed.

## Next Steps

1. Set `OPENAI_API_KEY` environment variable (optional - for AI task generation)
2. Restart your Next.js application
3. Test the voice task creation feature in the UI

