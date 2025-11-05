-- Migration: Add columns JSONB field to kanban_boards for storing column configuration
-- This allows custom column order, titles, colors, and limits per board

-- Add columns field if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'kanban_boards' 
    AND column_name = 'columns'
  ) THEN
    ALTER TABLE kanban_boards ADD COLUMN columns JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- The columns field will store an array of column objects like:
-- [
--   {
--     "id": "backlog",
--     "title": "Backlog",
--     "description": "This item hasn't been started",
--     "color": "green",
--     "order": 0,
--     "limit": null
--   },
--   ...
-- ]

-- Create GIN index on columns for JSONB queries
CREATE INDEX IF NOT EXISTS idx_kanban_boards_columns ON kanban_boards USING GIN (columns);

