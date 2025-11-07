import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createGitHubClient } from '@/lib/github/client'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    // Check if using Neon (direct database) or local dev
    // Prioritize Neon if DATABASE_URL is set (even if Supabase is also configured)
    const isUsingNeon = !!process.env.DATABASE_URL
    const isLocalDev = !isUsingNeon && (
      process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost') || 
      process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1')
    )

    let account: { id: string; encrypted_token: string } | null = null
    let userId: string | null = null

    if (isUsingNeon || (isLocalDev && process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      // Use direct database connection for Neon or local dev
      try {
        // For local dev, set default connection params if not set
        if (isLocalDev && !process.env.DATABASE_URL && !process.env.PGHOST) {
          process.env.PGHOST = 'localhost'
          process.env.PGPORT = '5433'
          process.env.PGUSER = 'postgres'
          process.env.PGPASSWORD = process.env.POSTGRES_PASSWORD || 'postgres'
          process.env.PGDATABASE = 'repo_hub'
        }
        
        const { query } = await import('@/lib/db/client')
        // Use 'dev' user_id for development mode
        userId = 'dev'
        
        const result = await query(
          `SELECT id, encrypted_token 
           FROM github_accounts 
           WHERE id = $1 AND user_id = $2`,
          [id, userId]
        )
        
        if (result.rows.length > 0) {
          account = result.rows[0]
        }
      } catch (error: any) {
        console.warn('Error fetching GitHub account from database:', error.message)
      }
    } else {
      // Use Supabase client for remote Supabase
      const supabase = await createClient()
      
      // Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (!authError && user) {
        userId = user.id
      } else if (process.env.NODE_ENV === 'development') {
        // DEV: In dev mode, allow 'dev' user
        userId = 'dev'
      } else {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }

      // Get GitHub account (RLS will ensure user can only access their own)
      const { data: dbAccount, error: accountError } = await supabase
        .from('github_accounts')
        .select('id, encrypted_token')
        .eq('id', id)
        .eq('user_id', userId)
        .single()

      if (!accountError && dbAccount) {
        account = dbAccount
      }
    }

    if (!account) {
      return NextResponse.json(
        { error: 'GitHub account not found' },
        { status: 404 }
      )
    }

    // Get repositories using the GitHub token - fetch ALL repos dynamically
    const githubClient = createGitHubClient(account.encrypted_token)
    
    // Fetch all repositories dynamically with pagination
    const allRepositories: any[] = []
    const repoMap = new Map<number, any>() // Use ID to deduplicate
    
    const headers = {
      'Authorization': `Bearer ${account.encrypted_token}`,
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

