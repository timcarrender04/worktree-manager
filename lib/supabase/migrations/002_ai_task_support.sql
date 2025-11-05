-- Migration: Add AI task creation support columns to kanban_items
-- This migration adds columns needed for AI voice task creation feature

-- Add branch_type column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'kanban_items' 
    AND column_name = 'branch_type'
  ) THEN
    ALTER TABLE kanban_items ADD COLUMN branch_type VARCHAR(50);
  END IF;
END $$;

-- Add repositories column (JSONB array) if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'kanban_items' 
    AND column_name = 'repositories'
  ) THEN
    ALTER TABLE kanban_items ADD COLUMN repositories JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Add branch_status column (JSONB) for tracking branch creation status if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'kanban_items' 
    AND column_name = 'branch_status'
  ) THEN
    ALTER TABLE kanban_items ADD COLUMN branch_status JSONB DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- Create index on branch_type for better query performance
CREATE INDEX IF NOT EXISTS idx_kanban_items_branch_type ON kanban_items(branch_type);

-- Create GIN index on repositories for JSONB queries
CREATE INDEX IF NOT EXISTS idx_kanban_items_repositories ON kanban_items USING GIN (repositories);

-- Create GIN index on branch_status for JSONB queries
CREATE INDEX IF NOT EXISTS idx_kanban_items_branch_status ON kanban_items USING GIN (branch_status);

