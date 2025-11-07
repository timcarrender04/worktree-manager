import { NextResponse } from 'next/server'
import { query } from '@/lib/db/client'
import { createGitHubClient } from '@/lib/github/client'
import { getAuthenticatedUserId } from '@/lib/credentials/helpers'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    let userId = await getAuthenticatedUserId()

    if (!userId) {
      if (process.env.NODE_ENV === 'development') {
        userId = 'dev'
      } else {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
    }

    let token: string | null = null

    if (id.startsWith('token-')) {
      const tokenId = id.replace('token-', '')

      try {
        const tokenResult = await query(
          `SELECT value FROM tokens WHERE id = $1`,
          [tokenId]
        )

        if (tokenResult.rows.length === 0) {
          return NextResponse.json(
            { error: 'Token not found' },
            { status: 404 }
          )
        }

        token = tokenResult.rows[0].value
      } catch (tokenError: any) {
        console.error('Error fetching token value:', tokenError)
        return NextResponse.json(
          { error: 'Failed to fetch token' },
          { status: 500 }
        )
      }
    } else {
      const accountResult = await query(
        `SELECT encrypted_token
         FROM github_accounts
         WHERE id = $1 AND user_id = $2`,
        [id, userId]
      )

      if (accountResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'GitHub account not found' },
          { status: 404 }
        )
      }

      token = accountResult.rows[0].encrypted_token
    }

    if (!token) {
      return NextResponse.json(
        { error: 'No token available' },
        { status: 400 }
      )
    }

    // Get repositories using the GitHub token - fetch ALL repos dynamically
    const githubClient = createGitHubClient(token)
    
    // Fetch all repositories dynamically with pagination
    const allRepositories: any[] = []
    const repoMap = new Map<number, any>() // Use ID to deduplicate
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
    
    try {
      // Fetch all user repositories with pagination (includes all repos user has access to)
      let page = 1
      let hasMore = true
      const perPage = 100
      
      while (hasMore) {
        const url = `https://api.github.com/user/repos?type=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`
        const response = await fetch(url, { headers })
        
        if (!response.ok) {
          throw new Error(`Failed to fetch repositories: ${response.status} ${response.statusText}`)
        }
        
        const repos = await response.json()
        
        if (repos.length === 0) {
          hasMore = false
        } else {
          repos.forEach((repo: any) => {
            repoMap.set(repo.id, repo)
          })
          
          // Check if there are more pages
          const linkHeader = response.headers.get('link')
          if (linkHeader && linkHeader.includes('rel="next"')) {
            page++
          } else {
            hasMore = false
          }
        }
        
        // Safety limit to prevent infinite loops
        if (page > 100) {
          console.warn('Reached pagination limit (100 pages)')
          hasMore = false
        }
      }
      
      // Convert map to array and sort by updated date
      allRepositories.push(...Array.from(repoMap.values()))
      allRepositories.sort((a, b) => {
        const dateA = new Date(a.updated_at || a.pushed_at || 0).getTime()
        const dateB = new Date(b.updated_at || b.pushed_at || 0).getTime()
        return dateB - dateA // Descending order
      })
      
      console.log(`Fetched ${allRepositories.length} repositories dynamically`)
      
    } catch (error) {
      console.error('Error fetching repositories:', error)
      throw error
    }

    return NextResponse.json({ repositories: allRepositories })
  } catch (error: any) {
    console.error('Error in GET /api/github-accounts/[id]/repositories:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch repositories' },
      { status: 500 }
    )
  }
}

