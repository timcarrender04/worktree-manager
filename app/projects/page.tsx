'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
import Link from 'next/link'
import { Dialog } from '@headlessui/react'

interface Project {
  id: string
  name: string
  description: string | null
  github_account_id: string | null
  github_account: {
    account_name: string
    github_username: string | null
  } | null
  member_count: number
  repository_count: number
  owner_id: string
  owner: {
    id: string
    email: string
  } | null
  created_at: string
  updated_at: string
}

export default function ProjectsPage() {
  return <ProjectsContent />
}

interface GitHubAccount {
  id: string
  account_name: string
  github_username: string | null
  from_env?: boolean
}

function ProjectsContent() {
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectDescription, setProjectDescription] = useState('')
  const [selectedGitHubAccount, setSelectedGitHubAccount] = useState<string>('')
  const [githubAccounts, setGithubAccounts] = useState<GitHubAccount[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [selectedRepositories, setSelectedRepositories] = useState<string[]>([])
  const [availableRepositories, setAvailableRepositories] = useState<Array<{ full_name: string; name: string }>>([])
  const [loadingRepositories, setLoadingRepositories] = useState(false)

  useEffect(() => {
    fetchProjects()
  }, [])

  useEffect(() => {
    if (createDialogOpen) {
      fetchGitHubAccounts()
    }
  }, [createDialogOpen])

  useEffect(() => {
    if (selectedGitHubAccount && createDialogOpen) {
      fetchRepositories(selectedGitHubAccount)
    } else {
      setAvailableRepositories([])
      setSelectedRepositories([])
    }
  }, [selectedGitHubAccount, createDialogOpen])

  const fetchGitHubAccounts = async () => {
    setLoadingAccounts(true)
    try {
      const response = await fetch('/api/github-accounts')
      if (response.ok) {
        const data = await response.json()
        setGithubAccounts(data.accounts || [])
        // Auto-select env-default if available
        const envDefault = data.accounts?.find((acc: GitHubAccount) => acc.id === 'env-default')
        if (envDefault) {
          setSelectedGitHubAccount('env-default')
        }
      }
    } catch (err) {
      console.error('Failed to fetch GitHub accounts:', err)
    } finally {
      setLoadingAccounts(false)
    }
  }

  const fetchRepositories = async (accountId: string) => {
    if (accountId === 'env-default') {
      // For env-default, we can't fetch repos via API, so leave empty
      setAvailableRepositories([])
      return
    }

    setLoadingRepositories(true)
    try {
      const response = await fetch(`/api/github-accounts/${accountId}/repositories`)
      if (response.ok) {
        const data = await response.json()
        const repos = (data.repositories || []).map((repo: any) => ({
          full_name: repo.full_name,
          name: repo.name,
        }))
        setAvailableRepositories(repos)
      }
    } catch (err) {
      console.error('Failed to fetch repositories:', err)
      setAvailableRepositories([])
    } finally {
      setLoadingRepositories(false)
    }
  }

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      setError('Project name is required')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const repositories = selectedRepositories.map(repo => ({
        repository_full_name: repo,
      }))

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          description: projectDescription.trim() || null,
          github_account_id: selectedGitHubAccount || null,
          repositories: repositories.length > 0 ? repositories : undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create project')
      }

      const data = await response.json()
      
      // Close dialog and reset form
      setCreateDialogOpen(false)
      setProjectName('')
      setProjectDescription('')
      setSelectedGitHubAccount('')
      setSelectedRepositories([])
      setAvailableRepositories([])

      // Refresh projects list
      await fetchProjects()

      // Redirect to the new project
      if (data.project?.id) {
        window.location.href = `/projects/${data.project.id}`
      }
    } catch (error: any) {
      setError(error.message || 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  const fetchProjects = async () => {
    try {
      const response = await fetch('/api/projects')
      if (!response.ok) throw new Error('Failed to fetch projects')
      const data = await response.json()
      setProjects(data.projects || [])
    } catch (error: any) {
      setError(error.message || 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteProject = async (projectId: string, projectName: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (!confirm(`Are you sure you want to delete "${projectName}"? This action cannot be undone.`)) {
      return
    }

    try {
      setError(null) // Clear any previous errors
      const response = await fetch('/api/projects', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: projectId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete project')
      }

      // Success - refresh the projects list
      await fetchProjects()
      setError(null) // Clear error on success
    } catch (error: any) {
      console.error('Delete error:', error)
      setError(error.message || 'Failed to delete project')
      // Auto-clear error after 5 seconds
      setTimeout(() => setError(null), 5000)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12 px-4">
        <div className="text-base sm:text-lg lg:text-xl text-gray-600">Loading projects...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-6 lg:py-8">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 lg:px-6">
        <div className="mb-6 sm:mb-8 flex flex-col gap-3 sm:gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-black leading-tight">Projects</h1>
              <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm lg:text-base text-gray-600">
                Select a project to view its Kanban board
              </p>
            </div>
            <button
              onClick={() => setCreateDialogOpen(true)}
              className="px-4 sm:px-5 lg:px-6 py-2.5 sm:py-3 bg-blue-600 text-white text-sm sm:text-base font-semibold rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-md hover:shadow-lg whitespace-nowrap flex-shrink-0 touch-manipulation"
            >
              <span className="hidden sm:inline">+ Create Project</span>
              <span className="sm:hidden">+ Create</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 sm:p-4">
            <div className="text-xs sm:text-sm text-red-800 leading-relaxed">{error}</div>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="text-center text-gray-500 p-6 sm:p-8 bg-white rounded-xl shadow-md">
            <p className="text-base sm:text-lg font-medium mb-2 sm:mb-4">No projects found.</p>
            <p className="text-sm sm:text-base mb-4 sm:mb-6 text-gray-600">Create your first project to get started.</p>
            <button
              onClick={() => setCreateDialogOpen(true)}
              className="px-5 sm:px-6 py-2.5 sm:py-3 bg-blue-600 text-white text-sm sm:text-base font-semibold rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-md hover:shadow-lg touch-manipulation"
            >
              Create Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
            {projects.map((project) => (
              <div key={project.id} className="relative group bg-white rounded-xl shadow-md hover:shadow-xl active:shadow-lg transition-all duration-200 p-4 sm:p-5 lg:p-6 h-full flex flex-col">
                <Link href={`/projects/${project.id}`} className="block flex-1 min-w-0 touch-manipulation">
                  <div className="pr-8 sm:pr-10">
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2 sm:mb-3 leading-tight line-clamp-2">{project.name}</h2>
                    <p className="text-gray-600 text-xs sm:text-sm mb-3 sm:mb-4 line-clamp-3 leading-relaxed">
                      {project.description || 'No description provided.'}
                    </p>
                  </div>
                  <div className="mt-auto pt-3 sm:pt-4 border-t border-gray-100">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm text-gray-500">
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        <span className="font-medium">{project.member_count}</span>
                        <span className="hidden sm:inline">member{project.member_count !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <span className="font-medium">{project.repository_count}</span>
                        <span className="hidden sm:inline">repo{project.repository_count !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                  </div>
                </Link>
                <button
                  onClick={(e) => handleDeleteProject(project.id, project.name, e)}
                  className="absolute top-3 right-3 sm:top-4 sm:right-4 p-1.5 sm:p-2 text-gray-400 hover:text-red-600 active:text-red-700 hover:bg-red-50 active:bg-red-100 rounded-lg transition-all z-10 touch-manipulation"
                  title="Delete project"
                  aria-label={`Delete project: ${project.name}`}
                >
                  <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Project Dialog */}
      <Dialog open={createDialogOpen} onClose={() => {
        if (!creating) {
          setCreateDialogOpen(false)
          setProjectName('')
          setProjectDescription('')
          setSelectedGitHubAccount('')
          setSelectedRepositories([])
          setAvailableRepositories([])
          setError(null)
        }
      }} className="relative z-50">
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
        <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4 lg:p-6">
          <Dialog.Panel className="mx-auto max-w-2xl w-full sm:rounded-xl rounded-t-2xl bg-white p-4 sm:p-5 lg:p-6 shadow-2xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 pb-4 mb-4 sm:mb-6 -mx-4 sm:-mx-5 lg:-mx-6 px-4 sm:px-5 lg:px-6">
              <Dialog.Title className="text-xl sm:text-2xl font-semibold text-gray-900 mb-1.5 sm:mb-2">
                Create New Project
              </Dialog.Title>
              <Dialog.Description className="text-xs sm:text-sm text-gray-600 leading-relaxed">
                Create a new project to organize your worktrees and tasks. You can add repositories and team members later.
              </Dialog.Description>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 sm:p-4">
                <div className="text-xs sm:text-sm text-red-800 leading-relaxed">{error}</div>
              </div>
            )}

            <div className="space-y-4 sm:space-y-5">
              {/* Project Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g., My Awesome Project"
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors touch-manipulation"
                  disabled={creating}
                  autoFocus
                />
              </div>

              {/* Project Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                  Description
                </label>
                <textarea
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder="Optional description of your project"
                  rows={3}
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors resize-none touch-manipulation"
                  disabled={creating}
                />
              </div>

              {/* GitHub Account Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                  GitHub Account (Optional)
                </label>
                {loadingAccounts ? (
                  <div className="text-xs sm:text-sm text-gray-500 py-2">Loading accounts...</div>
                ) : (
                  <select
                    value={selectedGitHubAccount}
                    onChange={(e) => setSelectedGitHubAccount(e.target.value)}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white touch-manipulation"
                    disabled={creating}
                  >
                    <option value="">None (use default)</option>
                    {githubAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.account_name} {account.github_username && `(@${account.github_username})`}
                        {account.from_env && ' (from .env)'}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Repository Selection */}
              {selectedGitHubAccount && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5 sm:mb-2">
                    Repositories (Optional)
                  </label>
                  {loadingRepositories ? (
                    <div className="text-xs sm:text-sm text-gray-500 py-2">Loading repositories...</div>
                  ) : selectedGitHubAccount === 'env-default' ? (
                    <div className="text-xs sm:text-sm text-gray-600 bg-gray-50 p-3 sm:p-4 rounded-lg leading-relaxed">
                      Repository selection is not available for the default account. You can add repositories to the project after creation.
                    </div>
                  ) : availableRepositories.length === 0 ? (
                    <div className="text-xs sm:text-sm text-gray-500 py-2">No repositories found for this account.</div>
                  ) : (
                    <div className="border border-gray-300 rounded-lg p-2 sm:p-3 max-h-40 sm:max-h-48 overflow-y-auto">
                      {availableRepositories.map((repo) => (
                        <label key={repo.full_name} className="flex items-start sm:items-center gap-2 sm:gap-3 py-2 px-1 rounded hover:bg-gray-50 active:bg-gray-100 cursor-pointer touch-manipulation">
                          <input
                            type="checkbox"
                            checked={selectedRepositories.includes(repo.full_name)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedRepositories([...selectedRepositories, repo.full_name])
                              } else {
                                setSelectedRepositories(selectedRepositories.filter(r => r !== repo.full_name))
                              }
                            }}
                            className="mt-0.5 sm:mt-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 flex-shrink-0"
                            disabled={creating}
                          />
                          <span className="text-xs sm:text-sm text-gray-700 leading-relaxed break-words">{repo.full_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-gray-200 pt-4 sm:pt-5 mt-6 sm:mt-8 -mx-4 sm:-mx-5 lg:-mx-6 px-4 sm:px-5 lg:px-6 pb-2 sm:pb-0">
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 justify-end">
                <button
                  onClick={() => {
                    if (!creating) {
                      setCreateDialogOpen(false)
                      setProjectName('')
                      setProjectDescription('')
                      setSelectedGitHubAccount('')
                      setSelectedRepositories([])
                      setAvailableRepositories([])
                      setError(null)
                    }
                  }}
                  disabled={creating}
                  className="px-4 sm:px-5 py-2.5 sm:py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 active:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors touch-manipulation"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={creating || !projectName.trim()}
                  className="px-4 sm:px-5 py-2.5 sm:py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:bg-blue-800 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-md hover:shadow-lg touch-manipulation"
                >
                  {creating ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
  )
}
