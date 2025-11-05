'use client';

import { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';
import { CheckCircleIcon, XCircleIcon, ArrowPathIcon, TrashIcon } from '@heroicons/react/24/outline';
import { VoiceInput } from '@/components/VoiceInput';

interface Repo {
  key: string;
  name: string;
  url: string;
  exists: boolean;
  path: string;
}

interface Worktree {
  repo: string;
  repoName: string;
  type: string;
  name: string;
  branch: string;
  path: string;
  fullPath: string;
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

export default function Home() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
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
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [aiGeneratedTask, setAiGeneratedTask] = useState<{
    title: string;
    branchName: string;
    description: string;
  } | null>(null);
  const [generatingTask, setGeneratingTask] = useState(false);

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

  const loadData = async () => {
    try {
      setLoading(true);
      const [reposRes, worktreesRes] = await Promise.all([
        fetch('/api/repos'),
        fetch('/api/worktrees')
      ]);
      
      const reposData = await reposRes.json();
      const worktreesData = await worktreesRes.json();
      
      setRepos(reposData.repos || []);
      setWorktrees(worktreesData.worktrees || []);
    } catch (error) {
      console.error('Failed to load data:', error);
      setMessage({ type: 'error', text: 'Failed to load data' });
    } finally {
      setLoading(false);
    }
  };

  const toggleRepo = (repoKey: string, event: React.MouseEvent) => {
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

  const handleCreate = async () => {
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

      const response = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repos: selectedRepos,
          type: selectedType,
          name: branchName.trim(),
          baseBranches: baseBranches
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

      const response = await fetch('/api/worktrees', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: worktreeToDelete.repo,
          type: worktreeToDelete.type,
          name: worktreeToDelete.name,
          path: worktreeToDelete.path
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete working tree');
      }

      setMessage({ type: 'success', text: `Working tree "${worktreeToDelete.branch}" deleted successfully` });
      
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

    if (selectedRepos.length === 0) {
      setMessage({ type: 'error', text: 'Please select at least one repository' });
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
          branchType: 'feat',
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
    if (!aiGeneratedTask || selectedRepos.length === 0) {
      setMessage({ type: 'error', text: 'Please complete all required fields' });
      return;
    }

    try {
      setCreating(true);
      setMessage(null);
      setCreatingProgress(null);
      setAiDialogOpen(false);

      // Remove the "feat-" prefix as the worktree API adds it
      const branchNameWithoutPrefix = aiGeneratedTask.branchName.replace(/^feat-/, '');

      const response = await fetch('/api/worktrees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repos: selectedRepos,
          type: 'feat',
          name: branchNameWithoutPrefix,
          baseBranches: baseBranches,
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
        messageText = `Successfully created ${successCount} working tree${successCount > 1 ? 's' : ''}${successCount > 1 ? ` in ${successCount} repositories` : ''} with AI-generated task: "${aiGeneratedTask.title}"`;
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <div>
              <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
                Repositories {selectedRepos.length > 0 && <span className="text-[var(--accent)]">({selectedRepos.length} selected)</span>}
              </label>
              <div className="border border-[var(--white-100)] rounded-lg p-3 bg-[var(--white)] max-h-48 overflow-y-auto shadow-sm mb-2">
                {repos.length === 0 ? (
                  <p className="text-sm text-[var(--foreground-muted)]">No repositories available</p>
                ) : (
                  <div className="space-y-2">
                    {repos.map((repo) => (
                      <label
                        key={repo.key}
                        className="flex items-center space-x-2 cursor-pointer hover:bg-[var(--white-50)] p-2 rounded transition-colors"
                        onClick={(e) => toggleRepo(repo.key, e)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedRepos.includes(repo.key)}
                          onChange={() => {}} // Handled by onClick
                          className="w-4 h-4 text-[var(--accent)] border-[var(--white-100)] rounded focus:ring-[var(--accent)] focus:ring-2"
                          disabled={creating}
                        />
                        <span className="text-sm text-[var(--foreground)] flex-1">
                          {REPO_DISPLAY_NAMES[repo.key] || repo.name} {repo.exists ? <CheckCircleIcon className="w-4 h-4 inline text-green-600" /> : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
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
                  // Open AI dialog when "feat" is selected
                  if (newType === 'feat') {
                    setAiDialogOpen(true);
                  }
                }}
                className="w-full px-4 py-2 border border-[var(--white-100)] rounded-lg bg-[var(--white)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-colors"
                disabled={creating}
              >
                <option value="">Select type...</option>
                <option value="feat">New Feature</option>
                <option value="bugs">Bug Fix</option>
                <option value="fixes">Fix</option>
                <option value="qaqc">QAQC</option>
              </select>
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
                  disabled={creating || generatingBranchName}
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
                    disabled={creating || generatingBranchName || selectedRepos.length === 0}
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
                      Path
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-[var(--foreground-muted)] uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-[var(--white)] divide-y divide-[var(--white-100)]">
                  {worktrees.map((wt, idx) => (
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
                      <td className="px-6 py-4 text-sm text-[var(--foreground-muted)] font-mono">
                        {wt.path}
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
                  ))}
                </tbody>
              </table>
            </div>
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
          <Dialog.Panel className="mx-auto max-w-2xl w-full rounded-lg bg-[var(--white)] p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <Dialog.Title className="text-xl font-semibold text-[var(--foreground)] mb-4">
              Create New Feature with AI
            </Dialog.Title>
            <Dialog.Description className="text-sm text-[var(--foreground-muted)] mb-6">
              Use your microphone to describe the feature you want to create. Our AI will generate the task title, branch name, and description.
            </Dialog.Description>

            {selectedRepos.length === 0 && (
              <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  Please select at least one repository before creating a feature.
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
                Feature Description
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
          </Dialog.Panel>
        </div>
      </Dialog>
    </>
  );
}
