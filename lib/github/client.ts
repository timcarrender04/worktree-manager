/**
 * GitHub API client wrapper
 * Supports multiple GitHub accounts with per-account token management
 */

export interface GitHubRepository {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  html_url: string
  default_branch: string
}

export interface GitHubIssue {
  id: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed'
  labels: Array<{ name: string; color: string }>
  assignees: Array<{ login: string; avatar_url: string }>
  html_url: string
  created_at: string
  updated_at: string
}

export interface GitHubPullRequest {
  id: number
  number: number
  title: string
  body: string | null
  state: 'open' | 'closed' | 'merged'
  head: {
    ref: string
    sha: string
  }
  base: {
    ref: string
  }
  merged: boolean
  merged_at: string | null
  html_url: string
  created_at: string
  updated_at: string
}

export interface GitHubUser {
  login: string
  id: number
  avatar_url: string
  name: string | null
}

/**
 * Create a GitHub API client with a specific token
 */
export function createGitHubClient(token: string) {
  const baseUrl = 'https://api.github.com'
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  return {
    /**
     * Get the authenticated user
     */
    async getAuthenticatedUser(): Promise<GitHubUser> {
      const response = await fetch(`${baseUrl}/user`, { headers })
      if (!response.ok) {
        throw new Error(`Failed to get user: ${response.status} ${response.statusText}`)
      }
      return response.json()
    },

    /**
     * Validate the token by checking if it can access the user endpoint
     */
    async validateToken(): Promise<boolean> {
      try {
        await this.getAuthenticatedUser()
        return true
      } catch {
        return false
      }
    },

    /**
     * List repositories for the authenticated user
     */
    async listRepositories(options?: {
      type?: 'all' | 'owner' | 'member'
      sort?: 'created' | 'updated' | 'pushed' | 'full_name'
      direction?: 'asc' | 'desc'
      per_page?: number
      page?: number
    }): Promise<GitHubRepository[]> {
      const params = new URLSearchParams()
      if (options?.type) params.append('type', options.type)
      if (options?.sort) params.append('sort', options.sort)
      if (options?.direction) params.append('direction', options.direction)
      if (options?.per_page) params.append('per_page', options.per_page.toString())
      if (options?.page) params.append('page', options.page.toString())

      const url = `${baseUrl}/user/repos?${params.toString()}`
      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`Failed to list repositories: ${response.status} ${response.statusText}`)
      }
      return response.json()
    },

    /**
     * Get issues for a repository
     */
    async getRepositoryIssues(
      owner: string,
      repo: string,
      options?: {
        state?: 'open' | 'closed' | 'all'
        labels?: string
        per_page?: number
        page?: number
      }
    ): Promise<GitHubIssue[]> {
      const params = new URLSearchParams()
      if (options?.state) params.append('state', options.state)
      if (options?.labels) params.append('labels', options.labels)
      if (options?.per_page) params.append('per_page', options.per_page.toString())
      if (options?.page) params.append('page', options.page.toString())

      const url = `${baseUrl}/repos/${owner}/${repo}/issues?${params.toString()}`
      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`Failed to get issues: ${response.status} ${response.statusText}`)
      }
      return response.json()
    },

    /**
     * Get pull requests for a repository
     */
    async getRepositoryPullRequests(
      owner: string,
      repo: string,
      options?: {
        state?: 'open' | 'closed' | 'all'
        head?: string
        base?: string
        per_page?: number
        page?: number
      }
    ): Promise<GitHubPullRequest[]> {
      const params = new URLSearchParams()
      if (options?.state) params.append('state', options.state)
      if (options?.head) params.append('head', options.head)
      if (options?.base) params.append('base', options.base)
      if (options?.per_page) params.append('per_page', options.per_page.toString())
      if (options?.page) params.append('page', options.page.toString())

      const url = `${baseUrl}/repos/${owner}/${repo}/pulls?${params.toString()}`
      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`Failed to get pull requests: ${response.status} ${response.statusText}`)
      }
      return response.json()
    },

    /**
     * Get a specific pull request
     */
    async getPullRequest(owner: string, repo: string, prNumber: number): Promise<GitHubPullRequest> {
      const url = `${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`
      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`Failed to get pull request: ${response.status} ${response.statusText}`)
      }
      return response.json()
    },

    /**
     * Check if a branch exists
     */
    async branchExists(owner: string, repo: string, branch: string): Promise<boolean> {
      const url = `${baseUrl}/repos/${owner}/${repo}/branches/${branch}`
      const response = await fetch(url, { headers })
      return response.ok
    },

    /**
     * Get repository information
     */
    async getRepository(owner: string, repo: string): Promise<GitHubRepository> {
      const url = `${baseUrl}/repos/${owner}/${repo}`
      const response = await fetch(url, { headers })
      if (!response.ok) {
        throw new Error(`Failed to get repository: ${response.status} ${response.statusText}`)
      }
      return response.json()
    },

    /**
     * Create a branch from a base branch
     */
    async createBranch(owner: string, repo: string, branchName: string, baseBranch: string): Promise<void> {
      // First, get the SHA of the base branch
      const baseBranchResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/ref/heads/${baseBranch}`, { headers })
      if (!baseBranchResponse.ok) {
        throw new Error(`Failed to get base branch: ${baseBranchResponse.status} ${baseBranchResponse.statusText}`)
      }
      const baseBranchData = await baseBranchResponse.json()
      const sha = baseBranchData.object.sha

      // Create the new branch
      const createResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/refs`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: sha,
        }),
      })

      if (!createResponse.ok) {
        const errorData = await createResponse.json().catch(() => ({}))
        throw new Error(`Failed to create branch: ${createResponse.status} ${errorData.message || createResponse.statusText}`)
      }
    },

    /**
     * Delete a branch
     */
    async deleteBranch(owner: string, repo: string, branchName: string): Promise<boolean> {
      const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/git/refs/heads/${branchName}`, {
        method: 'DELETE',
        headers,
      })
      
      // 204 = success, 404 = branch doesn't exist (consider success)
      return response.ok || response.status === 404
    },
  }
}

