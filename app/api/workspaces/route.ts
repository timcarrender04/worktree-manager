import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'

// Helper to get authenticated user (DEV: returns default 'dev' user if no auth)
async function getAuthenticatedUser(request: Request): Promise<{ id: string; email: string } | null> {
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

  if (isUsingNeon) {
    // DEV: Return default dev user for local development
    return { id: 'dev', email: 'dev@local' }
  }

  // DEV: Check if we're in dev mode (no auth required)
  const isDevMode = process.env.NODE_ENV === 'development' || !process.env.NEXT_PUBLIC_SUPABASE_URL
  if (isDevMode) {
    return { id: 'dev', email: 'dev@local' }
  }

  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return { id: user.id, email: user.email || '' }
}

/**
 * GET /api/workspaces
 * Get current user's workspace configuration
 */
export async function GET(request: Request) {
  try {
    // DEV: Workspaces work without auth in development
    let user = await getAuthenticatedUser(request)
    if (!user) {
      // DEV: Use default dev user in dev mode
      const isDevMode = process.env.NODE_ENV === 'development' || !process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!isDevMode) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // Use default dev user
      user = { id: 'dev', email: 'dev@local' }
    }

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      const result = await query(
        `
        SELECT id, user_id, workspace_path, default_github_account_id, default_aws_profile_id, created_at, updated_at
        FROM user_workspaces
        WHERE user_id = $1
        `,
        [user.id]
      )

      if (result.rows.length === 0) {
        // Create default workspace if it doesn't exist
        const defaultPath = `/home/repo-user/worktrees/${user.id}`
        const createResult = await query(
          `
          INSERT INTO user_workspaces (user_id, workspace_path)
          VALUES ($1, $2)
          RETURNING id, user_id, workspace_path, default_github_account_id, default_aws_profile_id, created_at, updated_at
          `,
          [user.id, defaultPath]
        )

        return NextResponse.json({ workspace: createResult.rows[0] })
      }

      return NextResponse.json({ workspace: result.rows[0] })
    } else {
      const supabase = await createClient()

      let { data, error } = await supabase
        .from('user_workspaces')
        .select('id, user_id, workspace_path, default_github_account_id, default_aws_profile_id, created_at, updated_at')
        .eq('user_id', user.id)
        .single()

      if (error || !data) {
        // Create default workspace if it doesn't exist
        const defaultPath = `/home/repo-user/worktrees/${user.id}`
        const { data: newWorkspace, error: createError } = await supabase
          .from('user_workspaces')
          .insert({
            user_id: user.id,
            workspace_path: defaultPath,
          })
          .select('id, user_id, workspace_path, default_github_account_id, default_aws_profile_id, created_at, updated_at')
          .single()

        if (createError) {
          console.error('Error creating workspace:', createError)
          return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
        }

        return NextResponse.json({ workspace: newWorkspace })
      }

      return NextResponse.json({ workspace: data })
    }
  } catch (error: any) {
    console.error('Error in GET /api/workspaces:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/workspaces
 * Create or update workspace configuration
 */
export async function POST(request: Request) {
  try {
    // DEV: Workspaces work without auth in development
    let user = await getAuthenticatedUser(request)
    if (!user) {
      // DEV: Use default dev user in dev mode
      const isDevMode = process.env.NODE_ENV === 'development' || !process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!isDevMode) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // Use default dev user
      user = { id: 'dev', email: 'dev@local' }
    }

    const body = await request.json()
    const { workspace_path, default_github_account_id, default_aws_profile_id } = body

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      // Check if workspace exists
      const existing = await query(
        `SELECT id FROM user_workspaces WHERE user_id = $1`,
        [user.id]
      )

      if (existing.rows.length > 0) {
        // Update existing workspace
        const updates: string[] = []
        const values: any[] = []
        let paramIndex = 1

        if (workspace_path !== undefined) {
          updates.push(`workspace_path = $${paramIndex++}`)
          values.push(workspace_path)
        }
        if (default_github_account_id !== undefined) {
          // Verify the account belongs to the user
          const accountCheck = await query(
            `SELECT id FROM github_accounts WHERE id = $1 AND user_id = $2`,
            [default_github_account_id, user.id]
          )
          if (accountCheck.rows.length === 0 && default_github_account_id !== null) {
            return NextResponse.json(
              { error: 'GitHub account not found or does not belong to user' },
              { status: 400 }
            )
          }
          updates.push(`default_github_account_id = $${paramIndex++}`)
          values.push(default_github_account_id)
        }
        if (default_aws_profile_id !== undefined) {
          // Verify the profile belongs to the user
          const profileCheck = await query(
            `SELECT id FROM user_aws_credentials WHERE id = $1 AND user_id = $2`,
            [default_aws_profile_id, user.id]
          )
          if (profileCheck.rows.length === 0 && default_aws_profile_id !== null) {
            return NextResponse.json(
              { error: 'AWS profile not found or does not belong to user' },
              { status: 400 }
            )
          }
          updates.push(`default_aws_profile_id = $${paramIndex++}`)
          values.push(default_aws_profile_id)
        }

        if (updates.length === 0) {
          return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
        }

        values.push(user.id)
        const result = await query(
          `
          UPDATE user_workspaces
          SET ${updates.join(', ')}, updated_at = NOW()
          WHERE user_id = $${paramIndex++}
          RETURNING id, user_id, workspace_path, default_github_account_id, default_aws_profile_id, created_at, updated_at
          `,
          values
        )

        return NextResponse.json({ workspace: result.rows[0] })
      } else {
        // Create new workspace
        const defaultPath = workspace_path || `/home/repo-user/worktrees/${user.id}`
        const result = await query(
          `
          INSERT INTO user_workspaces (user_id, workspace_path, default_github_account_id, default_aws_profile_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id, user_id, workspace_path, default_github_account_id, default_aws_profile_id, created_at, updated_at
          `,
          [user.id, defaultPath, default_github_account_id || null, default_aws_profile_id || null]
        )

        return NextResponse.json({ workspace: result.rows[0] }, { status: 201 })
      }
    } else {
      const supabase = await createClient()

      // Check if workspace exists
      const { data: existing } = await supabase
        .from('user_workspaces')
        .select('id')
        .eq('user_id', user.id)
        .single()

      if (existing) {
        // Update existing workspace
        const updateData: any = {}
        if (workspace_path !== undefined) updateData.workspace_path = workspace_path

        if (default_github_account_id !== undefined) {
          // Verify the account belongs to the user
          if (default_github_account_id !== null) {
            const { data: accountCheck } = await supabase
              .from('github_accounts')
              .select('id')
              .eq('id', default_github_account_id)
              .eq('user_id', user.id)
              .single()

            if (!accountCheck) {
              return NextResponse.json(
                { error: 'GitHub account not found or does not belong to user' },
                { status: 400 }
              )
            }
          }
          updateData.default_github_account_id = default_github_account_id
        }

        if (default_aws_profile_id !== undefined) {
          // Verify the profile belongs to the user
          if (default_aws_profile_id !== null) {
            const { data: profileCheck } = await supabase
              .from('user_aws_credentials')
              .select('id')
              .eq('id', default_aws_profile_id)
              .eq('user_id', user.id)
              .single()

            if (!profileCheck) {
              return NextResponse.json(
                { error: 'AWS profile not found or does not belong to user' },
                { status: 400 }
              )
            }
          }
          updateData.default_aws_profile_id = default_aws_profile_id
        }

        const { data, error } = await supabase
          .from('user_workspaces')
          .update(updateData)
          .eq('user_id', user.id)
          .select('id, user_id, workspace_path, default_github_account_id, default_aws_profile_id, created_at, updated_at')
          .single()

        if (error) {
          console.error('Error updating workspace:', error)
          return NextResponse.json({ error: 'Failed to update workspace' }, { status: 500 })
        }

        return NextResponse.json({ workspace: data })
      } else {
        // Create new workspace
        const defaultPath = workspace_path || `/home/repo-user/worktrees/${user.id}`
        const { data, error } = await supabase
          .from('user_workspaces')
          .insert({
            user_id: user.id,
            workspace_path: defaultPath,
            default_github_account_id: default_github_account_id || null,
            default_aws_profile_id: default_aws_profile_id || null,
          })
          .select('id, user_id, workspace_path, default_github_account_id, default_aws_profile_id, created_at, updated_at')
          .single()

        if (error) {
          console.error('Error creating workspace:', error)
          return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
        }

        return NextResponse.json({ workspace: data }, { status: 201 })
      }
    }
  } catch (error: any) {
    console.error('Error in POST /api/workspaces:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/workspaces/default-accounts
 * Set default GitHub and/or AWS accounts for workspace
 */
export async function PATCH(request: Request) {
  try {
    // DEV: Workspaces work without auth in development
    let user = await getAuthenticatedUser(request)
    if (!user) {
      // DEV: Use default dev user in dev mode
      const isDevMode = process.env.NODE_ENV === 'development' || !process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!isDevMode) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // Use default dev user
      user = { id: 'dev', email: 'dev@local' }
    }

    const body = await request.json()
    const { default_github_account_id, default_aws_profile_id } = body

    // Use POST endpoint logic (upsert)
    const postBody: any = {}
    if (default_github_account_id !== undefined) {
      postBody.default_github_account_id = default_github_account_id
    }
    if (default_aws_profile_id !== undefined) {
      postBody.default_aws_profile_id = default_aws_profile_id
    }

    // Reuse POST logic
    const postRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(postBody),
    })

    return POST(postRequest)
  } catch (error: any) {
    console.error('Error in PATCH /api/workspaces/default-accounts:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

