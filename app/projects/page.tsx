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
  unread_chat_count?: number
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
  from_tokens_table?: boolean
  is_invalid?: boolean
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
        const accounts = (data.accounts || []) as GitHubAccount[]
        setGithubAccounts(accounts)

        if (!selectedGitHubAccount) {
          const firstValid = accounts.find((acc) => !acc.is_invalid)
          if (firstValid) {
            setSelectedGitHubAccount(firstValid.id)
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch GitHub accounts:', err)
    } finally {
      setLoadingAccounts(false)
    }
  }

  const fetchRepositories = async (accountId: string) => {
    const account = githubAccounts.find((acc) => acc.id === accountId)
    if (account?.is_invalid) {
      setAvailableRepositories([])
      setLoadingRepositories(false)
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

    if (selectedGitHubAccount) {
      const account = githubAccounts.find((acc) => acc.id === selectedGitHubAccount)
      if (account?.is_invalid) {
        setError('The selected GitHub account has an invalid token. Update it in Project Tim before using it.')
        return
      }
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

  const selectedAccount = githubAccounts.find((account) => account.id === selectedGitHubAccount)

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
      <div className="flex items-center justify-center h-full py-12 px-4">
        <div className="text-sm sm:text-base text-slate-600">Loading projects...</div>
      </div>
    )
  }

  return (
    <>
    <div className="flex flex-col h-full bg-slate-50">
      <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 mb-1">Projects</h1>
            <p className="text-xs text-slate-600 leading-relaxed">
              Select a project to view its Kanban board
            </p>
          </div>
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="px-4 sm:px-5 py-2 sm:py-2.5 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 active:bg-orange-700 transition-colors shadow-sm hover:shadow-md whitespace-nowrap flex-shrink-0"
          >
            <span className="hidden sm:inline">+ Create Project</span>
            <span className="sm:hidden">+ Create</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4">
            <div className="text-xs sm:text-sm text-red-700 leading-relaxed">{error}</div>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="text-4xl mb-3 opacity-50">📋</div>
            <p className="text-base sm:text-lg font-medium text-slate-900 mb-2">No projects found.</p>
            <p className="text-sm text-slate-600 mb-6">Create your first project to get started.</p>
            <button
              onClick={() => setCreateDialogOpen(true)}
              className="px-5 sm:px-6 py-2.5 sm:py-3 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 active:bg-orange-700 transition-colors shadow-sm hover:shadow-md"
            >
              Create Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 lg:gap-6">
            {projects.map((project) => (
              <div
                key={project.id}
                className="relative group bg-white border-2 rounded-xl md:rounded-lg p-4 sm:p-5 transition-all duration-200 hover:border-orange-400 hover:shadow-md hover:scale-[1.01] border-slate-200 flex flex-col"
              >
                <Link href={`/projects/${project.id}`} className="block flex-1 min-w-0">
                  <div className="pr-8 sm:pr-10">
                    <h2 className="font-semibold text-slate-900 text-sm sm:text-base mb-2 line-clamp-2">{project.name}</h2>
                    <p className="text-xs text-slate-600 mb-3 sm:mb-4 line-clamp-3 leading-relaxed">
                      {project.description || 'No description provided.'}
                    </p>
                  </div>
                  <div className="mt-auto pt-3 sm:pt-4 border-t border-slate-200">
                    <div className="flex items-center justify-between gap-x-4 gap-y-1.5 flex-wrap text-xs text-slate-600">
                      <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap">
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0 text-blue-700" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4Zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10c-2.29 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10Z"/>
                          </svg>
                          <span className="font-medium text-blue-800">{project.member_count}</span>
                          <span className="hidden sm:inline">member{project.member_count !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0 text-blue-700" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 0 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5zm10.5-1h-8a1 1 0 0 0 0 2h8.5z"/>
                          </svg>
                          <span className="font-medium text-blue-800">{project.repository_count}</span>
                          <span className="hidden sm:inline">repo{project.repository_count !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                      {project.unread_chat_count && project.unread_chat_count > 0 && (
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="flex items-center gap-1 bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs font-medium border border-blue-300">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                              <path d="M2.678 11.894a1 1 0 0 1 .287.801 10.97 10.97 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8.06 8.06 0 0 0 8 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 0 1-1.815-.133l-.01-.001a13.94 13.94 0 0 1-.516-.219 21.682 21.682 0 0 1-.713-.129z"/>
                            </svg>
                            <span>{project.unread_chat_count}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
                <button
                  onClick={(e) => handleDeleteProject(project.id, project.name, e)}
                  className="absolute top-2 right-2 sm:top-3 sm:right-3 p-1.5 text-slate-400 hover:text-red-600 active:text-red-700 hover:bg-red-50 active:bg-red-100 rounded-lg transition-all z-10 opacity-0 group-hover:opacity-100"
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
            <div className="sticky top-0 bg-white border-b border-slate-200 pb-4 mb-4 sm:mb-6 -mx-4 sm:-mx-5 lg:-mx-6 px-4 sm:px-5 lg:px-6">
              <Dialog.Title className="text-xl sm:text-2xl font-semibold text-slate-900 mb-1.5 sm:mb-2">
                Create New Project
              </Dialog.Title>
              <Dialog.Description className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                Create a new project to organize your worktrees and tasks. You can add repositories and team members later.
              </Dialog.Description>
            </div>

            {error && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 sm:p-4">
                <div className="text-xs sm:text-sm text-red-700 leading-relaxed">{error}</div>
              </div>
            )}

            <div className="space-y-4 sm:space-y-5">
              {/* Project Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5 sm:mb-2">
                  Project Name *
                </label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g., My Awesome Project"
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors"
                  disabled={creating}
                  autoFocus
                />
              </div>

              {/* Project Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5 sm:mb-2">
                  Description
                </label>
                <textarea
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  placeholder="Optional description of your project"
                  rows={3}
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors resize-none"
                  disabled={creating}
                />
              </div>

              {/* GitHub Account Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5 sm:mb-2">
                  GitHub Account (Optional)
                </label>
                {loadingAccounts ? (
                  <div className="text-xs sm:text-sm text-slate-500 py-2">Loading accounts...</div>
                ) : (
                  <select
                    value={selectedGitHubAccount}
                    onChange={(e) => setSelectedGitHubAccount(e.target.value)}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-sm sm:text-base border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 bg-white"
                    disabled={creating}
                  >
                    <option value="">None (use default)</option>
                    {githubAccounts.map((account) => (
                      <option
                        key={account.id}
                        value={account.id}
                        disabled={account.is_invalid}
                      >
                        {account.account_name}
                        {account.github_username && !account.is_invalid ? ` (@${account.github_username})` : ''}
                        {account.from_tokens_table ? ' • token' : ''}
                        {account.is_invalid ? ' • invalid' : ''}
                      </option>
                    ))}
                  </select>
                )}
                {!loadingAccounts && githubAccounts.length === 0 && (
                  <p className="mt-2 text-xs sm:text-sm text-slate-500">
                    No GitHub accounts found. Add an account in Project Tim to enable repository linking.
                  </p>
                )}
              </div>

              {/* Repository Selection */}
              {selectedGitHubAccount && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5 sm:mb-2">
                    Repositories (Optional)
                  </label>
                  {loadingRepositories ? (
                    <div className="text-xs sm:text-sm text-slate-500 py-2">Loading repositories...</div>
                  ) : selectedAccount?.is_invalid ? (
                    <div className="text-xs sm:text-sm text-red-600 bg-red-50 border border-red-200 p-3 sm:p-4 rounded-lg leading-relaxed">
                      This token is marked as invalid. Update the account in Project Tim before linking repositories.
                    </div>
                  ) : availableRepositories.length === 0 ? (
                    <div className="text-xs sm:text-sm text-slate-500 py-2">No repositories found for this account.</div>
                  ) : (
                    <div className="border border-slate-300 rounded-lg p-2 sm:p-3 max-h-40 sm:max-h-48 overflow-y-auto">
                      {availableRepositories.map((repo) => (
                        <label key={repo.full_name} className="flex items-start sm:items-center gap-2 sm:gap-3 py-2 px-1 rounded hover:bg-slate-50 active:bg-slate-100 cursor-pointer">
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
                            className="mt-0.5 sm:mt-0 rounded border-slate-300 text-orange-500 focus:ring-orange-500 focus:ring-2 flex-shrink-0"
                            disabled={creating}
                          />
                          <span className="text-xs sm:text-sm text-slate-700 leading-relaxed break-words">{repo.full_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 pt-4 sm:pt-5 mt-6 sm:mt-8 -mx-4 sm:-mx-5 lg:-mx-6 px-4 sm:px-5 lg:px-6 pb-2 sm:pb-0">
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
                  className="px-4 sm:px-5 py-2.5 sm:py-2.5 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 active:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={creating || !projectName.trim()}
                  className="px-4 sm:px-5 py-2.5 sm:py-2.5 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 active:bg-orange-700 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md"
                >
                  {creating ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </div>
    </>
  )
}
