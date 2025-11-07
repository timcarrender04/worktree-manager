import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSuperAdmin } from '@/lib/auth/helpers'
import { cookies } from 'next/headers'
import { query } from '@/lib/db/client'

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
        email: sessionData.email,
      }
    } catch (error) {
      // Invalid token
      return null
    }
  } catch (error) {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    
    // Get authenticated user from cookie session
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if we should use Neon or Supabase (same logic as projects list route)
    const isDevelopment = process.env.NODE_ENV === 'development'
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const isLocalSupabase = supabaseUrl?.includes('localhost') || supabaseUrl?.includes('127.0.0.1') || supabaseUrl?.includes(':8002')
    const isUsingNeon = !!process.env.DATABASE_URL && !isLocalSupabase
    
    console.log(`[DEBUG] Database selection - DATABASE_URL: ${!!process.env.DATABASE_URL}, isLocalSupabase: ${isLocalSupabase}, isUsingNeon: ${isUsingNeon}, supabaseUrl: ${supabaseUrl}`)

    // Check if user is super admin
    let adminStatus = false
    if (isUsingNeon) {
      // For Neon, query directly using PostgreSQL
      try {
        const roleResult = await query<{ is_super_admin: boolean }>(
          'SELECT is_super_admin FROM user_roles WHERE user_id = $1 LIMIT 1',
          [user.id]
        )
        adminStatus = roleResult.rows.length > 0 && roleResult.rows[0].is_super_admin === true
        console.log(`[DEBUG] Neon admin check for user ${user.id}: ${adminStatus}`)
      } catch (error) {
        console.warn('Could not check super admin status via PostgreSQL:', error)
      }
    } else {
      // For Supabase, use isSuperAdmin helper
      try {
        adminStatus = await isSuperAdmin(user.id)
        console.log(`[DEBUG] Supabase admin check for user ${user.id}: ${adminStatus}`)
      } catch (error) {
        console.warn('Could not check super admin status:', error)
      }
    }

    // If using Neon, query directly using PostgreSQL
    if (isUsingNeon) {
      try {
        console.log(`[DEBUG] Using Neon/PostgreSQL for project ${id}`)
        console.log(`[DEBUG] User ID: ${user.id}, Admin status: ${adminStatus}`)
        
        // Super admins can access all projects, otherwise filter by owner/member
        let querySql = `
          SELECT 
            p.id,
            p.name,
            p.description,
            p.github_account_id,
            p.owner_id,
            p.created_at,
            p.updated_at,
            CASE 
              WHEN ga.id IS NOT NULL THEN jsonb_build_object(
                'id', ga.id,
                'account_name', ga.account_name,
                'github_username', ga.github_username
              )
              ELSE NULL
            END as github_accounts,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', pm.id,
                'user_id', pm.user_id,
                'role', pm.role,
                'created_at', pm.created_at,
                'users', jsonb_build_object(
                  'id', u.id,
                  'email', u.email
                )
              ))
              FROM project_members pm
              LEFT JOIN users u ON u.id = pm.user_id
              WHERE pm.project_id = p.id
            ), '[]'::jsonb) as project_members,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', pr.id,
                'repository_full_name', pr.repository_full_name,
                'github_account_id', pr.github_account_id,
                'tracked_branch', pr.tracked_branch,
                'created_at', pr.created_at,
                'github_accounts', CASE 
                  WHEN pr_ga.id IS NOT NULL THEN jsonb_build_object(
                    'id', pr_ga.id,
                    'account_name', pr_ga.account_name,
                    'github_username', pr_ga.github_username
                  )
                  ELSE NULL
                END
              ))
              FROM project_repositories pr
              LEFT JOIN github_accounts pr_ga ON pr_ga.id = pr.github_account_id
              WHERE pr.project_id = p.id
            ), '[]'::jsonb) as project_repositories
          FROM projects p
          LEFT JOIN github_accounts ga ON ga.id = p.github_account_id
          WHERE p.id = $1
        `
        
        const queryParams = [id]
        
        // Add access check unless super admin
        if (!adminStatus) {
          querySql += ` AND (p.owner_id = $2 OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.user_id = $2
          ))`
          queryParams.push(user.id)
        }
        
        console.log(`[DEBUG] Executing query with params:`, queryParams)
        const projectResult = await query(querySql, queryParams)
        console.log(`[DEBUG] Query result: ${projectResult.rows.length} rows`)
        
        if (projectResult.rows.length === 0) {
          console.error(`[DEBUG] Project ${id} not found in Neon database`)
          return NextResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          )
        }
        
        const project = projectResult.rows[0]
      
      // Transform the response to match Supabase format
      const projectData = {
        id: project.id,
        name: project.name,
        description: project.description,
        github_account_id: project.github_account_id,
        owner_id: project.owner_id,
        is_owner: project.owner_id === user.id,
        github_account: project.github_accounts,
        members: (project.project_members || []).map((m: any) => ({
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          email: m.users?.email || null,
          created_at: m.created_at,
        })),
        repositories: (project.project_repositories || []).map((r: any) => ({
          id: r.id,
          repository_full_name: r.repository_full_name,
          github_account_id: r.github_account_id,
          tracked_branch: r.tracked_branch || 'dev',
          github_account: r.github_accounts,
          created_at: r.created_at,
        })),
        created_at: project.created_at,
        updated_at: project.updated_at,
      }
      
      console.log(`[DEBUG] Returning project data for ${id}`)
      return NextResponse.json({ project: projectData })
      } catch (neonError: any) {
        console.error(`[DEBUG] Error in Neon query for project ${id}:`, neonError)
        console.error(`[DEBUG] Error details:`, JSON.stringify(neonError, null, 2))
        return NextResponse.json(
          { error: 'Project not found', details: neonError.message },
          { status: 404 }
        )
      }
    }

    // Use Supabase path
    let clientToUse = await createClient()
    
    // Check if user is super admin - if so, use service role client to bypass RLS
    if (adminStatus) {
      try {
        const { createServiceRoleClient } = await import('@/lib/supabase/server')
        clientToUse = createServiceRoleClient()
        console.log(`[DEBUG] Using service role client for admin user ${user.id}`)
      } catch (error) {
        console.error('Could not create service role client:', error)
        // Don't fall back - if we can't create service role client, return error
        return NextResponse.json(
          { error: 'Admin access configuration error', details: error instanceof Error ? error.message : 'Unknown error' },
          { status: 500 }
        )
      }
    } else {
      console.log(`[DEBUG] User ${user.id} is not admin, checking project membership`)
    }

    // Fetch project (without relations first to avoid relationship errors)
    const { data: project, error: projectError } = await clientToUse
      .from('projects')
      .select('id, name, description, github_account_id, owner_id, created_at, updated_at')
      .eq('id', id)
      .single()

    if (projectError || !project) {
      console.error(`[DEBUG] Error fetching project ${id}:`, projectError)
      console.error(`[DEBUG] Using service role client:`, adminStatus)
      console.error(`[DEBUG] User ID:`, user.id)
      return NextResponse.json(
        { error: 'Project not found', details: projectError?.message },
        { status: 404 }
      )
    }

    // Fetch related data separately
    let githubAccount = null
    if (project.github_account_id) {
      const { data: gaData } = await clientToUse
        .from('github_accounts')
        .select('id, account_name, github_username')
        .eq('id', project.github_account_id)
        .maybeSingle()
      githubAccount = gaData
    }

    // Fetch project members
    const { data: membersData } = await clientToUse
      .from('project_members')
      .select('id, user_id, role, created_at')
      .eq('project_id', id)

    // Fetch user emails for members
    const membersWithUsers = await Promise.all(
      (membersData || []).map(async (member: any) => {
        // Note: This assumes users table exists. If using Supabase Auth, we might need different approach
        const { data: userData } = await clientToUse
          .from('users')
          .select('id, email')
          .eq('id', member.user_id)
          .maybeSingle()
        return {
          ...member,
          users: userData || null,
        }
      })
    )

    // Fetch project repositories
    const { data: reposData } = await clientToUse
      .from('project_repositories')
      .select('id, repository_full_name, github_account_id, tracked_branch, created_at')
      .eq('project_id', id)

    // Fetch github accounts for repositories
    const reposWithAccounts = await Promise.all(
      (reposData || []).map(async (repo: any) => {
        if (repo.github_account_id) {
          const { data: gaData } = await clientToUse
            .from('github_accounts')
            .select('id, account_name, github_username')
            .eq('id', repo.github_account_id)
            .maybeSingle()
          return {
            ...repo,
            github_accounts: gaData,
          }
        }
        return { ...repo, github_accounts: null }
      })
    )

    // Combine all data
    const projectWithRelations = {
      ...project,
      github_accounts: githubAccount ? [githubAccount] : null,
      project_members: membersWithUsers,
      project_repositories: reposWithAccounts,
    }

    // Check if user has access (RLS should handle this, but double-check)
    // Super admins can access all projects (already checked above)
    const isOwner = projectWithRelations.owner_id === user.id
    const isMember = projectWithRelations.project_members?.some((m: any) => m.user_id === user.id)

    if (!adminStatus && !isOwner && !isMember) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    // Transform the response
    const projectData = {
      id: projectWithRelations.id,
      name: projectWithRelations.name,
      description: projectWithRelations.description,
      github_account_id: projectWithRelations.github_account_id,
      owner_id: projectWithRelations.owner_id,
      is_owner: isOwner,
      github_account: projectWithRelations.github_accounts && (Array.isArray(projectWithRelations.github_accounts) ? projectWithRelations.github_accounts[0] : projectWithRelations.github_accounts) ? {
        id: (Array.isArray(projectWithRelations.github_accounts) ? projectWithRelations.github_accounts[0] : projectWithRelations.github_accounts).id,
        account_name: (Array.isArray(projectWithRelations.github_accounts) ? projectWithRelations.github_accounts[0] : projectWithRelations.github_accounts).account_name,
        github_username: (Array.isArray(projectWithRelations.github_accounts) ? projectWithRelations.github_accounts[0] : projectWithRelations.github_accounts).github_username,
      } : null,
      members: (projectWithRelations.project_members || []).map((m: any) => ({
        id: m.id,
        user_id: m.user_id,
        role: m.role,
        email: m.users?.email || null,
        created_at: m.created_at,
      })),
      repositories: (projectWithRelations.project_repositories || []).map((r: any) => ({
        id: r.id,
        repository_full_name: r.repository_full_name,
        github_account_id: r.github_account_id,
        tracked_branch: r.tracked_branch || 'dev',
        github_account: r.github_accounts ? {
          id: r.github_accounts.id,
          account_name: r.github_accounts.account_name,
          github_username: r.github_accounts.github_username,
        } : null,
        created_at: r.created_at,
      })),
      created_at: projectWithRelations.created_at,
      updated_at: projectWithRelations.updated_at,
    }

    return NextResponse.json({ project: projectData })
  } catch (error: any) {
    console.error('Error in GET /api/projects/[id]:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
