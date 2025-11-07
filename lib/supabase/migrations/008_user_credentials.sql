-- Migration: User Credentials Management
-- Description: Add tables for AWS credentials and user workspaces
-- Date: 2024

-- AWS Credentials table
CREATE TABLE user_aws_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profile_name VARCHAR(255) NOT NULL,
  access_key_id TEXT NOT NULL,
  secret_access_key TEXT NOT NULL,
  region VARCHAR(50) DEFAULT 'us-east-1',
  default_profile BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, profile_name)
);

-- User Workspaces table (DEV: no auth required)
CREATE TABLE user_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- DEV: TEXT instead of UUID with FK to auth.users
  workspace_path TEXT NOT NULL,
  default_github_account_id UUID REFERENCES github_accounts(id) ON DELETE SET NULL,
  default_aws_profile_id UUID REFERENCES user_aws_credentials(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Indexes for performance
CREATE INDEX idx_user_aws_credentials_user_id ON user_aws_credentials(user_id);
CREATE INDEX idx_user_aws_credentials_default ON user_aws_credentials(user_id, default_profile) WHERE default_profile = true;
CREATE INDEX idx_user_workspaces_user_id ON user_workspaces(user_id);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE user_aws_credentials ENABLE ROW LEVEL SECURITY;
-- DEV: Disable RLS on user_workspaces for development (no auth required)
-- ALTER TABLE user_workspaces ENABLE ROW LEVEL SECURITY;

-- User AWS Credentials Policies
-- Users can only see their own AWS credentials
CREATE POLICY "Users can view their own AWS credentials"
  ON user_aws_credentials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own AWS credentials"
  ON user_aws_credentials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own AWS credentials"
  ON user_aws_credentials FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own AWS credentials"
  ON user_aws_credentials FOR DELETE
  USING (auth.uid() = user_id);

-- User Workspaces Policies
-- DEV: RLS disabled for development (no auth required)
-- Uncomment these policies when auth is enabled:
-- CREATE POLICY "Users can view their own workspace"
--   ON user_workspaces FOR SELECT
--   USING (auth.uid()::text = user_id);
--
-- CREATE POLICY "Users can insert their own workspace"
--   ON user_workspaces FOR INSERT
--   WITH CHECK (auth.uid()::text = user_id);
--
-- CREATE POLICY "Users can update their own workspace"
--   ON user_workspaces FOR UPDATE
--   USING (auth.uid()::text = user_id);
--
-- CREATE POLICY "Users can delete their own workspace"
--   ON user_workspaces FOR DELETE
--   USING (auth.uid()::text = user_id);

-- Functions and Triggers

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_user_aws_credentials_updated_at BEFORE UPDATE ON user_aws_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_workspaces_updated_at BEFORE UPDATE ON user_workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to ensure only one default AWS profile per user
CREATE OR REPLACE FUNCTION ensure_single_default_aws_profile()
RETURNS TRIGGER AS $$
BEGIN
  -- If setting a profile as default, unset all other defaults for this user
  IF NEW.default_profile = true THEN
    UPDATE user_aws_credentials
    SET default_profile = false
    WHERE user_id = NEW.user_id
      AND id != NEW.id
      AND default_profile = true;
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER ensure_single_default_aws_profile_trigger
  BEFORE INSERT OR UPDATE ON user_aws_credentials
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_default_aws_profile();

-- Function to automatically create workspace when user is created (optional)
-- This can be called from application code or via a separate trigger if needed
CREATE OR REPLACE FUNCTION create_user_workspace()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_workspaces (user_id, workspace_path)
  VALUES (NEW.id, '/home/repo-user/worktrees/' || NEW.id::text)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Note: Uncomment the following if you want automatic workspace creation on user signup
-- CREATE TRIGGER create_workspace_on_user_insert
--   AFTER INSERT ON auth.users
--   FOR EACH ROW
--   EXECUTE FUNCTION create_user_workspace();

