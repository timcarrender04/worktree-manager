import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'
import { cookies } from 'next/headers'

// Helper to get authenticated user from session cookie
async function getAuthenticatedUser(): Promise<{ id: string; email: string } | null> {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get('wt_session')

    if (!sessionToken) {
      return null
    }

    try {
      // Decode the session token
      const sessionData = JSON.parse(Buffer.from(sessionToken.value, 'base64').toString())
      
      // Check if token is expired
      if (sessionData.exp && Date.now() > sessionData.exp) {
        return null
      }

      return {
        id: sessionData.userId,
        email: sessionData.email || '',
      }
    } catch (error) {
      // Invalid token
      return null
    }
  } catch (error) {
    console.error('[DEBUG] Error getting authenticated user:', error)
    return null
  }
}

export async function GET(request: Request) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const repository = searchParams.get('repository')
    
    // Get authenticated user
    const authenticatedUser = await getAuthenticatedUser()
    console.log('[DEBUG] /api/projects - authenticated user:', authenticatedUser?.email || 'none', 'ID:', authenticatedUser?.id || 'none')
    
    // Check if we should use Neon or Supabase
    // Prioritize local Supabase if detected, otherwise use Neon if DATABASE_URL is set
    const isDevelopment = process.env.NODE_ENV === 'development'
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const isLocalSupabase = supabaseUrl?.includes('localhost') || supabaseUrl?.includes('127.0.0.1') || supabaseUrl?.includes(':8002')
    const isUsingNeon = !!process.env.DATABASE_URL && !isLocalSupabase
    
    console.log('[DEBUG] /api/projects - isUsingNeon:', isUsingNeon)
    console.log('[DEBUG] /api/projects - DATABASE_URL set:', !!process.env.DATABASE_URL)
    console.log('[DEBUG] /api/projects - NEXT_PUBLIC_SUPABASE_URL set:', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
    console.log('[DEBUG] /api/projects - isDevelopment:', isDevelopment)
    console.log('[DEBUG] /api/projects - isLocalSupabase:', isLocalSupabase)
    console.log('[DEBUG] /api/projects - supabaseUrl:', supabaseUrl)
    
    if (isUsingNeon) {
      // For Neon, query directly using PostgreSQL
      try {
        // Build query with user filter (projects user owns or is a member of)
        let querySql = `
          SELECT DISTINCT
            p.id,
            p.name,
            p.description,
            p.github_account_id,
            p.owner_id,
            p.created_at,
            p.updated_at,
            CASE 
              WHEN ga.id IS NOT NULL THEN jsonb_build_object(
                'account_name', ga.account_name,
                'github_username', ga.github_username
              )
              ELSE NULL
            END as github_account,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'user_id', pm.user_id,
                'role', pm.role
              ))
              FROM project_members pm
              WHERE pm.project_id = p.id
            ), '[]'::jsonb) as project_members,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', pr.id,
                'repository_full_name', pr.repository_full_name,
                'github_account_id', pr.github_account_id
              ))
              FROM project_repositories pr
              WHERE pr.project_id = p.id
            ), '[]'::jsonb) as project_repositories,
            COALESCE((
              SELECT COUNT(*)
              FROM user_chat_notifications ucn
              WHERE ucn.project_id = p.id
              ${authenticatedUser ? `AND ucn.user_id = $1` : 'AND FALSE'}
              AND ucn.is_read = FALSE
            ), 0) as unread_chat_count
          FROM projects p
          LEFT JOIN github_accounts ga ON p.github_account_id = ga.id
          LEFT JOIN project_members pm ON pm.project_id = p.id
        `
        
        const queryParams: any[] = []
        const conditions: string[] = []
        
        // Filter by user if authenticated
        if (authenticatedUser) {
          queryParams.push(authenticatedUser.id)
          conditions.push(`(p.owner_id = $1 OR pm.user_id = $1)`)
        }
        
        // Add repository filter if provided
        if (repository) {
          conditions.push(`EXISTS (
            SELECT 1 FROM project_repositories pr
            WHERE pr.project_id = p.id
            AND pr.repository_full_name = $${queryParams.length + 1}
          )`)
          queryParams.push(repository)
        }
        
        if (conditions.length > 0) {
          querySql += ` WHERE ${conditions.join(' AND ')}`
        }
        
        querySql += ` ORDER BY p.created_at DESC`
        
        const projectsResult = await query(querySql, queryParams)

        console.log('[DEBUG] Neon query result - rowCount:', projectsResult?.rowCount || 0)

        if (!projectsResult || !projectsResult.rows) {
          return NextResponse.json({ projects: [] })
        }

        // Transform the data to include counts and simplify structure
        // pg library automatically parses JSON/JSONB columns
        const projectsWithCounts = projectsResult.rows.map((project: any) => {
          // Handle JSON parsing - pg should parse it, but handle both cases
          const members = Array.isArray(project.project_members) 
            ? project.project_members 
            : (typeof project.project_members === 'string' 
                ? JSON.parse(project.project_members) 
                : []);
          const repositories = Array.isArray(project.project_repositories)
            ? project.project_repositories
            : (typeof project.project_repositories === 'string'
                ? JSON.parse(project.project_repositories)
                : []);

          return {
            id: project.id,
            name: project.name,
            description: project.description,
            github_account_id: project.github_account_id,
            github_account: project.github_account && project.github_account.account_name 
              ? project.github_account 
              : null,
            owner_id: project.owner_id,
            member_count: members.length,
            repository_count: repositories.length,
            unread_chat_count: parseInt(project.unread_chat_count) || 0,
            created_at: project.created_at,
            updated_at: project.updated_at,
          };
        });

        return NextResponse.json({ projects: projectsWithCounts })
      } catch (error: any) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        const errorCode = (error as any)?.code
        
        // Log detailed error information
        console.error('Error querying Neon for projects:', {
          message: errorMessage,
          code: errorCode,
          isTimeout: errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout'),
          stack: error instanceof Error ? error.stack : undefined,
        })
        
        // For timeout errors, provide a helpful message
        if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout')) {
          console.warn('Neon database connection timed out. This may happen if the database is paused. It will wake up on the next successful connection.')
        }
        
        // Return empty array to prevent breaking the UI
        return NextResponse.json({ projects: [] })
      }
    }

    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn('[DEBUG] Neither DATABASE_URL nor Supabase configured. Returning empty projects list.')
      return NextResponse.json({ projects: [] })
    }

    console.log('[DEBUG] Using Supabase path')
    
    const supabase = await createClient()
    
    // Use service role client to bypass RLS when:
    // 1. No authenticated user (for development/testing)
    // 2. User is a super admin (to bypass RLS and see all projects)
    let clientToUse = supabase
    let shouldUseServiceRole = false
    
    if (!authenticatedUser) {
      console.log('[DEBUG] No authenticated user - attempting to use service role client to bypass RLS')
      shouldUseServiceRole = true
    } else {
      // Check if user is super admin using service role client (to bypass RLS for the check)
      try {
        const { createServiceRoleClient } = await import('@/lib/supabase/server')
        const serviceClient = createServiceRoleClient()
        
        const { data, error } = await serviceClient
          .from('user_roles')
          .select('is_super_admin')
          .eq('user_id', authenticatedUser.id)
          .maybeSingle()
        
        if (error) {
          console.warn('[DEBUG] Error checking super admin status via Supabase, trying direct PostgreSQL:', error?.message)
          // Fallback to direct PostgreSQL
          try {
            const { query } = await import('@/lib/db/client')
            const roleResult = await query<{ is_super_admin: boolean }>(
              'SELECT is_super_admin FROM user_roles WHERE user_id = $1',
              [authenticatedUser.id]
            )
            
            if (roleResult.rows.length > 0 && roleResult.rows[0].is_super_admin === true) {
              console.log('[DEBUG] User is super admin (via direct PostgreSQL) - using service role client to bypass RLS')
              shouldUseServiceRole = true
            } else {
              console.log('[DEBUG] User is not super admin - using regular Supabase client')
            }
          } catch (pgError: any) {
            console.warn('[DEBUG] Could not check super admin status via PostgreSQL:', pgError?.message)
            // Continue with regular client
          }
        } else if (data?.is_super_admin === true) {
          console.log('[DEBUG] User is super admin - using service role client to bypass RLS')
          shouldUseServiceRole = true
        } else {
          console.log('[DEBUG] User is not super admin - using regular Supabase client')
          console.log('[DEBUG] User ID:', authenticatedUser.id, 'Super admin status:', data?.is_super_admin || false)
        }
      } catch (error: any) {
        console.warn('[DEBUG] Could not check super admin status:', error?.message)
        // Continue with regular client
      }
    }
    
    if (shouldUseServiceRole) {
      console.log('[DEBUG] SUPABASE_SERVICE_ROLE_KEY set:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
      console.log('[DEBUG] NEXT_PUBLIC_SUPABASE_ANON_KEY set:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      try {
        const { createServiceRoleClient } = await import('@/lib/supabase/server')
        clientToUse = createServiceRoleClient()
        console.log('[DEBUG] Service role client created successfully')
        console.log('[DEBUG] Service role client URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
        // Test the service role client by making a simple query
        const { data: testData, error: testError } = await clientToUse
          .from('projects')
          .select('id')
          .limit(1)
        console.log('[DEBUG] Service role client test - can access projects:', !testError, 'error:', testError?.message || 'none')
      } catch (error: any) {
        console.warn('[DEBUG] Could not create service role client:', error?.message)
        console.warn('[DEBUG] Error details:', error)
        // Continue with regular client - will return empty due to RLS
      }
    }
    // If repository filter is provided, first get project IDs that contain this repository
    let filteredProjectIds: string[] | null = null
    if (repository) {
      const { data: projectRepos, error: repoError } = await clientToUse
        .from('project_repositories')
        .select('project_id')
        .eq('repository_full_name', repository)
      
      if (repoError) {
        console.error('[DEBUG] Error fetching projects by repository:', repoError)
        return NextResponse.json({ projects: [] })
      }
      
      filteredProjectIds = (projectRepos?.map((pr: any) => pr.project_id) ?? []) as string[]
      if (filteredProjectIds.length === 0) {
        return NextResponse.json({ projects: [] })
      }
    }
    
    // Query projects without nested relationships first (Supabase RLS might block nested queries)
    let projectsQuery = clientToUse
      .from('projects')
      .select(`
        id,
        name,
        description,
        github_account_id,
        owner_id,
        created_at,
        updated_at
      `)
    
    // Filter by authenticated user (projects they own or are members of)
    // If no authenticated user and using service role, get all projects
    if (authenticatedUser) {
      // Get project IDs where user is a member
      const { data: memberProjects } = await clientToUse
        .from('project_members')
        .select('project_id')
        .eq('user_id', authenticatedUser.id)
      
      const memberProjectIds = memberProjects?.map((mp: any) => mp.project_id) || []
      
      // Filter: owner_id = user.id OR project_id IN memberProjectIds
      if (memberProjectIds.length > 0) {
        projectsQuery = projectsQuery.or(`owner_id.eq.${authenticatedUser.id},id.in.(${memberProjectIds.join(',')})`)
      } else {
        projectsQuery = projectsQuery.eq('owner_id', authenticatedUser.id)
      }
    }
    // If no authenticated user, service role client will return all projects (bypasses RLS)
    
    // Filter by project IDs if repository filter was provided
    if (filteredProjectIds && filteredProjectIds.length > 0) {
      projectsQuery = projectsQuery.in('id', filteredProjectIds)
    }
    
    const { data: projects, error } = await projectsQuery.order('created_at', { ascending: false })

    console.log('[DEBUG] Projects query result - count:', projects?.length || 0, 'error:', error?.message || 'none')
    if (error) {
      console.error('[DEBUG] Error fetching projects via Supabase:', error)
      console.error('[DEBUG] Error details:', JSON.stringify(error, null, 2))
      
      // If permission denied and we're using service role, fallback to direct PostgreSQL
      if (error.message?.includes('permission denied') && shouldUseServiceRole) {
        console.log('[DEBUG] Permission denied with service role, falling back to direct PostgreSQL')
        try {
          // Build query with user filter (projects user owns or is a member of)
          let querySql = `
            SELECT DISTINCT
              p.id,
              p.name,
              p.description,
              p.github_account_id,
              p.owner_id,
              p.created_at,
              p.updated_at,
              CASE 
                WHEN ga.id IS NOT NULL THEN jsonb_build_object(
                  'account_name', ga.account_name,
                  'github_username', ga.github_username
                )
                ELSE NULL
              END as github_account,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'user_id', pm.user_id,
                  'role', pm.role
                ))
                FROM project_members pm
                WHERE pm.project_id = p.id
              ), '[]'::jsonb) as project_members,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', pr.id,
                  'repository_full_name', pr.repository_full_name,
                  'github_account_id', pr.github_account_id
                ))
                FROM project_repositories pr
                WHERE pr.project_id = p.id
              ), '[]'::jsonb) as project_repositories,
              COALESCE((
                SELECT COUNT(*)
                FROM user_chat_notifications ucn
                WHERE ucn.project_id = p.id
                ${authenticatedUser && !shouldUseServiceRole ? `AND ucn.user_id = $1` : 'AND FALSE'}
                AND ucn.is_read = FALSE
              ), 0) as unread_chat_count
            FROM projects p
            LEFT JOIN github_accounts ga ON p.github_account_id = ga.id
            LEFT JOIN project_members pm ON pm.project_id = p.id
          `
          
          const queryParams: any[] = []
          const conditions: string[] = []
          
          // For super admin (shouldUseServiceRole = true), don't filter by user (get all projects)
          // For regular users, filter by ownership or membership
          if (authenticatedUser && !shouldUseServiceRole) {
            queryParams.push(authenticatedUser.id)
            conditions.push(`(p.owner_id = $1 OR pm.user_id = $1)`)
          }
          // If shouldUseServiceRole is true, we don't add user filter (get all projects for super admin)
          
          // Add repository filter if provided
          if (repository) {
            conditions.push(`EXISTS (
              SELECT 1 FROM project_repositories pr
              WHERE pr.project_id = p.id
              AND pr.repository_full_name = $${queryParams.length + 1}
            )`)
            queryParams.push(repository)
          }
          
          if (conditions.length > 0) {
            querySql += ` WHERE ${conditions.join(' AND ')}`
          }
          
          querySql += ` ORDER BY p.created_at DESC`
          
          const projectsResult = await query(querySql, queryParams)
          
          if (!projectsResult || !projectsResult.rows) {
            return NextResponse.json({ projects: [] })
          }
          
          // Transform the data
          const projectsWithCounts = projectsResult.rows.map((project: any) => {
            const members = Array.isArray(project.project_members) 
              ? project.project_members 
              : (typeof project.project_members === 'string' 
                  ? JSON.parse(project.project_members) 
                  : []);
            const repositories = Array.isArray(project.project_repositories)
              ? project.project_repositories
              : (typeof project.project_repositories === 'string'
                  ? JSON.parse(project.project_repositories)
                  : []);

            return {
              id: project.id,
              name: project.name,
              description: project.description,
              github_account_id: project.github_account_id,
              github_account: project.github_account && project.github_account.account_name 
                ? project.github_account 
                : null,
              owner_id: project.owner_id,
              member_count: members.length,
              repository_count: repositories.length,
              unread_chat_count: parseInt(project.unread_chat_count) || 0,
              created_at: project.created_at,
              updated_at: project.updated_at,
            };
          });

          return NextResponse.json({ projects: projectsWithCounts })
        } catch (pgError: any) {
          console.error('[DEBUG] Error fetching projects via direct PostgreSQL:', pgError)
          return NextResponse.json(
            { error: 'Failed to fetch projects', details: pgError.message },
            { status: 500 }
          )
        }
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch projects', details: error.message },
        { status: 500 }
      )
    }

    if (!projects || projects.length === 0) {
      return NextResponse.json({ projects: [] })
    }

    // Fetch related data separately
    const projectIds = projects.map((p: any) => p.id)
    const githubAccountIds = projects
      .map((p: any) => p.github_account_id)
      .filter((id: any) => id) as string[]

    // Fetch github accounts
    let githubAccountsMap: Record<string, any> = {}
    if (githubAccountIds.length > 0) {
      const { data: githubAccounts } = await clientToUse
        .from('github_accounts')
        .select('id, account_name, github_username')
        .in('id', githubAccountIds)
      
      if (githubAccounts) {
        githubAccountsMap = githubAccounts.reduce((acc: any, account: any) => {
          acc[account.id] = account
          return acc
        }, {})
      }
    }

    // Fetch project members
    const { data: projectMembers } = await clientToUse
      .from('project_members')
      .select('project_id, user_id, role')
      .in('project_id', projectIds.length > 0 ? projectIds : [])
    
    const membersByProject: Record<string, any[]> = {}
    if (projectMembers) {
      projectMembers.forEach((member: any) => {
        if (!membersByProject[member.project_id]) {
          membersByProject[member.project_id] = []
        }
        membersByProject[member.project_id].push(member)
      })
    }

    // Fetch project repositories
    const { data: projectRepos } = await clientToUse
      .from('project_repositories')
      .select('project_id, id, repository_full_name, github_account_id')
      .in('project_id', projectIds.length > 0 ? projectIds : [])
    
    const reposByProject: Record<string, any[]> = {}
    if (projectRepos) {
      projectRepos.forEach((repo: any) => {
        if (!reposByProject[repo.project_id]) {
          reposByProject[repo.project_id] = []
        }
        reposByProject[repo.project_id].push(repo)
      })
    }

    // Fetch unread chat notifications
    const unreadChatCountsByProject: Record<string, number> = {}
    if (authenticatedUser && projectIds.length > 0) {
      const { data: unreadChatNotifications } = await clientToUse
        .from('user_chat_notifications')
        .select('project_id')
        .in('project_id', projectIds)
        .eq('user_id', authenticatedUser.id)
        .eq('is_read', false)
      
      if (unreadChatNotifications) {
        unreadChatNotifications.forEach((notification: any) => {
          unreadChatCountsByProject[notification.project_id] = 
            (unreadChatCountsByProject[notification.project_id] || 0) + 1
        })
      }
    }

    // Transform the data to include counts and simplify structure
    const projectsWithCounts = projects.map((project: any) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      github_account_id: project.github_account_id,
      github_account: project.github_account_id && githubAccountsMap[project.github_account_id] ? {
        account_name: githubAccountsMap[project.github_account_id].account_name,
        github_username: githubAccountsMap[project.github_account_id].github_username,
      } : null,
      owner_id: project.owner_id,
      member_count: membersByProject[project.id]?.length || 0,
      repository_count: reposByProject[project.id]?.length || 0,
      unread_chat_count: unreadChatCountsByProject[project.id] || 0,
      created_at: project.created_at,
      updated_at: project.updated_at,
    }))

    return NextResponse.json({ projects: projectsWithCounts })
  } catch (error: any) {
    console.error('Error in GET /api/projects:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, description, github_account_id, repositories } = body

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Project name is required' },
        { status: 400 }
      )
    }

    // Check if Neon (DATABASE_URL) is configured
    // Prioritize Neon if DATABASE_URL is set (even if Supabase is also configured)
    const isUsingNeon = !!process.env.DATABASE_URL
    
    if (isUsingNeon) {
      // For Neon, create project directly (skip auth for now)
      try {
        const { query } = await import('@/lib/db/client')
        
        // Get or create a test user ID (for Neon without auth)
        const testUserId = '00000000-0000-0000-0000-000000000001'
        
        // Validate GitHub account if provided (skip validation for env-default)
        let validatedAccountId: string | null = null;
        if (github_account_id && github_account_id !== 'env-default') {
          // Use 'dev' user_id for development mode
          const userId = 'dev'
          const accountResult = await query(`
            SELECT id FROM github_accounts WHERE id = $1 AND user_id = $2
          `, [github_account_id, userId]);
          
          if (accountResult.rows.length > 0) {
            validatedAccountId = github_account_id;
          }
        }

        // Create the project
        const projectResult = await query(`
          INSERT INTO projects (owner_id, name, description, github_account_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id, name, description, github_account_id, created_at, updated_at
        `, [testUserId, name.trim(), description?.trim() || null, validatedAccountId]);

        const project = projectResult.rows[0];

        // Add repositories if provided
        if (repositories && Array.isArray(repositories) && repositories.length > 0) {
          // Use validated account ID, or fall back to the test account we created
          const accountIdToUse = validatedAccountId || '10000000-0000-0000-0000-000000000001';
          
          for (const repo of repositories) {
            const repoName = typeof repo === 'string' ? repo : repo.repository_full_name;
            await query(`
              INSERT INTO project_repositories (project_id, repository_full_name, github_account_id)
              VALUES ($1, $2, $3)
              ON CONFLICT DO NOTHING
            `, [project.id, repoName, accountIdToUse]);
          }
        }

        // Fetch the complete project with relations
        const reposResult = await query(`
          SELECT id, repository_full_name, github_account_id
          FROM project_repositories
          WHERE project_id = $1
        `, [project.id]);

        const projectWithCounts = {
          id: project.id,
          name: project.name,
          description: project.description,
          github_account_id: project.github_account_id,
          github_account: null, // TODO: Fetch if needed
          member_count: 0,
          repository_count: reposResult.rows.length,
          created_at: project.created_at,
          updated_at: project.updated_at,
        }

        return NextResponse.json({ project: projectWithCounts })
      } catch (error: any) {
        console.error('Error creating project in Neon:', error)
        return NextResponse.json(
          { error: 'Failed to create project', details: error.message },
          { status: 500 }
        )
      }
    }

    // Supabase path
    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json(
        { error: 'Supabase not configured' },
        { status: 500 }
      )
    }

    const supabase = await createClient()
    
    // Get authenticated user from session cookie
    const authenticatedUser = await getAuthenticatedUser()
    if (!authenticatedUser) {
      console.warn('User not authenticated. Returning 401 for project creation.')
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Note: body was already parsed above for Neon check
    // Validate GitHub account if provided (skip validation for env-default)
    let validatedAccountId: string | null = null;
    if (github_account_id) {
      if (github_account_id === 'env-default') {
        // Special case: env-default account from environment variables
        // Don't validate against database, but allow it
        validatedAccountId = null; // Set to null since it's not in database
      } else {
        const { data: account, error: accountError } = await supabase
          .from('github_accounts')
          .select('id')
          .eq('id', github_account_id)
          .eq('user_id', authenticatedUser.id)
          .single()

        if (accountError || !account) {
          return NextResponse.json(
            { error: 'GitHub account not found or access denied' },
            { status: 404 }
          )
        }
        validatedAccountId = github_account_id;
      }
    }

    // Create the project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({
        owner_id: authenticatedUser.id,
        name: name.trim(),
        description: description?.trim() || null,
        github_account_id: validatedAccountId,
      })
      .select()
      .single()

    if (projectError) {
      console.error('Error creating project:', projectError)
      return NextResponse.json(
        { error: 'Failed to create project' },
        { status: 500 }
      )
    }

    // Add repositories if provided
    if (repositories && Array.isArray(repositories) && repositories.length > 0) {
      // Use direct PostgreSQL for repository insertion to avoid Supabase foreign key issues
      // This allows us to insert repositories with null github_account_id for env-default accounts
      try {
        const { Pool } = await import('pg')
        const pool = new Pool({
          host: 'localhost',
          port: 5433,
          database: 'repo_hub',
          user: 'postgres',
          password: 'postgres',
        })

        for (const repo of repositories) {
          const repoName = typeof repo === 'string' ? repo : repo.repository_full_name
          // Use NULL for github_account_id if validatedAccountId is null (env-default case)
          const accountIdParam = validatedAccountId || null
          await pool.query(
            `INSERT INTO project_repositories (project_id, repository_full_name, github_account_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (project_id, repository_full_name) DO NOTHING`,
            [project.id, repoName, accountIdParam]
          )
        }

        await pool.end()
        console.log(`Successfully added ${repositories.length} repository(ies) to project`)
      } catch (pgError: any) {
        console.error('Error adding repositories via direct PostgreSQL:', pgError)
        // Don't fail the request - project was created successfully
        // Repositories can be added later via the UI or API
      }
    }

    // Fetch the complete project with relations
    const { data: fullProject, error: fetchError } = await supabase
      .from('projects')
      .select(`
        id,
        name,
        description,
        github_account_id,
        created_at,
        updated_at,
        github_accounts (
          account_name,
          github_username
        ),
        project_members (
          user_id,
          role
        ),
        project_repositories (
          id,
          repository_full_name,
          github_account_id
        )
      `)
      .eq('id', project.id)
      .single()

    if (fetchError) {
      console.error('Error fetching created project:', fetchError)
      // Return the project we created even if fetch fails
      return NextResponse.json({ project })
    }

    // Transform the response
    const projectWithCounts = {
      id: fullProject.id,
      name: fullProject.name,
      description: fullProject.description,
      github_account_id: fullProject.github_account_id,
      github_account: fullProject.github_accounts && (Array.isArray(fullProject.github_accounts) ? fullProject.github_accounts[0] : fullProject.github_accounts) ? {
        account_name: (Array.isArray(fullProject.github_accounts) ? fullProject.github_accounts[0] : fullProject.github_accounts).account_name,
        github_username: (Array.isArray(fullProject.github_accounts) ? fullProject.github_accounts[0] : fullProject.github_accounts).github_username,
      } : null,
      member_count: fullProject.project_members?.length || 0,
      repository_count: fullProject.project_repositories?.length || 0,
      created_at: fullProject.created_at,
      updated_at: fullProject.updated_at,
    }

    return NextResponse.json({ project: projectWithCounts })
  } catch (error: any) {
    console.error('Error in POST /api/projects:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    // Check if Neon (DATABASE_URL) is configured
    // Prioritize Neon if DATABASE_URL is set (even if Supabase is also configured)
    const isUsingNeon = !!process.env.DATABASE_URL
    
    if (isUsingNeon) {
      // For Neon, delete project directly (skip auth for now)
      try {
        // Delete project (CASCADE will handle related records)
        await query(`
          DELETE FROM projects WHERE id = $1
        `, [id])

        return NextResponse.json({ success: true })
      } catch (error: any) {
        console.error('Error deleting project in Neon:', error)
        return NextResponse.json(
          { error: 'Failed to delete project', details: error.message },
          { status: 500 }
        )
      }
    }

    // Supabase path
    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json(
        { error: 'Supabase not configured' },
        { status: 500 }
      )
    }

    const supabase = await createClient()
    
    // Get authenticated user from session cookie
    const authenticatedUser = await getAuthenticatedUser()
    if (!authenticatedUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify user is owner of the project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', id)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    if (project.owner_id !== authenticatedUser.id) {
      return NextResponse.json(
        { error: 'Only project owners can delete projects' },
        { status: 403 }
      )
    }

    // Delete the project (CASCADE will handle related records)
    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', id)

    if (deleteError) {
      console.error('Error deleting project:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete project' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in DELETE /api/projects:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
