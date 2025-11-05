import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'

export async function GET(request: Request) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const repository = searchParams.get('repository')
    
    // Check if Neon (DATABASE_URL) is configured
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL
    
    if (isUsingNeon) {
      // For Neon, query directly using PostgreSQL
      try {
        // Build query with optional repository filter
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
            ), '[]'::jsonb) as project_repositories
          FROM projects p
          LEFT JOIN github_accounts ga ON p.github_account_id = ga.id
        `
        
        // Add repository filter if provided
        if (repository) {
          querySql += `
            WHERE EXISTS (
              SELECT 1 FROM project_repositories pr
              WHERE pr.project_id = p.id
              AND pr.repository_full_name = $1
            )
          `
        }
        
        querySql += ` ORDER BY p.created_at DESC`
        
        const projectsResult = repository 
          ? await query(querySql, [repository])
          : await query(querySql)

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
            created_at: project.created_at,
            updated_at: project.updated_at,
          };
        });

        return NextResponse.json({ projects: projectsWithCounts })
      } catch (error: any) {
        console.error('Error querying Neon for projects:', error)
        return NextResponse.json({ projects: [] })
      }
    }

    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn('Neither DATABASE_URL nor Supabase configured. Returning empty projects list.')
      return NextResponse.json({ projects: [] })
    }

    const supabase = await createClient()
    
    // Get authenticated user - allow unauthenticated for development
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    // If user is not authenticated, return empty projects array (not 401)
    if (authError || !user) {
      console.warn('User not authenticated. Returning empty projects list.')
      return NextResponse.json({ projects: [] })
    }

    // Get projects user has access to (owner or member)
    // RLS policies will filter automatically
    
    // If repository filter is provided, first get project IDs that contain this repository
    let projectIds: string[] | null = null
    if (repository) {
      const { data: projectRepos, error: repoError } = await supabase
        .from('project_repositories')
        .select('project_id')
        .eq('repository_full_name', repository)
      
      if (repoError) {
        console.error('Error fetching projects by repository:', repoError)
        return NextResponse.json({ projects: [] })
      }
      
      projectIds = projectRepos?.map((pr: any) => pr.project_id) || []
      if (projectIds.length === 0) {
        return NextResponse.json({ projects: [] })
      }
    }
    
    let projectsQuery = supabase
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
    
    // Filter by project IDs if repository filter was provided
    if (projectIds && projectIds.length > 0) {
      projectsQuery = projectsQuery.in('id', projectIds)
    }
    
    const { data: projects, error } = await projectsQuery.order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching projects:', error)
      return NextResponse.json(
        { error: 'Failed to fetch projects' },
        { status: 500 }
      )
    }

    // Transform the data to include counts and simplify structure
    const projectsWithCounts = (projects || []).map((project: any) => ({
      id: project.id,
      name: project.name,
      description: project.description,
      github_account_id: project.github_account_id,
      github_account: project.github_accounts ? {
        account_name: project.github_accounts.account_name,
        github_username: project.github_accounts.github_username,
      } : null,
      owner_id: project.owner_id,
      owner: project.owner ? {
        id: project.owner.id,
        email: project.owner.email,
      } : null,
      member_count: project.project_members?.length || 0,
      repository_count: project.project_repositories?.length || 0,
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
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL
    
    if (isUsingNeon) {
      // For Neon, create project directly (skip auth for now)
      try {
        const { query } = await import('@/lib/db/client')
        
        // Get or create a test user ID (for Neon without auth)
        const testUserId = '00000000-0000-0000-0000-000000000001'
        
        // Validate GitHub account if provided (skip validation for env-default)
        let validatedAccountId: string | null = null;
        if (github_account_id && github_account_id !== 'env-default') {
          const accountResult = await query(`
            SELECT id FROM github_accounts WHERE id = $1
          `, [github_account_id]);
          
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
    
    // Get authenticated user - allow unauthenticated for development but warn
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
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
          .eq('user_id', user.id)
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
        owner_id: user.id,
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
      // For env-default, we still need to store repositories, but without github_account_id
      // For regular accounts, validate that github_account_id is provided
      if (!github_account_id && github_account_id !== 'env-default') {
        return NextResponse.json(
          { error: 'github_account_id is required when adding repositories' },
          { status: 400 }
        )
      }

      const repositoryInserts = repositories.map((repo: { repository_full_name: string }) => ({
        project_id: project.id,
        repository_full_name: repo.repository_full_name,
        github_account_id: validatedAccountId, // null for env-default, actual ID for database accounts
      }))

      const { error: reposError } = await supabase
        .from('project_repositories')
        .insert(repositoryInserts)

      if (reposError) {
        console.error('Error adding repositories to project:', reposError)
        // Don't fail the entire request, just log the error
        // The project was created successfully
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
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL
    
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
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
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

    if (project.owner_id !== user.id) {
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
