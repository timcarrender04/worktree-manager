'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Dialog } from '@headlessui/react';
import { CheckCircleIcon, XCircleIcon, ArrowPathIcon, TrashIcon, ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { VoiceInput } from '@/components/VoiceInput';

interface Repo {
  key: string;
  name: string;
  full_name?: string;
  url: string;
  exists: boolean;
  path: string;
  github_account_id?: string;
  github_account_name?: string;
  github_account_source?: string;
  github_account_username?: string | null;
  token_name?: string;
  token_id?: string;
}

interface RepoGroup {
  account: {
    id: string;
    name: string;
    github_username: string | null;
    source: 'account' | 'token';
    token_name?: string;
    token_id?: string;
  };
  repositories: Repo[];
}

interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  repository_count: number;
}

interface ProjectRepository {
  id: string;
  repository_full_name: string;
  github_account_id?: string | null;
  tracked_branch?: string | null;
}

interface Worktree {
  repo: string;
  repoName: string;
  repoFullName?: string | null;
  type: string;
  name: string;
  branch: string;
  path: string;
  fullPath: string;
  projectId?: string | null;
  kanbanItemId?: string | null;
  kanbanBoardId?: string | null;
  status?: string | null;
  columnId?: string | null;
}

const REPO_DISPLAY_NAMES: Record<string, string> = {
  frontend: 'Frontend',
  viewer: 'OHIF Viewer',
  backend: 'Backend'
};

const TYPE_DISPLAY_NAMES: Record<string, string> = {
  feat: 'New Feature',
  bugs: 'Bug Fix',
  fixes: 'Fix',
  qaqc: 'QAQC'
};

const KANBAN_STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Archived'
};

const KANBAN_STATUS_ORDER = ['backlog', 'ready', 'in_progress', 'review', 'done'];

