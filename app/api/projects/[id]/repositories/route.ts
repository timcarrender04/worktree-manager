import { NextResponse } from 'next/server'
import { query } from '@/lib/db/client'
import { getSessionUser } from '@/lib/auth/session'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const sessionUser = await getSessionUser()

    if (!sessionUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Ensure the user owns the project or is a member
    const projectResult = await query<{ owner_id: string }>(
      'SELECT owner_id FROM projects WHERE id = $1 LIMIT 1',
      [id]
    )

    if (projectResult.rowCount === 0) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    const project = projectResult.rows[0]
    let hasAccess = project.owner_id === sessionUser.id

    if (!hasAccess) {
      const membershipResult = await query(
        'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1',
        [id, sessionUser.id]
      )
      hasAccess = membershipResult.rowCount > 0
    }

    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    const trackedBranchCheck = await query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'project_repositories'
          AND column_name = 'tracked_branch'
      ) AS exists`
    )

    const hasTrackedBranch = trackedBranchCheck.rows[0]?.exists === true

    const repositoriesResult = await query<{
      id: string
      repository_full_name: string
      github_account_id: string | null
      tracked_branch: string | null
      created_at: string
      ga_id: string | null
      ga_account_name: string | null
      ga_github_username: string | null
    }>(
      `SELECT
        pr.id,
        pr.repository_full_name,
        pr.github_account_id,
        ${hasTrackedBranch ? 'pr.tracked_branch' : 'NULL AS tracked_branch'},
        pr.created_at,
        ga.id AS ga_id,
        ga.account_name AS ga_account_name,
        ga.github_username AS ga_github_username
      FROM project_repositories pr
      LEFT JOIN github_accounts ga ON ga.id = pr.github_account_id
      WHERE pr.project_id = $1
      ORDER BY pr.created_at DESC`,
      [id]
    )

    const repositories = repositoriesResult.rows.map((repo) => ({
      id: repo.id,
      repository_full_name: repo.repository_full_name,
      github_account_id: repo.github_account_id,
      tracked_branch: repo.tracked_branch || 'dev',
      github_account: repo.github_account_id
        ? {
            id: repo.ga_id ?? repo.github_account_id,
            account_name: repo.ga_account_name,
            github_username: repo.ga_github_username,
          }
        : null,
      created_at: repo.created_at,
    }))

    return NextResponse.json({ repositories })
  } catch (error: any) {
    console.error('Error in GET /api/projects/[id]/repositories:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Verify user has access to the project
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, owner_id')
      .eq('id', id)
      .single()

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Only owners can update tracked branches
    if (project.owner_id !== user.id) {
      return NextResponse.json(
        { error: 'Only project owners can update tracked branches' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { repository_id, tracked_branch } = body

    if (!repository_id || !tracked_branch) {
      return NextResponse.json(
        { error: 'repository_id and tracked_branch are required' },
        { status: 400 }
      )
    }

    // Update the tracked branch
    const { data: updated, error: updateError } = await supabase
      .from('project_repositories')
      .update({ tracked_branch })
      .eq('id', repository_id)
      .eq('project_id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Error updating tracked branch:', updateError)
      return NextResponse.json(
        { error: 'Failed to update tracked branch' },
        { status: 500 }
      )
    }

    return NextResponse.json({ repository: updated })
  } catch (error: any) {
    console.error('Error in PATCH /api/projects/[id]/repositories:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
