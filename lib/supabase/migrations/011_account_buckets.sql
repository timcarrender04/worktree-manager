-- Migration: Account Buckets
-- Description: Add bucket management for GitHub accounts to organize worktrees
-- Date: 2024

-- Add bucket_name column to github_accounts table
ALTER TABLE github_accounts 
ADD COLUMN IF NOT EXISTS bucket_name VARCHAR(255);

-- Create account_buckets table for tracking bucket metadata
CREATE TABLE IF NOT EXISTS account_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_account_id UUID NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE,
  bucket_name TEXT NOT NULL UNIQUE,
  bucket_type VARCHAR(20) NOT NULL CHECK (bucket_type IN ('s3', 'supabase')),
  region VARCHAR(50),
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(github_account_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_account_buckets_github_account_id ON account_buckets(github_account_id);
CREATE INDEX IF NOT EXISTS idx_account_buckets_bucket_name ON account_buckets(bucket_name);
CREATE INDEX IF NOT EXISTS idx_github_accounts_bucket_name ON github_accounts(bucket_name);

-- Row Level Security (RLS) Policies

-- Enable RLS on account_buckets table
ALTER TABLE account_buckets ENABLE ROW LEVEL SECURITY;

-- Users can view buckets for their own accounts
CREATE POLICY "Users can view buckets for their own accounts"
  ON account_buckets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM github_accounts
      WHERE github_accounts.id = account_buckets.github_account_id
      AND github_accounts.user_id = auth.uid()
    )
  );

-- Users can insert buckets for their own accounts
CREATE POLICY "Users can insert buckets for their own accounts"
  ON account_buckets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM github_accounts
      WHERE github_accounts.id = account_buckets.github_account_id
      AND github_accounts.user_id = auth.uid()
    )
  );

-- Users can update buckets for their own accounts
CREATE POLICY "Users can update buckets for their own accounts"
  ON account_buckets FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM github_accounts
      WHERE github_accounts.id = account_buckets.github_account_id
      AND github_accounts.user_id = auth.uid()
    )
  );

-- Users can delete buckets for their own accounts
CREATE POLICY "Users can delete buckets for their own accounts"
  ON account_buckets FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM github_accounts
      WHERE github_accounts.id = account_buckets.github_account_id
      AND github_accounts.user_id = auth.uid()
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_account_buckets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for updated_at
CREATE TRIGGER update_account_buckets_updated_at 
  BEFORE UPDATE ON account_buckets
  FOR EACH ROW 
  EXECUTE FUNCTION update_account_buckets_updated_at();



