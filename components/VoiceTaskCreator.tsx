'use client';

import { useState, useEffect } from 'react';
import { VoiceInput } from './VoiceInput';

interface Repository {
  id: string;
  repository_full_name: string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
}

interface VoiceTaskCreatorProps {
  projectId?: string; // Make optional - can be selected from repository
  repositories: Repository[];
  onTaskCreated: () => void;
}

export function VoiceTaskCreator({ projectId: initialProjectId, repositories, onTaskCreated }: VoiceTaskCreatorProps) {
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState<'feat' | 'bugs' | 'fixes' | 'qaqc' | ''>('');
  const [baseBranches, setBaseBranches] = useState<Record<string, string>>({});
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [aiGenerated, setAiGenerated] = useState<{
    title: string;
    branchName: string;
    description: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<Record<string, string[]>>({});
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(initialProjectId || '');
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Load projects when repositories are selected
  useEffect(() => {
    const loadProjects = async () => {
      if (selectedRepos.length === 0) {
        setAvailableProjects([]);
        setSelectedProjectId(initialProjectId || '');
        return;
      }

      setLoadingProjects(true);
      try {
        // Fetch projects for each selected repository
        // If multiple repos, find projects that contain at least one of them
        const projectSets: Set<string>[] = [];
        
        for (const repoFullName of selectedRepos) {
          const response = await fetch(`/api/projects?repository=${encodeURIComponent(repoFullName)}`);
          if (response.ok) {
            const data = await response.json();
            const projectIds = new Set((data.projects || []).map((p: Project) => p.id));
            projectSets.push(projectIds);
          }
        }

        // Find projects that contain at least one of the selected repositories
        // For now, we'll use projects from the first repository, but ideally we'd find intersections
        const allProjectIds = new Set<string>();
        projectSets.forEach(set => {
          set.forEach(id => allProjectIds.add(id));
        });

        // Fetch full project details for unique project IDs
        if (allProjectIds.size > 0) {
          const projectIdsArray = Array.from(allProjectIds);
          const projectsResponse = await fetch('/api/projects');
          if (projectsResponse.ok) {
            const projectsData = await projectsResponse.json();
            const filteredProjects = (projectsData.projects || []).filter((p: Project) =>
              projectIdsArray.includes(p.id)
            );
            setAvailableProjects(filteredProjects);
            
            // Auto-select if only one project or if initialProjectId is provided
            if (initialProjectId && filteredProjects.some((p: Project) => p.id === initialProjectId)) {
              setSelectedProjectId(initialProjectId);
            } else if (filteredProjects.length === 1) {
              setSelectedProjectId(filteredProjects[0].id);
            } else if (filteredProjects.length > 0 && !selectedProjectId) {
              // If no initial project and multiple options, don't auto-select
              setSelectedProjectId('');
            }
          }
        } else {
          setAvailableProjects([]);
          setSelectedProjectId('');
        }
      } catch (err) {
        console.error('Failed to load projects:', err);
        setAvailableProjects([]);
      } finally {
        setLoadingProjects(false);
      }
    };

    loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepos]);

  // Load branches for selected repos
  useEffect(() => {
    const loadBranches = async () => {
      const newBranches: Record<string, string[]> = {};
      for (const repoFullName of selectedRepos) {
        try {
          // Extract repo name from full name (owner/repo -> repo)
          const repoName = repoFullName.split('/').pop() || repoFullName;
          // Convert to key format (sanitize)
          const repoKey = repoName.toLowerCase().replace(/[^a-z0-9]/g, '-');
          
          const response = await fetch(`/api/repos/${repoKey}/branches`);
          if (response.ok) {
            const data = await response.json();
            newBranches[repoFullName] = data.branches || [];
            if (!baseBranches[repoFullName] && data.branches && data.branches.length > 0) {
              // Default to 'dev' or first branch
              const defaultBranch = data.branches.find((b: string) => b === 'dev') || data.branches[0];
              setBaseBranches(prev => ({ ...prev, [repoFullName]: defaultBranch }));
            }
          }
        } catch (err) {
          console.error(`Failed to load branches for ${repoFullName}:`, err);
        }
      }
      setBranches(newBranches);
    };

    if (selectedRepos.length > 0) {
      loadBranches();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepos]);

  const handleTranscript = (text: string) => {
    setVoiceTranscript(text);
  };

  const generateTask = async () => {
    if (!voiceTranscript.trim() || !selectedType) {
      setError('Please provide voice input and select a branch type');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/ai/generate-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: voiceTranscript,
          branchType: selectedType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate task');
      }

      const data = await response.json();
      setAiGenerated(data);
    } catch (err: any) {
      setError(err.message || 'Failed to generate task');
    } finally {
      setLoading(false);
    }
  };

  const createTask = async () => {
    const effectiveProjectId = selectedProjectId || initialProjectId;
    
    if (!aiGenerated || selectedRepos.length === 0 || !selectedType) {
      setError('Please complete all required fields');
      return;
    }

    if (!effectiveProjectId) {
      setError('Please select a project');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create worktrees
      const reposWithBranches = selectedRepos.map(repo => ({
        repo,
        baseBranch: baseBranches[repo] || 'dev',
      }));

      // Extract repo names from full names for worktree API
      const repoNames = selectedRepos.map(repoFullName => {
        const repoName = repoFullName.split('/').pop() || repoFullName;
        // Convert to key format (sanitize)
        return repoName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      });

      // Create baseBranches map with repo keys
      const baseBranchesMap: Record<string, string> = {};
      selectedRepos.forEach((repoFullName, index) => {
        const repoKey = repoNames[index];
        baseBranchesMap[repoKey] = baseBranches[repoFullName] || 'dev';
      });

      const worktreeResponse = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repos: repoNames,
          type: selectedType,
          name: aiGenerated.branchName.replace(`${selectedType}-`, ''), // Remove prefix as worktree API adds it
          baseBranches: baseBranchesMap,
        }),
      });

      if (!worktreeResponse.ok) {
        const errorData = await worktreeResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create worktrees');
      }

      // Create kanban item
      const kanbanResponse = await fetch(`/api/projects/${effectiveProjectId}/kanban-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: aiGenerated.title,
          body: aiGenerated.description,
          branch_name: aiGenerated.branchName,
          repository: selectedRepos[0], // Primary repository
          repositories: selectedRepos,
          branch_type: selectedType,
          column_id: 'backlog',
        }),
      });

      if (!kanbanResponse.ok) {
        const errorData = await kanbanResponse.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create kanban item');
      }

      // Reset form
      setSelectedRepos([]);
      setSelectedType('');
      setVoiceTranscript('');
      setAiGenerated(null);
      setBaseBranches({});
      if (!initialProjectId) {
        setSelectedProjectId('');
        setAvailableProjects([]);
      }

      onTaskCreated();
    } catch (err: any) {
      setError(err.message || 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
      <h2 className="text-xl font-semibold text-gray-900">Create Task with Voice</h2>

      {/* Repository Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Repositories *
        </label>
        <div className="space-y-2">
          {repositories.map((repo) => (
            <label key={repo.id} className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={selectedRepos.includes(repo.repository_full_name)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedRepos([...selectedRepos, repo.repository_full_name]);
                  } else {
                    setSelectedRepos(selectedRepos.filter(r => r !== repo.repository_full_name));
                    setBaseBranches(prev => {
                      const newBranches = { ...prev };
                      delete newBranches[repo.repository_full_name];
                      return newBranches;
                    });
                  }
                }}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{repo.repository_full_name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Project Selection - only show if projectId wasn't provided initially */}
      {!initialProjectId && selectedRepos.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select Project *
          </label>
          {loadingProjects ? (
            <div className="text-sm text-gray-500">Loading projects...</div>
          ) : availableProjects.length === 0 ? (
            <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded">
              No projects found containing the selected repositories. Please add the repositories to a project first.
            </div>
          ) : (
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a project...</option>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} {project.description ? `- ${project.description}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Base Branch Selection per Repo */}
      {selectedRepos.map((repo) => (
        <div key={repo}>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Base Branch for {repo}
          </label>
          <select
            value={baseBranches[repo] || ''}
            onChange={(e) => setBaseBranches(prev => ({ ...prev, [repo]: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select branch...</option>
            {(branches[repo] || []).map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        </div>
      ))}

      {/* Branch Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Branch Type *
        </label>
        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value as any)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select type...</option>
          <option value="feat">Feature</option>
          <option value="bugs">Bug Fix</option>
          <option value="fixes">Fixes</option>
          <option value="qaqc">QA/QC</option>
        </select>
      </div>

      {/* Voice Input */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Voice Input *
        </label>
        <VoiceInput onTranscript={handleTranscript} disabled={loading} />
      </div>

      {/* Generate Task Button */}
      {voiceTranscript && selectedType && (
        <button
          onClick={generateTask}
          disabled={loading}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {loading ? 'Generating...' : 'Generate Task'}
        </button>
      )}

      {/* AI Generated Preview */}
      {aiGenerated && (
        <div className="border border-gray-200 rounded-md p-4 space-y-3">
          <h3 className="font-medium text-gray-900">Generated Task Preview</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700">Title</label>
            <p className="mt-1 text-sm text-gray-900">{aiGenerated.title}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Branch Name</label>
            <p className="mt-1 text-sm text-gray-900 font-mono">{aiGenerated.branchName}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{aiGenerated.description}</p>
          </div>
          <button
            onClick={createTask}
            disabled={loading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Task & Worktrees'}
          </button>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded">
          {error}
        </div>
      )}
    </div>
  );
}
