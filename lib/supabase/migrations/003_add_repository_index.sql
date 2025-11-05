-- Migration: Add index on project_repositories.repository_full_name for better query performance
-- This index optimizes queries that filter projects by repository name

-- Create index on repository_full_name if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_project_repositories_repository_full_name 
ON project_repositories(repository_full_name);

-- This index will significantly improve the performance of queries like:
-- SELECT * FROM projects WHERE EXISTS (
--   SELECT 1 FROM project_repositories 
--   WHERE project_repositories.project_id = projects.id 
--   AND project_repositories.repository_full_name = 'owner/repo'
-- )

