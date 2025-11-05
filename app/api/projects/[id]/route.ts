import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
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

    // Fetch project with all relations
    const { data: project, error } = await supabase
      .from('projects')
      .select(`
        id,
        name,
        description,
        github_account_id,
        owner_id,
        created_at,
        updated_at,
        github_accounts (
          id,
          account_name,
          github_username
        ),
        project_members (
          id,
          user_id,
          role,
          created_at,
          users:user_id (
            id,
            email
          )
        ),
        project_repositories (
          id,
          repository_full_name,
          github_account_id,
          tracked_branch,
          created_at,
          github_accounts (
            id,
            account_name,
            github_username
          )
        )
      `)
      .eq('id', id)
      .single()

    if (error || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Check if user has access (RLS should handle this, but double-check)
    const isOwner = project.owner_id === user.id
    const isMember = project.project_members?.some((m: any) => m.user_id === user.id)

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      )
    }

    // Transform the response
    const projectData = {
      id: project.id,
      name: project.name,
      description: project.description,
      github_account_id: project.github_account_id,
      owner_id: project.owner_id,
      is_owner: isOwner,
      github_account: project.github_accounts && (Array.isArray(project.github_accounts) ? project.github_accounts[0] : project.github_accounts) ? {
        id: (Array.isArray(project.github_accounts) ? project.github_accounts[0] : project.github_accounts).id,
        account_name: (Array.isArray(project.github_accounts) ? project.github_accounts[0] : project.github_accounts).account_name,
        github_username: (Array.isArray(project.github_accounts) ? project.github_accounts[0] : project.github_accounts).github_username,
      } : null,
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
        github_account: r.github_accounts && (Array.isArray(r.github_accounts) ? r.github_accounts[0] : r.github_accounts) ? {
          id: (Array.isArray(r.github_accounts) ? r.github_accounts[0] : r.github_accounts).id,
          account_name: (Array.isArray(r.github_accounts) ? r.github_accounts[0] : r.github_accounts).account_name,
          github_username: (Array.isArray(r.github_accounts) ? r.github_accounts[0] : r.github_accounts).github_username,
        } : null,
        created_at: r.created_at,
      })),
      created_at: project.created_at,
      updated_at: project.updated_at,
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
