import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'
import { validateAWSCredentials } from '@/lib/credentials/helpers'

// Helper to get authenticated user
async function getAuthenticatedUser(request: Request): Promise<{ id: string; email: string } | null> {
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

  if (isUsingNeon) {
    return null
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
 * PATCH /api/aws-credentials/[id]
 * Update an AWS credential profile
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { profile_name, access_key_id, secret_access_key, region, default_profile } = body

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      // Verify user owns this credential
      const verifyResult = await query(
        `SELECT id FROM user_aws_credentials WHERE id = $1 AND user_id = $2`,
        [id, user.id]
      )

      if (verifyResult.rows.length === 0) {
        return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
      }

      // If changing profile name, check for conflicts
      if (profile_name) {
        const conflictResult = await query(
          `SELECT id FROM user_aws_credentials WHERE user_id = $1 AND profile_name = $2 AND id != $3`,
          [user.id, profile_name, id]
        )

        if (conflictResult.rows.length > 0) {
          return NextResponse.json(
            { error: 'A profile with this name already exists' },
            { status: 400 }
          )
        }
      }

      // Validate credentials if provided
      if (access_key_id && secret_access_key) {
        const isValid = await validateAWSCredentials(access_key_id, secret_access_key)
        if (!isValid) {
          return NextResponse.json(
            { error: 'Invalid AWS credentials format' },
            { status: 400 }
          )
        }
      }

      // Build update query
      const updates: string[] = []
      const values: any[] = []
      let paramIndex = 1

      if (profile_name !== undefined) {
        updates.push(`profile_name = $${paramIndex++}`)
        values.push(profile_name)
      }
      if (access_key_id !== undefined) {
        updates.push(`access_key_id = $${paramIndex++}`)
        values.push(access_key_id)
      }
      if (secret_access_key !== undefined) {
        updates.push(`secret_access_key = $${paramIndex++}`)
        values.push(secret_access_key)
      }
      if (region !== undefined) {
        updates.push(`region = $${paramIndex++}`)
        values.push(region)
      }
      if (default_profile !== undefined) {
        updates.push(`default_profile = $${paramIndex++}`)
        values.push(default_profile)

        // If setting as default, unset other defaults
        if (default_profile) {
          await query(
            `UPDATE user_aws_credentials SET default_profile = false WHERE user_id = $1 AND id != $2`,
            [user.id, id]
          )
        }
      }

      if (updates.length === 0) {
        return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
      }

      values.push(id, user.id)
      const result = await query(
        `
        UPDATE user_aws_credentials
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
        RETURNING id, profile_name, region, default_profile, created_at, updated_at
        `,
        values
      )

      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
      }

      return NextResponse.json({ credential: result.rows[0] })
    } else {
      const supabase = await createClient()

      // Verify user owns this credential
      const { data: existing } = await supabase
        .from('user_aws_credentials')
        .select('id')
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (!existing) {
        return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
      }

      // If changing profile name, check for conflicts
      if (profile_name) {
        const { data: conflict } = await supabase
          .from('user_aws_credentials')
          .select('id')
          .eq('user_id', user.id)
          .eq('profile_name', profile_name)
          .neq('id', id)
          .single()

        if (conflict) {
          return NextResponse.json(
            { error: 'A profile with this name already exists' },
            { status: 400 }
          )
        }
      }

      // Validate credentials if provided
      if (access_key_id && secret_access_key) {
        const isValid = await validateAWSCredentials(access_key_id, secret_access_key)
        if (!isValid) {
          return NextResponse.json(
            { error: 'Invalid AWS credentials format' },
            { status: 400 }
          )
        }
      }

      // Build update object
      const updateData: any = {}
      if (profile_name !== undefined) updateData.profile_name = profile_name
      if (access_key_id !== undefined) updateData.access_key_id = access_key_id
      if (secret_access_key !== undefined) updateData.secret_access_key = secret_access_key
      if (region !== undefined) updateData.region = region
      if (default_profile !== undefined) {
        updateData.default_profile = default_profile

        // If setting as default, unset other defaults
        if (default_profile) {
          await supabase
            .from('user_aws_credentials')
            .update({ default_profile: false })
            .eq('user_id', user.id)
            .neq('id', id)
            .eq('default_profile', true)
        }
      }

      const { data, error } = await supabase
        .from('user_aws_credentials')
        .update(updateData)
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id, profile_name, region, default_profile, created_at, updated_at')
        .single()

      if (error) {
        console.error('Error updating AWS credential:', error)
        return NextResponse.json({ error: 'Failed to update credential' }, { status: 500 })
      }

      return NextResponse.json({ credential: data })
    }
  } catch (error: any) {
    console.error('Error in PATCH /api/aws-credentials/[id]:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/aws-credentials/[id]
 * Delete an AWS credential profile
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      const result = await query(
        `DELETE FROM user_aws_credentials WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, user.id]
      )

      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
      }

      return NextResponse.json({ success: true })
    } else {
      const supabase = await createClient()

      const { error } = await supabase
        .from('user_aws_credentials')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id)

      if (error) {
        console.error('Error deleting AWS credential:', error)
        return NextResponse.json({ error: 'Failed to delete credential' }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }
  } catch (error: any) {
    console.error('Error in DELETE /api/aws-credentials/[id]:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

