-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- GitHub Accounts table
CREATE TABLE github_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_name VARCHAR(255) NOT NULL,
  encrypted_token TEXT NOT NULL,
  github_username VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, account_name)
);

-- Projects table
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  github_account_id UUID REFERENCES github_accounts(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Project Members table (access control)
CREATE TABLE project_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Project Repositories table (many-to-many)
CREATE TABLE project_repositories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repository_full_name VARCHAR(255) NOT NULL, -- e.g., "owner/repo"
  github_account_id UUID NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(project_id, repository_full_name)
);

-- Kanban Boards table
CREATE TABLE kanban_boards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  backlog_column_id VARCHAR(50) NOT NULL DEFAULT 'backlog',
  active_column_id VARCHAR(50) NOT NULL DEFAULT 'active',
  finished_column_id VARCHAR(50) NOT NULL DEFAULT 'finished',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Kanban Items table
CREATE TABLE kanban_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  board_id UUID NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  github_issue_id BIGINT,
  github_pr_id BIGINT,
  branch_name VARCHAR(255),
  repository VARCHAR(255) NOT NULL,
  column_id VARCHAR(50) NOT NULL DEFAULT 'backlog',
  status VARCHAR(50) NOT NULL DEFAULT 'backlog',
  title TEXT NOT NULL,
  body TEXT,
  labels JSONB DEFAULT '[]'::jsonb,
  assignees JSONB DEFAULT '[]'::jsonb,
  github_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(board_id, github_issue_id, repository)
);

-- GitHub Webhooks table
CREATE TABLE github_webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  repository_full_name VARCHAR(255) NOT NULL,
  webhook_id BIGINT NOT NULL,
  github_account_id UUID NOT NULL REFERENCES github_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  webhook_url TEXT NOT NULL,
  secret TEXT,
  events JSONB DEFAULT '["pull_request", "issues", "delete"]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(repository_full_name, github_account_id)
);

-- Indexes for performance
CREATE INDEX idx_github_accounts_user_id ON github_accounts(user_id);
CREATE INDEX idx_projects_owner_id ON projects(owner_id);
CREATE INDEX idx_project_members_project_id ON project_members(project_id);
CREATE INDEX idx_project_members_user_id ON project_members(user_id);
CREATE INDEX idx_project_repositories_project_id ON project_repositories(project_id);
CREATE INDEX idx_kanban_items_board_id ON kanban_items(board_id);
CREATE INDEX idx_kanban_items_column_id ON kanban_items(column_id);
CREATE INDEX idx_kanban_items_github_issue_id ON kanban_items(github_issue_id);
CREATE INDEX idx_kanban_items_github_pr_id ON kanban_items(github_pr_id);
CREATE INDEX idx_kanban_items_branch_name ON kanban_items(branch_name);
CREATE INDEX idx_github_webhooks_repository ON github_webhooks(repository_full_name);

-- Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE github_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE kanban_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_webhooks ENABLE ROW LEVEL SECURITY;

-- GitHub Accounts Policies
-- Users can only see their own GitHub accounts
CREATE POLICY "Users can view their own GitHub accounts"
  ON github_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own GitHub accounts"
  ON github_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own GitHub accounts"
  ON github_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own GitHub accounts"
  ON github_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- Projects Policies
-- Users can see projects they own or are members of
CREATE POLICY "Users can view projects they own or are members of"
  ON projects FOR SELECT
  USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM project_members
      WHERE project_members.project_id = projects.id
      AND project_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create projects"
  ON projects FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update projects they own"
  ON projects FOR UPDATE
  USING (owner_id = auth.uid());

CREATE POLICY "Users can delete projects they own"
  ON projects FOR DELETE
  USING (owner_id = auth.uid());

-- Project Members Policies
-- Users can see members of projects they have access to
CREATE POLICY "Users can view members of accessible projects"
  ON project_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND (
        projects.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = projects.id
          AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- Only owners can add/update/delete members
CREATE POLICY "Owners can manage project members"
  ON project_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_members.project_id
      AND projects.owner_id = auth.uid()
    )
  );

-- Project Repositories Policies
-- Users can see repositories of projects they have access to
CREATE POLICY "Users can view repositories of accessible projects"
  ON project_repositories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_repositories.project_id
      AND (
        projects.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members
          WHERE project_members.project_id = projects.id
          AND project_members.user_id = auth.uid()
        )
      )
    )
  );

-- Only owners and editors can manage repositories
CREATE POLICY "Owners and editors can manage project repositories"
  ON project_repositories FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = auth.uid()
      WHERE p.id = project_repositories.project_id
      AND (p.owner_id = auth.uid() OR pm.role IN ('owner', 'editor'))
    )
  );

-- Kanban Boards Policies
-- Users can see boards of projects they have access to
CREATE POLICY "Users can view boards of accessible projects"
  ON kanban_boards FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = kanban_boards.project_id
      AND (
        projects.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members
          WHERE project_members.project_id = projects.id
          AND project_members.user_id = auth.uid()
        )
      )
    )
  );

-- Only owners and editors can update boards
CREATE POLICY "Owners and editors can update boards"
  ON kanban_boards FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = auth.uid()
      WHERE p.id = kanban_boards.project_id
      AND (p.owner_id = auth.uid() OR pm.role IN ('owner', 'editor'))
    )
  );

-- Kanban Items Policies
-- Users can see items of boards they have access to
CREATE POLICY "Users can view items of accessible boards"
  ON kanban_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM kanban_boards kb
      JOIN projects p ON p.id = kb.project_id
      WHERE kb.id = kanban_items.board_id
      AND (
        p.owner_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = p.id
          AND pm.user_id = auth.uid()
        )
      )
    )
  );

-- Only owners and editors can insert/update items
CREATE POLICY "Owners and editors can manage kanban items"
  ON kanban_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM kanban_boards kb
      JOIN projects p ON p.id = kb.project_id
      LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = auth.uid()
      WHERE kb.id = kanban_items.board_id
      AND (p.owner_id = auth.uid() OR pm.role IN ('owner', 'editor'))
    )
  );

-- GitHub Webhooks Policies
-- Users can see webhooks of their own GitHub accounts
CREATE POLICY "Users can view their own webhooks"
  ON github_webhooks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own webhooks"
  ON github_webhooks FOR ALL
  USING (auth.uid() = user_id);

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
CREATE TRIGGER update_github_accounts_updated_at BEFORE UPDATE ON github_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kanban_boards_updated_at BEFORE UPDATE ON kanban_boards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kanban_items_updated_at BEFORE UPDATE ON kanban_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_github_webhooks_updated_at BEFORE UPDATE ON github_webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically create kanban board when project is created
CREATE OR REPLACE FUNCTION create_kanban_board_for_project()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO kanban_boards (project_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER create_kanban_board_on_project_insert
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION create_kanban_board_for_project();

-- Function to automatically add owner as project member
CREATE OR REPLACE FUNCTION add_owner_as_project_member()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO project_members (id, project_id, user_id, role)
  VALUES (gen_random_uuid(), NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (project_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER add_owner_as_member_on_project_insert
  AFTER INSERT ON projects
  FOR EACH ROW
  EXECUTE FUNCTION add_owner_as_project_member();