export default function Home() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [repoGroups, setRepoGroups] = useState<RepoGroup[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectFetchError, setProjectFetchError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectRepositories, setProjectRepositories] = useState<ProjectRepository[]>([]);
  const [projectReposLoading, setProjectReposLoading] = useState(false);
  const [projectReposError, setProjectReposError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState('');
  const [branchName, setBranchName] = useState('');
  const [repoBranches, setRepoBranches] = useState<Record<string, string[]>>({});
  const [baseBranches, setBaseBranches] = useState<Record<string, string>>({});
  const [loadingBranches, setLoadingBranches] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [creatingProgress, setCreatingProgress] = useState<string | null>(null);
  const [generatingBranchName, setGeneratingBranchName] = useState(false);
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [worktreeToDelete, setWorktreeToDelete] = useState<Worktree | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDialogType, setAiDialogType] = useState<string | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [aiGeneratedTask, setAiGeneratedTask] = useState<{
    title: string;
    branchName: string;
    description: string;
  } | null>(null);
  const [generatingTask, setGeneratingTask] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [worktreeStatusFilter, setWorktreeStatusFilter] = useState<'all' | string>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [refreshingWorktrees, setRefreshingWorktrees] = useState(false);
  const refreshingWorktreesRef = useRef(false);

  const extractWorktreesFromResponse = useCallback((payload: any): Worktree[] => {
    if (Array.isArray(payload)) {
      return payload as Worktree[];
    }

    if (Array.isArray(payload?.worktrees)) {
      return payload.worktrees as Worktree[];
    }

    console.warn('Unexpected worktrees response shape:', payload);
    return [];
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  // Load branches for selected repos
  useEffect(() => {
    const loadBranchesForRepos = async () => {
      for (const repoKey of selectedRepos) {
        if (!repoBranches[repoKey] && !loadingBranches[repoKey]) {
          setLoadingBranches(prev => ({ ...prev, [repoKey]: true }));
          try {
            const response = await fetch(`/api/repos/${repoKey}/branches`);
            const data = await response.json();
            if (data.branches) {
              setRepoBranches(prev => ({ ...prev, [repoKey]: data.branches }));
              // Set default base branch if not already set
              setBaseBranches(prev => {
                if (!prev[repoKey] && data.branches.length > 0) {
                  // Prefer dev, then main, then master, then first available
                  const preferred = data.branches.find((b: string) => ['dev', 'main', 'master'].includes(b)) || data.branches[0];
                  return { ...prev, [repoKey]: preferred };
                }
                return prev;
              });
            }
          } catch (error) {
            console.error(`Failed to load branches for ${repoKey}:`, error);
          } finally {
            setLoadingBranches(prev => ({ ...prev, [repoKey]: false }));
          }
        }
      }
    };
    
    if (selectedRepos.length > 0) {
      loadBranchesForRepos();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepos]);

  // Auto-generate branch name when "feat" is selected
  useEffect(() => {
    const generateBranchName = async () => {
      // Only auto-generate for "feat" type when repos are selected and branch name is empty
      if (selectedType === 'feat' && selectedRepos.length > 0 && !generatingBranchName && !branchName.trim()) {
        setGeneratingBranchName(true);
        setIsAiGenerated(false);
        
        try {
          const response = await fetch('/api/ai/generate-branch-name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              branchType: 'feat',
              repositories: selectedRepos,
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to generate branch name');
          }

          const data = await response.json();
          if (data.branchName) {
            // Remove the "feat-" prefix as the worktree API adds it
            const nameWithoutPrefix = data.branchName.replace(/^feat-/, '');
            setBranchName(nameWithoutPrefix);
            setIsAiGenerated(true);
          }
        } catch (error) {
          console.error('Error generating branch name:', error);
          // Don't show error to user, just leave field empty
        } finally {
          setGeneratingBranchName(false);
        }
      } else if (selectedType !== 'feat' && isAiGenerated) {
        // Clear AI-generated branch name when switching away from feat
        // (feat branch names may not be appropriate for other types)
        setBranchName('');
        setIsAiGenerated(false);
      }
    };

    generateBranchName();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, selectedRepos.length]);

  useEffect(() => {
    if (!copiedPath) {
      return;
    }

    const timeout = setTimeout(() => setCopiedPath(null), 2000);
    return () => clearTimeout(timeout);
  }, [copiedPath]);

  const loadData = async () => {
    try {
      setLoading(true);
      setMessage(null); // Clear any previous messages
      
      const [reposRes, worktreesRes, projectsRes] = await Promise.all([
        fetch('/api/repos'),
        fetch('/api/worktrees'),
        fetch('/api/projects')
      ]);
      
      let errorMessage: string | null = null;
      setProjectFetchError(null);
      
      // Check if repos response is OK
      if (!reposRes.ok) {
        try {
          const errorData = await reposRes.json();
          errorMessage = errorData.error || 'Failed to load repositories';
        } catch {
          errorMessage = `Failed to load repositories (${reposRes.status})`;
        }
        setRepos([]);
      } else {
        try {
          const reposData = await reposRes.json();
          let normalizedRepos: Repo[] = [];

          if (Array.isArray(reposData)) {
            normalizedRepos = reposData;
          } else if (Array.isArray(reposData?.repos)) {
            normalizedRepos = reposData.repos;
          } else {
            console.warn('Unexpected repos response shape:', reposData);
            errorMessage = errorMessage || 'Repositories response format was not recognized';
          }

          normalizedRepos = normalizedRepos.map((repo: any) => ({
            ...repo,
            full_name: repo.full_name ?? repo.fullName ?? repo.name,
          }));

          setRepos(normalizedRepos);

          if (reposData?.repoGroups && typeof reposData.repoGroups === 'object') {
            const grouped: RepoGroup[] = Object.entries(reposData.repoGroups).map(([accountId, group]) => {
              const account = {
                id: (group as any)?.account?.id ?? accountId,
                name: (group as any)?.account?.name ?? accountId,
                github_username: (group as any)?.account?.github_username ?? null,
                source: (group as any)?.account?.source ?? 'account',
                token_name: (group as any)?.account?.token_name,
                token_id: (group as any)?.account?.token_id,
              } as RepoGroup['account'];

              const repositories: Repo[] = Array.isArray((group as any)?.repositories)
                ? (group as any).repositories
                : [];

              return { account, repositories };
            });

            setRepoGroups(grouped);
          } else {
            setRepoGroups([]);
          }
        } catch (error) {
          console.error('Failed to parse repos data:', error);
          setRepos([]);
          setRepoGroups([]);
          errorMessage = errorMessage || 'Failed to parse repositories data';
        }
      }
      
      // Check if worktrees response is OK
      if (!worktreesRes.ok) {
        try {
          const errorData = await worktreesRes.json();
          const worktreesError = errorData.error || 'Failed to load worktrees';
          // Combine errors if both failed, otherwise set the worktrees error
          if (errorMessage) {
            errorMessage = `${errorMessage}. Also: ${worktreesError}`;
          } else {
            errorMessage = worktreesError;
          }
        } catch {
          const worktreesError = `Failed to load worktrees (${worktreesRes.status})`;
          if (errorMessage) {
            errorMessage = `${errorMessage}. Also: ${worktreesError}`;
          } else {
            errorMessage = worktreesError;
          }
        }
        setWorktrees([]);
      } else {
        try {
          const worktreesData = await worktreesRes.json();
          const normalizedWorktrees = extractWorktreesFromResponse(worktreesData);

          if (normalizedWorktrees.length === 0 && !Array.isArray(worktreesData) && !Array.isArray(worktreesData?.worktrees)) {
            if (!errorMessage) {
              errorMessage = 'Worktrees response format was not recognized';
            }
          }

          setWorktrees(normalizedWorktrees);
        } catch (error) {
          console.error('Failed to parse worktrees data:', error);
          setWorktrees([]);
          if (!errorMessage) {
            errorMessage = 'Failed to parse worktrees data';
          }
        }
      }
      
      // Check if projects response is OK
      if (!projectsRes.ok) {
        try {
          const errorData = await projectsRes.json();
          const projectsError = errorData.error || 'Failed to load projects';
          setProjectFetchError(projectsError);
          errorMessage = errorMessage ? `${errorMessage}. Also: ${projectsError}` : projectsError;
        } catch {
          const projectsError = `Failed to load projects (${projectsRes.status})`;
          setProjectFetchError(projectsError);
          errorMessage = errorMessage ? `${errorMessage}. Also: ${projectsError}` : projectsError;
        }
        setProjects([]);
      } else {
        try {
          const projectsData = await projectsRes.json();
          const projectList: ProjectSummary[] = Array.isArray(projectsData?.projects) ? projectsData.projects : [];

          setProjects(projectList);

          if (projectList.length === 0) {
            setSelectedProjectId('');
            setProjectRepositories([]);
          } else if (selectedProjectId) {
            const stillExists = projectList.some((project) => project.id === selectedProjectId);
            if (!stillExists) {
              setSelectedProjectId('');
              setProjectRepositories([]);
            }
          }
        } catch (error) {
          console.error('Failed to parse projects data:', error);
          setProjects([]);
          const projectsError = 'Failed to parse projects data';
          setProjectFetchError(projectsError);
          errorMessage = errorMessage ? `${errorMessage}. Also: ${projectsError}` : projectsError;
        }
      }
      
      // Set error message if any occurred
      if (errorMessage) {
        setMessage({ type: 'error', text: errorMessage });
      }
    } catch (error) {
      console.error('Failed to load data:', error);
      setMessage({ type: 'error', text: 'Failed to load data. Please try refreshing the page.' });
      setRepos([]);
      setWorktrees([]);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  const refreshWorktrees = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (loading) {
        return;
      }

      if (refreshingWorktreesRef.current) {
        return;
      }

      const { silent = false } = options;

      refreshingWorktreesRef.current = true;
      if (!silent) {
        setRefreshingWorktrees(true);
      }

      try {
        const response = await fetch('/api/worktrees');
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const errorText = data?.error || `Failed to refresh worktrees (${response.status})`;
          throw new Error(errorText);
        }

        const normalizedWorktrees = extractWorktreesFromResponse(data);
        setWorktrees(normalizedWorktrees);
      } catch (error: any) {
        console.error('Failed to refresh worktrees:', error);
        if (!silent) {
          setMessage({ type: 'error', text: error.message || 'Failed to refresh worktrees' });
        }
      } finally {
        if (!silent) {
          setRefreshingWorktrees(false);
        }
        refreshingWorktreesRef.current = false;
      }
    },
    [extractWorktreesFromResponse, loading]
  );

  useEffect(() => {
    const handleFocus = () => {
      refreshWorktrees({ silent: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshWorktrees({ silent: true });
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshWorktrees]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectRepositories([]);
      setProjectReposLoading(false);
      setProjectReposError(null);
      setSelectedRepos([]);
      setBaseBranches({});
      setAiDialogOpen(false);
      setAiDialogType(null);
      setVoiceTranscript('');
      setAiGeneratedTask(null);
      return;
    }

    let isCancelled = false;

    const fetchProjectRepositories = async () => {
      try {
        setProjectReposLoading(true);
        setProjectReposError(null);

        const response = await fetch(`/api/projects/${selectedProjectId}/repositories`);
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          const errorText = errorBody.error || 'Failed to load project repositories';
          throw new Error(errorText);
        }

        const data = await response.json();
        const repoList: ProjectRepository[] = Array.isArray(data?.repositories) ? data.repositories : [];

        if (isCancelled) {
          return;
        }

        setProjectRepositories(repoList);

        const allowedFullNames = new Set(repoList.map((repo) => repo.repository_full_name?.toLowerCase()));

        setSelectedRepos((prev) => prev.filter((repoKey) => {
          const repoMeta = repos.find((repo) => repo.key === repoKey);
          if (!repoMeta?.full_name) {
            return false;
          }
          return allowedFullNames.has(repoMeta.full_name.toLowerCase());
        }));

        setBaseBranches((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((repoKey) => {
            const repoMeta = repos.find((repo) => repo.key === repoKey);
            if (!repoMeta?.full_name || !allowedFullNames.has(repoMeta.full_name.toLowerCase())) {
              delete next[repoKey];
            }
          });

          repoList.forEach((repo) => {
            if (!repo.tracked_branch) {
              return;
            }
            const repoMeta = repos.find((item) => item.full_name && item.full_name.toLowerCase() === repo.repository_full_name.toLowerCase());
            if (repoMeta && !next[repoMeta.key]) {
              next[repoMeta.key] = repo.tracked_branch;
            }
          });

          return next;
        });
      } catch (error: any) {
        if (isCancelled) {
          return;
        }
        console.error('Failed to fetch project repositories:', error);
        setProjectRepositories([]);
        setProjectReposError(error.message || 'Failed to load project repositories');
        setSelectedRepos([]);
        setBaseBranches({});
      } finally {
        if (!isCancelled) {
          setProjectReposLoading(false);
        }
      }
    };

    fetchProjectRepositories();

    return () => {
      isCancelled = true;
    };
  }, [selectedProjectId, repos]);

  const allowedRepoFullNameSet = useMemo(() => {
    if (!selectedProjectId || projectRepositories.length === 0) {
      return new Set<string>();
    }

    return new Set(
      projectRepositories
        .filter((repo) => !!repo.repository_full_name)
        .map((repo) => repo.repository_full_name.toLowerCase())
    );
  }, [selectedProjectId, projectRepositories]);

  const filteredRepoGroups = useMemo(() => {
    if (!selectedProjectId || repoGroups.length === 0) {
      return [] as RepoGroup[];
    }

    return repoGroups
      .map((group) => ({
        ...group,
        repositories: group.repositories.filter((repo) => {
          if (!repo.full_name) {
            return false;
          }
          return allowedRepoFullNameSet.has(repo.full_name.toLowerCase());
        }),
      }))
      .filter((group) => group.repositories.length > 0);
  }, [selectedProjectId, repoGroups, allowedRepoFullNameSet]);

  const filteredRepos = useMemo(() => {
    if (!selectedProjectId) {
      return [] as Repo[];
    }

    return repos.filter((repo) => repo.full_name && allowedRepoFullNameSet.has(repo.full_name.toLowerCase()));
  }, [selectedProjectId, repos, allowedRepoFullNameSet]);

  const missingProjectRepos = useMemo(() => {
    if (!selectedProjectId || projectRepositories.length === 0) {
      return [] as string[];
    }

    return projectRepositories
      .filter((projectRepo) => !repos.some((repo) => repo.full_name && repo.full_name.toLowerCase() === projectRepo.repository_full_name.toLowerCase()))
      .map((projectRepo) => projectRepo.repository_full_name);
  }, [selectedProjectId, projectRepositories, repos]);

  const worktreeStatusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    worktrees.forEach((worktree) => {
      const rawStatus = (worktree.status || worktree.columnId || 'backlog') || 'backlog';
      const normalized = rawStatus.toLowerCase();
      counts[normalized] = (counts[normalized] || 0) + 1;
    });
    return counts;
  }, [worktrees]);

  const orderedWorktreeStatuses = useMemo(() => {
    const ordered: string[] = [];
    KANBAN_STATUS_ORDER.forEach((status) => {
      if (worktreeStatusCounts[status]) {
        ordered.push(status);
      }
    });

    Object.keys(worktreeStatusCounts)
      .filter((status) => !KANBAN_STATUS_ORDER.includes(status))
      .sort()
      .forEach((status) => ordered.push(status));

    return ordered;
  }, [worktreeStatusCounts]);

  const filteredWorktrees = useMemo(() => {
    return worktrees.filter((worktree) => {
      const normalized = (worktree.status || worktree.columnId || 'backlog')?.toLowerCase() || 'backlog';

      if (worktreeStatusFilter !== 'all') {
        return normalized === worktreeStatusFilter;
      }

      if (!showArchived && normalized === 'done') {
        return false;
      }

      return true;
    });
  }, [worktrees, worktreeStatusFilter, showArchived]);

  const activeBranchType = aiDialogType || selectedType;
  const activeTypeLabel = activeBranchType ? (TYPE_DISPLAY_NAMES as Record<string, string>)[activeBranchType] || activeBranchType : 'Worktree';
  const activeTypeLabelLower = activeTypeLabel.toLowerCase();

  useEffect(() => {
    if (worktreeStatusFilter === 'all') {
      return;
    }

    if (!worktreeStatusCounts[worktreeStatusFilter]) {
      setWorktreeStatusFilter('all');
    }
  }, [worktreeStatusFilter, worktreeStatusCounts]);

  useEffect(() => {
    if (!worktreeStatusCounts.done && showArchived) {
      setShowArchived(false);
    }
  }, [worktreeStatusCounts, showArchived]);

  const buildRepoAccountMap = (repoKeys: string[]): Record<string, string> => {
    const map: Record<string, string> = {};
    repoKeys.forEach((key) => {
      const repoMeta = repos.find((repo) => repo.key === key);
      if (repoMeta?.github_account_id) {
        map[key] = repoMeta.github_account_id;
      }
    });
    return map;
  };

  const formatRepoDisplayName = (repoKey: string): string => {
    const friendlyName = REPO_DISPLAY_NAMES[repoKey];
    if (friendlyName) {
      return friendlyName;
    }

    const repoMeta = repos.find((repo) => repo.key === repoKey);
    return repoMeta?.name || repoMeta?.full_name || repoKey;
  };

  const formatKanbanStatusLabel = (status: string): string => {
    const normalized = status?.toLowerCase();
    if (!normalized) {
      return 'Backlog';
    }
    const label = KANBAN_STATUS_LABELS[normalized];
    if (label) {
      return label;
    }
    return normalized
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const getStatusBadgeClasses = (status: string): string => {
    switch (status) {
      case 'ready':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'in_progress':
        return 'bg-yellow-50 text-yellow-700 border-yellow-200';
      case 'review':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'done':
        return 'bg-green-50 text-green-700 border-green-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const buildManualKanbanMetadata = () => {
    const typeLabel = selectedType ? (TYPE_DISPLAY_NAMES as Record<string, string>)[selectedType] || selectedType : 'Worktree';
    const trimmedBranchName = branchName.trim();
    const repoNames = selectedRepos.map(formatRepoDisplayName);

    const titleParts: string[] = [];
    if (typeLabel) {
      titleParts.push(typeLabel);
    }
    if (trimmedBranchName) {
      titleParts.push(trimmedBranchName);
    }

    const title = titleParts.length > 0 ? titleParts.join(': ') : 'Worktree Task';

    const baseBranchLines = selectedRepos
      .map((repoKey) => {
        const branch = baseBranches[repoKey];
        return branch ? `- ${formatRepoDisplayName(repoKey)} → ${branch}` : null;
      })
      .filter(Boolean) as string[];

    const descriptionSections: string[] = [
      `Type: ${typeLabel}`,
      `Branch Name: ${trimmedBranchName || 'Not provided'}`,
      `Repositories: ${repoNames.join(', ') || 'None selected'}`,
    ];

    if (baseBranchLines.length > 0) {
      descriptionSections.push('Base Branches:', ...baseBranchLines);
    }

    return {
      title,
      description: descriptionSections.join('\n')
    };
  };

  const toggleRepo = (repoKey: string, event: React.MouseEvent) => {
    if (!selectedProjectId) {
      setMessage({ type: 'error', text: 'Please select a project before choosing repositories.' });
      return;
    }

    const repoMeta = repos.find((repo) => repo.key === repoKey);
    if (!repoMeta?.full_name || !allowedRepoFullNameSet.has(repoMeta.full_name.toLowerCase())) {
      return;
    }

    // Support Ctrl+click for multi-select
    if (event.ctrlKey || event.metaKey) {
      setSelectedRepos(prev => 
        prev.includes(repoKey) 
          ? prev.filter(r => r !== repoKey)
          : [...prev, repoKey]
      );
    } else {
      // Single click: toggle the repo
      setSelectedRepos(prev => 
        prev.includes(repoKey) 
          ? prev.filter(r => r !== repoKey)
          : [...prev, repoKey]
      );
    }
  };

  const handleCopyPath = async (path: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(path);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = path;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      setCopiedPath(path);
    } catch (error) {
      console.error('Failed to copy path:', error);
      setMessage({ type: 'error', text: 'Failed to copy path to clipboard' });
    }
  };

  const handleCreate = async () => {
    if (!selectedProjectId) {
      setMessage({ type: 'error', text: 'Please select a project before creating worktrees.' });
      return;
    }

    if (selectedRepos.length === 0 || !selectedType || !branchName.trim()) {
      setMessage({ type: 'error', text: 'Please select at least one repository and fill in all fields' });
      return;
    }

    // Validate branch name
    if (!/^[a-zA-Z0-9_-]+$/.test(branchName)) {
      setMessage({ type: 'error', text: 'Branch name can only contain letters, numbers, hyphens, and underscores' });
      return;
    }

    try {
      setCreating(true);
      setMessage(null);
      setCreatingProgress(null);

      const { title: kanbanTitle, description: kanbanDescription } = buildManualKanbanMetadata();

      const selectedRepoMetadata = selectedRepos.map((repoKey) => {
        const repoMeta = repos.find((repo) => repo.key === repoKey);
        const fullName = repoMeta?.full_name || null;
        const projectRepoMatch = fullName
          ? projectRepositories.find((projectRepo) => projectRepo.repository_full_name.toLowerCase() === fullName.toLowerCase())
          : undefined;

        return {
          repoKey,
          fullName,
          projectRepositoryId: projectRepoMatch?.id || null,
        };
      });

      const response = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          repos: selectedRepos,
          type: selectedType,
          name: branchName.trim(),
          baseBranches: baseBranches,
          repoAccountMap: buildRepoAccountMap(selectedRepos),
          selectedRepoMetadata,
          kanban: {
            title: kanbanTitle,
            description: kanbanDescription,
            columnId: 'backlog',
            source: 'manual',
          },
        })
      });

      const data = await response.json();

      if (!response.ok) {
        // Include detailed errors if available
        let errorMessage = data.error || 'Failed to create working trees';
        if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
          const detailedErrors = data.errors.map((err: any) => {
            const repoName = REPO_DISPLAY_NAMES[err.repo] || err.repo;
            return `${repoName}: ${err.error}`;
          }).join('; ');
          errorMessage = `${errorMessage} (${detailedErrors})`;
        }
        throw new Error(errorMessage);
      }

      // Build success message with results
      const successCount = data.worktrees?.length || 0;
      const errorCount = data.errors?.length || 0;
      let messageText = '';
      
      if (errorCount === 0) {
        messageText = `Successfully created ${successCount} working tree${successCount > 1 ? 's' : ''}${successCount > 1 ? ` in ${successCount} repositories` : ''}`;
        if (successCount > 1) {
          const repoNames = data.worktrees.map((wt: any) => REPO_DISPLAY_NAMES[wt.repo] || wt.repoName).join(', ');
          messageText += `: ${repoNames}`;
        }
      } else {
        const successRepos = data.worktrees?.map((wt: any) => REPO_DISPLAY_NAMES[wt.repo] || wt.repoName) || [];
        const failedRepos = data.errors?.map((err: any) => REPO_DISPLAY_NAMES[err.repo] || err.repo).join(', ') || '';
        messageText = `Created ${successCount} working tree${successCount > 1 ? 's' : ''}${successRepos.length > 0 ? ` in ${successRepos.join(', ')}` : ''}${failedRepos ? `. Failed in ${failedRepos}` : ''}`;
      }

      setMessage({ type: errorCount > 0 ? 'error' : 'success', text: messageText });
      setSelectedRepos([]);
      setSelectedType('');
      setBranchName('');
      setBaseBranches({});
      setIsAiGenerated(false);
      setAiDialogType(null);
      setAiDialogOpen(false);
      setVoiceTranscript('');
      setAiGeneratedTask(null);
      
      // Reload data
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to create working trees' });
    } finally {
      setCreating(false);
      setCreatingProgress(null);
    }
  };

  const openDeleteDialog = (worktree: Worktree) => {
    setWorktreeToDelete(worktree);
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!worktreeToDelete) return;

    try {
      setDeleting(worktreeToDelete.path);
      setMessage(null);
      setDeleteDialogOpen(false);

      const deletePayload: Record<string, any> = {
        repo: worktreeToDelete.repo,
        type: worktreeToDelete.type,
        name: worktreeToDelete.name,
        path: worktreeToDelete.path,
        branch: worktreeToDelete.branch,
      };

      const resolvedProjectId = worktreeToDelete.projectId || (selectedProjectId ? selectedProjectId : undefined);
      if (resolvedProjectId) {
        deletePayload.projectId = resolvedProjectId;
      }

      if (worktreeToDelete.kanbanItemId) {
        deletePayload.kanbanItemId = worktreeToDelete.kanbanItemId;
      }

      if (worktreeToDelete.repoFullName) {
        deletePayload.repoFullName = worktreeToDelete.repoFullName;
      }

      const response = await fetch('/api/worktrees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deletePayload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete working tree');
      }

      let successMessage = `Working tree "${worktreeToDelete.branch}" deleted successfully`;

      if (data?.kanban) {
        if (data.kanban.deleted) {
          successMessage += ' and associated kanban card removed.';
        } else if (data.kanban.error) {
          successMessage += `, but kanban card was not removed (${data.kanban.error}).`;
        } else {
          successMessage += '. No linked kanban card was found to remove.';
        }
      }

      setMessage({ type: 'success', text: successMessage });
      
      // Reload data
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to delete working tree' });
    } finally {
      setDeleting(null);
      setWorktreeToDelete(null);
    }
  };

  const handleVoiceTranscript = (text: string) => {
    setVoiceTranscript(text);
  };

  const generateTaskWithAI = async () => {
    if (!voiceTranscript.trim()) {
      setMessage({ type: 'error', text: 'Please provide voice input' });
      return;
    }

    if (!selectedProjectId) {
      setMessage({ type: 'error', text: 'Please select a project before generating an AI task.' });
      return;
    }

    if (selectedRepos.length === 0) {
      setMessage({ type: 'error', text: 'Please select at least one repository' });
      return;
    }

    const branchType = (aiDialogType || selectedType || '').trim();
    if (!branchType) {
      setMessage({ type: 'error', text: 'Please select a branch type before generating an AI task.' });
      return;
    }

    setGeneratingTask(true);
    setMessage(null);

    try {
      const response = await fetch('/api/ai/generate-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: voiceTranscript.trim(),
          branchType,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to generate task');
      }

      const data = await response.json();
      setAiGeneratedTask(data);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to generate task' });
    } finally {
      setGeneratingTask(false);
    }
  };

  const createTaskFromAI = async () => {
    if (!selectedProjectId) {
      setMessage({ type: 'error', text: 'Please select a project before creating worktrees.' });
      return;
    }

    if (!aiGeneratedTask || selectedRepos.length === 0) {
      setMessage({ type: 'error', text: 'Please complete all required fields' });
      return;
    }

    const branchType = (aiDialogType || selectedType || '').trim();
    if (!branchType) {
      setMessage({ type: 'error', text: 'Please select a branch type before creating worktrees.' });
      return;
    }

    try {
      setCreating(true);
      setMessage(null);
      setCreatingProgress(null);
      setAiDialogOpen(false);

      let branchNameWithoutPrefix = aiGeneratedTask.branchName.trim();
      const expectedPrefix = `${branchType}-`;
      if (branchNameWithoutPrefix.toLowerCase().startsWith(expectedPrefix)) {
        branchNameWithoutPrefix = branchNameWithoutPrefix.slice(expectedPrefix.length);
      }
      branchNameWithoutPrefix = branchNameWithoutPrefix.replace(/\s+/g, '-');

      const baseBranchLines = selectedRepos
        .map((repoKey) => {
          const branch = baseBranches[repoKey];
          return branch ? `- ${formatRepoDisplayName(repoKey)} → ${branch}` : null;
        })
        .filter(Boolean) as string[];

      const branchTypeLabel = (TYPE_DISPLAY_NAMES as Record<string, string>)[branchType] || branchType;

      const aiDescriptionSections: string[] = [];
      if (aiGeneratedTask.description) {
        aiDescriptionSections.push(aiGeneratedTask.description.trim());
      }
      aiDescriptionSections.push(
        `Type: ${branchTypeLabel}`,
        `Branch Name: ${branchNameWithoutPrefix || 'Not provided'}`,
        `Repositories: ${selectedRepos.map(formatRepoDisplayName).join(', ') || 'None selected'}`
      );
      if (baseBranchLines.length > 0) {
        aiDescriptionSections.push('Base Branches:', ...baseBranchLines);
      }

      const response = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          repos: selectedRepos,
          type: branchType,
          name: branchNameWithoutPrefix,
          baseBranches: baseBranches,
          repoAccountMap: buildRepoAccountMap(selectedRepos),
          selectedRepoMetadata: selectedRepos.map((repoKey) => {
            const repoMeta = repos.find((repo) => repo.key === repoKey);
            const fullName = repoMeta?.full_name || null;
            const projectRepoMatch = fullName
              ? projectRepositories.find((projectRepo) => projectRepo.repository_full_name.toLowerCase() === fullName.toLowerCase())
              : undefined;

            return {
              repoKey,
              fullName,
              projectRepositoryId: projectRepoMatch?.id || null,
            };
          }),
          kanban: {
            title: aiGeneratedTask.title,
            description: aiDescriptionSections.join('\n'),
            columnId: 'backlog',
            source: 'ai',
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMessage = data.error || 'Failed to create working trees';
        if (data.errors && Array.isArray(data.errors) && data.errors.length > 0) {
          const detailedErrors = data.errors.map((err: any) => {
            const repoName = REPO_DISPLAY_NAMES[err.repo] || err.repo;
            return `${repoName}: ${err.error}`;
          }).join('; ');
          errorMessage = `${errorMessage} (${detailedErrors})`;
        }
        throw new Error(errorMessage);
      }

      // Build success message
      const successCount = data.worktrees?.length || 0;
      const errorCount = data.errors?.length || 0;
      let messageText = '';
      
      if (errorCount === 0) {
        messageText = `Successfully created ${successCount} working tree${successCount > 1 ? 's' : ''}${successCount > 1 ? ` in ${successCount} repositories` : ''} with AI-generated ${branchTypeLabel.toLowerCase()}: "${aiGeneratedTask.title}"`;
      } else {
        const successRepos = data.worktrees?.map((wt: any) => REPO_DISPLAY_NAMES[wt.repo] || wt.repoName) || [];
        const failedRepos = data.errors?.map((err: any) => REPO_DISPLAY_NAMES[err.repo] || err.repo).join(', ') || '';
        messageText = `Created ${successCount} working tree${successCount > 1 ? 's' : ''}${successRepos.length > 0 ? ` in ${successRepos.join(', ')}` : ''}${failedRepos ? `. Failed in ${failedRepos}` : ''}`;
      }

      setMessage({ type: errorCount > 0 ? 'error' : 'success', text: messageText });
      
      // Reset form
      setSelectedRepos([]);
      setSelectedType('');
      setBranchName('');
      setBaseBranches({});
      setAiGeneratedTask(null);
      setVoiceTranscript('');
      setIsAiGenerated(false);
      setAiDialogType(null);
      setAiDialogOpen(false);
      
      // Reload data
      await loadData();
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to create working trees' });
    } finally {
      setCreating(false);
      setCreatingProgress(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-[var(--foreground-muted)]">Loading...</div>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-6xl mx-auto">
        <h1 className="mb-8 mt-0">
          Git Working Trees
        </h1>

        {/* Create New Working Tree */}
        <div className="bg-[var(--white)] rounded-lg shadow-lg p-6 mb-8 border border-[var(--white-100)]">
          <h2 className="mb-6">Create New Working Tree</h2>
          
          {message && (
            <div className={`mb-6 p-4 rounded-lg flex items-start gap-3 ${
              message.type === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {message.type === 'success' ? (
                <CheckCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircleIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
              )}
              <div className="whitespace-pre-wrap break-words flex-1">{message.text}</div>
            </div>
          )}

          <div className="mb-6">
            <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
              Project
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                const newProjectId = e.target.value;
                setSelectedProjectId(newProjectId);
                setSelectedRepos([]);
                setBaseBranches({});
                setSelectedType('');
                setBranchName('');
                setIsAiGenerated(false);
                setAiDialogOpen(false);
                setAiDialogType(null);
                setVoiceTranscript('');
                setAiGeneratedTask(null);
              }}
              className="w-full px-4 py-2 border border-[var(--white-100)] rounded-lg bg-[var(--white)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-colors"
              disabled={creating || projects.length === 0}
            >
              <option value="">Select project...</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {typeof project.repository_count === 'number' ? ` (${project.repository_count} repos)` : ''}
                </option>
              ))}
            </select>
            {projectFetchError && (
              <p className="mt-2 text-sm text-red-600">{projectFetchError}</p>
            )}
            {!projectFetchError && projects.length === 0 && (
              <p className="mt-2 text-sm text-[var(--foreground-muted)]">
                No projects available. Create a project in Project Tim first, then refresh this page.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                Repositories {selectedRepos.length > 0 && <span className="text-[var(--accent)]">({selectedRepos.length} selected)</span>}
              </label>
              <div className="border border-[var(--white-100)] rounded-lg p-3 bg-[var(--white)] max-h-48 overflow-y-auto shadow-sm mb-2">
                {!selectedProjectId ? (
                  <p className="text-sm text-[var(--foreground-muted)]">Select a project to view available repositories.</p>
                ) : projectReposLoading ? (
                  <p className="text-sm text-[var(--foreground-muted)]">Loading project repositories...</p>
                ) : projectReposError ? (
                  <p className="text-sm text-red-600">{projectReposError}</p>
                ) : allowedRepoFullNameSet.size === 0 ? (
                  <p className="text-sm text-[var(--foreground-muted)]">No repositories are associated with this project.</p>
                ) : filteredRepoGroups.length === 0 && filteredRepos.length === 0 ? (
                  <p className="text-sm text-[var(--foreground-muted)]">No accessible repositories found for this project. Ensure they are cloned locally and linked to your GitHub accounts.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredRepoGroups.length > 0 ? (
                      filteredRepoGroups.map((group) => (
                        <div key={`group-${group.account.id}`} className="border border-[var(--white-100)] rounded-md overflow-hidden">
                          <div className="bg-[var(--white-50)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
                            {group.account.name}
                            {group.account.source === 'token' && group.account.token_name ? ` · ${group.account.token_name}` : ''}
                          </div>
                          <div className="divide-y divide-[var(--white-100)]">
                            {group.repositories.map((repo) => (
                              <label
                                key={repo.key}
                                className="flex items-center space-x-2 cursor-pointer hover:bg-[var(--white-50)] p-2 transition-colors"
                                onClick={(e) => toggleRepo(repo.key, e)}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedRepos.includes(repo.key)}
                                  onChange={() => {}}
                                  className="w-4 h-4 text-[var(--accent)] border-[var(--white-100)] rounded focus:ring-[var(--accent)] focus:ring-2"
                                  disabled={creating}
                                />
                                <span className="text-sm text-[var(--foreground)] flex-1">
                                  {REPO_DISPLAY_NAMES[repo.key] || repo.name}
                                  {repo.exists ? <CheckCircleIcon className="w-4 h-4 inline text-green-600 ml-1" /> : ''}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))
                    ) : (
                      filteredRepos.map((repo) => (
                        <label
                          key={repo.key}
                          className="flex items-center space-x-2 cursor-pointer hover:bg-[var(--white-50)] p-2 rounded transition-colors"
                          onClick={(e) => toggleRepo(repo.key, e)}
                        >
                          <input
                            type="checkbox"
                            checked={selectedRepos.includes(repo.key)}
                            onChange={() => {}}
                            className="w-4 h-4 text-[var(--accent)] border-[var(--white-100)] rounded focus:ring-[var(--accent)] focus:ring-2"
                            disabled={creating}
                          />
                          <span className="text-sm text-[var(--foreground)] flex-1">
                            {REPO_DISPLAY_NAMES[repo.key] || repo.name} {repo.exists ? <CheckCircleIcon className="w-4 h-4 inline text-green-600" /> : ''}
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
              {missingProjectRepos.length > 0 && selectedProjectId && !projectReposLoading && (
                <p className="text-xs text-red-600 mt-2 mb-0">
                  Repositories missing locally: {missingProjectRepos.join(', ')}.
                </p>
              )}
              <p className="text-xs text-[var(--foreground-muted)] mt-2 mb-0">Click to select. Hold Ctrl/Cmd and click for multiple selection.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                Branch Type
              </label>
              <select
                value={selectedType}
                onChange={(e) => {
                  const newType = e.target.value;
                  setSelectedType(newType);
                  setVoiceTranscript('');
                  setAiGeneratedTask(null);
                  if (newType) {
                    setAiDialogType(newType);
                    setAiDialogOpen(true);
                  } else {
                    setAiDialogOpen(false);
                    setAiDialogType(null);
                  }
                }}
                className="w-full px-4 py-2 border border-[var(--white-100)] rounded-lg bg-[var(--white)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-colors"
                disabled={creating || !selectedProjectId}
              >
                <option value="">Select type...</option>
                <option value="feat">New Feature</option>
                <option value="bugs">Bug Fix</option>
                <option value="fixes">Fix</option>
                <option value="qaqc">QAQC</option>
              </select>
              {selectedType && (
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedType) {
                      return;
                    }
                    setAiDialogType(selectedType);
                    setAiDialogOpen(true);
                  }}
                  className="mt-2 inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md border border-[var(--white-100)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--white-50)] transition-colors"
                  disabled={creating}
                >
                  Describe with AI Voice
                </button>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                Branch Name
                {selectedType === 'feat' && (
                  <span className="ml-2 text-xs text-[var(--foreground-muted)]">(AI-generated for features)</span>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => {
                    setBranchName(e.target.value);
                    setIsAiGenerated(false);
                  }}
                  placeholder={generatingBranchName ? "Generating..." : "e.g., login-button"}
                  className={`flex-1 px-4 py-2 border border-[var(--white-100)] rounded-lg bg-[var(--white)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-colors ${
                    isAiGenerated ? 'bg-[var(--accent-light)]/10 border-[var(--accent-light)]' : ''
                  }`}
                  disabled={creating || generatingBranchName || !selectedProjectId}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !creating && selectedRepos.length > 0 && selectedType && branchName.trim()) {
                      handleCreate();
                    }
                  }}
                />
                {selectedType === 'feat' && (
                  <button
                    type="button"
                    onClick={async () => {
                      setGeneratingBranchName(true);
                      setIsAiGenerated(false);
                      setBranchName('');
                      
                      try {
                        const response = await fetch('/api/ai/generate-branch-name', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            branchType: 'feat',
                            repositories: selectedRepos,
                          }),
                        });

                        if (!response.ok) {
                          throw new Error('Failed to generate branch name');
                        }

                        const data = await response.json();
                        if (data.branchName) {
                          // Remove the "feat-" prefix as the worktree API adds it
                          const nameWithoutPrefix = data.branchName.replace(/^feat-/, '');
                          setBranchName(nameWithoutPrefix);
                          setIsAiGenerated(true);
                        }
                      } catch (error) {
                        console.error('Error regenerating branch name:', error);
                        setMessage({ type: 'error', text: 'Failed to regenerate branch name' });
                      } finally {
                        setGeneratingBranchName(false);
                      }
                    }}
                    disabled={creating || generatingBranchName || selectedRepos.length === 0 || !selectedProjectId}
                    className="px-3 py-2 text-sm bg-[var(--white-100)] text-[var(--foreground)] rounded-lg hover:bg-[var(--white-100)]/80 disabled:bg-[var(--white-100)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed transition-colors"
                    title="Regenerate branch name"
                  >
                    <ArrowPathIcon className={`w-5 h-5 ${generatingBranchName ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
              {generatingBranchName && (
                <p className="mt-1 text-xs text-[var(--accent)]">AI is generating a branch name...</p>
              )}
              {isAiGenerated && !generatingBranchName && (
                <p className="mt-1 text-xs text-green-600 flex items-center gap-1">
                  <CheckCircleIcon className="w-4 h-4" /> Branch name generated by AI
                </p>
              )}
            </div>
          </div>

          {/* Base Branch Selection - Full Width Below Grid */}
          {selectedRepos.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                Base Branch (for each repository)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {selectedRepos.map((repoKey) => {
                  const repo = repos.find(r => r.key === repoKey);
                  const branches = repoBranches[repoKey] || [];
                  const isLoading = loadingBranches[repoKey];
                  
                  return (
                    <div key={repoKey} className="flex items-center gap-3">
                      <label className="text-sm text-[var(--foreground-muted)] w-24 flex-shrink-0">
                        {REPO_DISPLAY_NAMES[repoKey] || repo?.name || repoKey}:
                      </label>
                      <select
                        value={baseBranches[repoKey] || ''}
                        onChange={(e) => setBaseBranches(prev => ({ ...prev, [repoKey]: e.target.value }))}
                        className="flex-1 px-4 py-2 border border-[var(--white-100)] rounded-lg bg-[var(--white)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-colors"
                        disabled={creating || isLoading}
                      >
                        {isLoading ? (
                          <option>Loading branches...</option>
                        ) : branches.length === 0 ? (
                          <option>No branches available</option>
                        ) : (
                          <>
                            <option value="">Select base branch...</option>
                            {branches.map((branch) => (
                              <option key={branch} value={branch}>
                                {branch}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {creatingProgress && (
            <div className="mb-4 text-sm text-[var(--accent)]">
              {creatingProgress}
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={creating || selectedRepos.length === 0 || !selectedType || !branchName.trim()}
            className="px-6 py-3 bg-[var(--accent)] text-[var(--navy-900)] font-semibold rounded-lg hover:bg-[var(--accent-hover)] disabled:bg-[var(--white-100)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed transition-colors shadow-md hover:shadow-lg"
          >
            {creating ? `Creating in ${selectedRepos.length} repositor${selectedRepos.length > 1 ? 'ies' : 'y'}...` : `Create Working Tree${selectedRepos.length > 1 ? 's' : ''}`}
          </button>
        </div>

        {/* Existing Working Trees */}
        <div className="bg-[var(--white)] rounded-lg shadow-lg p-6 border border-[var(--white-100)]">
          <h2 className="mb-4">Existing Working Trees</h2>
          
          {worktrees.length === 0 ? (
            <p className="text-[var(--foreground-muted)]">No working trees found. Create one above to get started.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="flex flex-wrap gap-2 flex-1 min-w-[200px]">
                  <button
                    type="button"
                    onClick={() => setWorktreeStatusFilter('all')}
                    className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                      worktreeStatusFilter === 'all'
                        ? 'bg-[var(--accent)] text-[var(--navy-900)] border-[var(--accent)] shadow-sm'
                        : 'bg-[var(--white)] border-[var(--white-100)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    All ({worktrees.length})
                  </button>
                  {orderedWorktreeStatuses.map((status) => {
                    const count = worktreeStatusCounts[status] || 0;
                    if (count === 0) {
                      return null;
                    }
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setWorktreeStatusFilter(status)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${
                          worktreeStatusFilter === status
                            ? 'bg-[var(--accent)] text-[var(--navy-900)] border-[var(--accent)] shadow-sm'
                            : 'bg-[var(--white)] border-[var(--white-100)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        {formatKanbanStatusLabel(status)} ({count})
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setShowArchived((prev) => !prev)}
                  disabled={worktreeStatusFilter !== 'all' || !(worktreeStatusCounts.done > 0)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-2 ${
                    worktreeStatusFilter !== 'all' || !(worktreeStatusCounts.done > 0)
                      ? 'bg-[var(--white-100)] text-[var(--foreground-muted)] border-[var(--white-100)] cursor-not-allowed'
                      : showArchived
                        ? 'bg-green-100 text-green-700 border-green-200 shadow-sm'
                        : 'bg-[var(--white)] border-[var(--white-100)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  {showArchived ? 'Hide Archived' : 'Show Archived'}
                </button>
                <button
                  type="button"
                  onClick={() => refreshWorktrees()}
                  disabled={refreshingWorktrees}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors flex items-center gap-2 ${
                    refreshingWorktrees
                      ? 'bg-[var(--white-100)] text-[var(--foreground-muted)] border-[var(--white-100)] cursor-not-allowed'
                      : 'bg-[var(--white)] border-[var(--white-100)] text-[var(--foreground-muted)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <ArrowPathIcon className={`w-4 h-4 ${refreshingWorktrees ? 'animate-spin' : ''}`} />
                  {refreshingWorktrees ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--white-100)]">
                  <thead className="bg-[var(--white-50)]">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                        Repository
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                        Branch
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                        Path
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-[var(--white)] divide-y divide-[var(--white-100)]">
                    {filteredWorktrees.map((wt, idx) => {
                      const normalizedStatus = (wt.status || wt.columnId || 'backlog')?.toLowerCase() || 'backlog';
                      const statusLabel = formatKanbanStatusLabel(normalizedStatus);
                      return (
                        <tr key={idx} className="hover:bg-[var(--white-50)] transition-colors">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-[var(--foreground)]">
                            {REPO_DISPLAY_NAMES[wt.repo] || wt.repoName}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--foreground-muted)]">
                            {TYPE_DISPLAY_NAMES[wt.type] || wt.type}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--foreground)] font-mono">
                            {wt.branch}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${getStatusBadgeClasses(normalizedStatus)}`}>
                              {statusLabel}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-[var(--foreground-muted)] font-mono">
                            <div className="flex items-center gap-2">
                              <span className="break-all">{wt.path}</span>
                              <button
                                type="button"
                                onClick={() => handleCopyPath(wt.path)}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--white-100)] bg-[var(--white)] text-[var(--foreground-muted)] hover:text-[var(--foreground)] hover:bg-[var(--white-50)] transition-colors"
                                title="Copy path"
                              >
                                {copiedPath === wt.path ? (
                                  <CheckIcon className="w-4 h-4 text-green-600" />
                                ) : (
                                  <ClipboardIcon className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                            {copiedPath === wt.path && (
                              <span className="mt-1 block text-xs text-green-600">Copied!</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <button
                              onClick={() => openDeleteDialog(wt)}
                              disabled={deleting === wt.path}
                              className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-[var(--white-100)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed transition-colors text-xs flex items-center gap-1.5"
                            >
                              <TrashIcon className="w-4 h-4" />
                              {deleting === wt.path ? 'Deleting...' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredWorktrees.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-6 text-center text-sm text-[var(--foreground-muted)]">
                          No working trees match this status.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="mx-auto max-w-sm rounded-lg bg-[var(--white)] p-6 shadow-xl">
            <Dialog.Title className="text-lg font-semibold text-[var(--foreground)] mb-2">
              Delete Working Tree
            </Dialog.Title>
            <Dialog.Description className="text-sm text-[var(--foreground-muted)] mb-6">
              Are you sure you want to delete the working tree <strong>"{worktreeToDelete?.branch}"</strong>?
              <br /><br />
              This will remove the worktree and all its files. This action cannot be undone.
            </Dialog.Description>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteDialogOpen(false)}
                className="px-4 py-2 text-sm font-medium text-[var(--foreground-muted)] bg-[var(--white-100)] rounded-lg hover:bg-[var(--white-100)]/80 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>

      {/* AI Voice Task Creation Dialog */}
      <Dialog open={aiDialogOpen} onClose={() => {
        setAiDialogOpen(false);
        setVoiceTranscript('');
        setAiGeneratedTask(null);
      }} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="relative mx-auto max-w-2xl w-full rounded-lg bg-[var(--white)] p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            {generatingTask && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-[var(--white)]/85 backdrop-blur-sm">
                <span className="text-5xl" role="img" aria-label="Robot">🤖</span>
                <div className="h-10 w-10 rounded-full border-4 border-[var(--accent)] border-t-transparent animate-spin" />
                <p className="text-sm font-medium text-[var(--foreground-muted)]">AI is thinking...</p>
              </div>
            )}
            <div className={generatingTask ? 'blur-sm pointer-events-none select-none' : ''}>
              <Dialog.Title className="text-xl font-semibold text-[var(--foreground)] mb-4">
                Create {activeTypeLabel} with AI
              </Dialog.Title>
              <Dialog.Description className="text-sm text-[var(--foreground-muted)] mb-6">
                Use your microphone to describe the {activeTypeLabelLower} you want to create. Our AI will generate the task title, branch name, and description.
              </Dialog.Description>

              {selectedRepos.length === 0 && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    Please select at least one repository before creating a {activeTypeLabelLower}.
                  </p>
                </div>
              )}

              {selectedRepos.length > 0 && (
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                      Selected Repositories
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {selectedRepos.map((repoKey) => {
                        const repo = repos.find(r => r.key === repoKey);
                        return (
                          <span
                            key={repoKey}
                            className="px-3 py-1 bg-[var(--accent-light)]/20 text-[var(--foreground)] rounded-lg text-sm"
                          >
                            {REPO_DISPLAY_NAMES[repoKey] || repo?.name || repoKey}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {selectedRepos.length > 0 && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                        Base Branch (for each repository)
                      </label>
                      <div className="space-y-2">
                        {selectedRepos.map((repoKey) => {
                          const repo = repos.find(r => r.key === repoKey);
                          const branches = repoBranches[repoKey] || [];
                          const isLoading = loadingBranches[repoKey];
                          
                          return (
                            <div key={repoKey} className="flex items-center gap-3">
                              <label className="text-sm text-[var(--foreground-muted)] w-32 flex-shrink-0">
                                {REPO_DISPLAY_NAMES[repoKey] || repo?.name || repoKey}:
                              </label>
                              <select
                                value={baseBranches[repoKey] || ''}
                                onChange={(e) => setBaseBranches(prev => ({ ...prev, [repoKey]: e.target.value }))}
                                className="flex-1 px-4 py-2 border border-[var(--white-100)] rounded-lg bg-[var(--white)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-colors"
                                disabled={creating || isLoading}
                              >
                                {isLoading ? (
                                  <option>Loading branches...</option>
                                ) : branches.length === 0 ? (
                                  <option>No branches available</option>
                                ) : (
                                  <>
                                    <option value="">Select base branch...</option>
                                    {branches.map((branch) => (
                                      <option key={branch} value={branch}>
                                        {branch}
                                      </option>
                                    ))}
                                  </>
                                )}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                  Task Description
                </label>
                <p className="text-xs text-[var(--foreground-muted)] mb-2">
                  Type your description or use voice input below
                </p>
                <VoiceInput onTranscript={handleVoiceTranscript} disabled={generatingTask || creating} />
              </div>

              {voiceTranscript && !aiGeneratedTask && (
                <div className="mb-4">
                  <button
                    onClick={generateTaskWithAI}
                    disabled={generatingTask || selectedRepos.length === 0}
                    className="w-full px-4 py-2 bg-[var(--accent)] text-[var(--navy-900)] font-semibold rounded-lg hover:bg-[var(--accent-hover)] disabled:bg-[var(--white-100)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed transition-colors"
                  >
                    {generatingTask ? 'Generating with AI...' : 'Generate Task with AI'}
                  </button>
                </div>
              )}

              {aiGeneratedTask && (
                <div className="mb-4 p-4 bg-[var(--white-50)] border border-[var(--white-100)] rounded-lg">
                  <h3 className="font-medium text-[var(--foreground)] mb-3">AI Generated Task</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--foreground-muted)] mb-1">Title</label>
                      <p className="text-sm text-[var(--foreground)]">{aiGeneratedTask.title}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--foreground-muted)] mb-1">Branch Name</label>
                      <p className="text-sm text-[var(--foreground)] font-mono">{aiGeneratedTask.branchName}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--foreground-muted)] mb-1">Description</label>
                      <p className="text-sm text-[var(--foreground-muted)] whitespace-pre-wrap">{aiGeneratedTask.description}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end mt-6">
                <button
                  onClick={() => {
                    setAiDialogOpen(false);
                    setVoiceTranscript('');
                    setAiGeneratedTask(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-[var(--foreground-muted)] bg-[var(--white-100)] rounded-lg hover:bg-[var(--white-100)]/80 transition-colors"
                >
                  Cancel
                </button>
                {aiGeneratedTask && (
                  <button
                    onClick={createTaskFromAI}
                    disabled={creating || selectedRepos.length === 0}
                    className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded-lg hover:bg-[var(--accent-hover)] disabled:bg-[var(--white-100)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed transition-colors"
                  >
                    {creating ? 'Creating...' : 'Create Worktrees'}
                  </button>
                )}
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
