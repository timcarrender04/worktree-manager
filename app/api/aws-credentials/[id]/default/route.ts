import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'

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
 * PATCH /api/aws-credentials/[id]/default
 * Set an AWS credential profile as the default
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

      // Unset all other defaults
      await query(
        `UPDATE user_aws_credentials SET default_profile = false WHERE user_id = $1`,
        [user.id]
      )

      // Set this one as default
      const result = await query(
        `
        UPDATE user_aws_credentials
        SET default_profile = true, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        RETURNING id, profile_name, region, default_profile, created_at, updated_at
        `,
        [id, user.id]
      )

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

      // Unset all other defaults
      await supabase
        .from('user_aws_credentials')
        .update({ default_profile: false })
        .eq('user_id', user.id)
        .eq('default_profile', true)

      // Set this one as default
      const { data, error } = await supabase
        .from('user_aws_credentials')
        .update({ default_profile: true })
        .eq('id', id)
        .eq('user_id', user.id)
        .select('id, profile_name, region, default_profile, created_at, updated_at')
        .single()

      if (error) {
        console.error('Error setting default AWS credential:', error)
        return NextResponse.json({ error: 'Failed to set default credential' }, { status: 500 })
      }

      return NextResponse.json({ credential: data })
    }
  } catch (error: any) {
    console.error('Error in PATCH /api/aws-credentials/[id]/default:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

