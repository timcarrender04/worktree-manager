import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'
import { getBucketForAccount, createBucketForAccount, deleteBucketForAccount, ensureBucketExists } from '@/lib/buckets/service'
import { getUserGitHubAccount } from '@/lib/credentials/helpers'

/**
 * GET /api/github-accounts/[id]/bucket
 * Get bucket info for a GitHub account
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: accountId } = await params

    // Get authenticated user
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    let userId: string | null = null

    if (isUsingNeon) {
      // For Neon, we need to implement authentication differently
      // This is a placeholder - actual implementation depends on your auth system
      userId = 'dev' // DEV mode
    } else {
      const supabase = await createClient()
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (error || !user) {
        // DEV: Allow dev mode
        if (process.env.NODE_ENV === 'development') {
          userId = 'dev'
        } else {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
      } else {
        userId = user.id
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify account belongs to user
    const account = await getUserGitHubAccount(userId, accountId)
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Get bucket info
    const bucketInfo = await getBucketForAccount(accountId)

    if (!bucketInfo) {
      return NextResponse.json({ bucket: null, message: 'No bucket found for this account' })
    }

    return NextResponse.json({ bucket: bucketInfo })
  } catch (error: any) {
    console.error('Error in GET /api/github-accounts/[id]/bucket:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/github-accounts/[id]/bucket
 * Create or recreate bucket for a GitHub account
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: accountId } = await params

    // Get authenticated user
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    let userId: string | null = null

    if (isUsingNeon) {
      userId = 'dev' // DEV mode
    } else {
      const supabase = await createClient()
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (error || !user) {
        if (process.env.NODE_ENV === 'development') {
          userId = 'dev'
        } else {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
      } else {
        userId = user.id
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify account belongs to user
    const account = await getUserGitHubAccount(userId, accountId)
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Create or ensure bucket exists
    const result = await createBucketForAccount(accountId, account.account_name, userId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to create bucket' },
        { status: 500 }
      )
    }

    return NextResponse.json({ bucket: result.bucket }, { status: 201 })
  } catch (error: any) {
    console.error('Error in POST /api/github-accounts/[id]/bucket:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/github-accounts/[id]/bucket
 * Delete bucket for a GitHub account
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: accountId } = await params

    // Get authenticated user
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    let userId: string | null = null

    if (isUsingNeon) {
      userId = 'dev' // DEV mode
    } else {
      const supabase = await createClient()
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (error || !user) {
        if (process.env.NODE_ENV === 'development') {
          userId = 'dev'
        } else {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
      } else {
        userId = user.id
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify account belongs to user
    const account = await getUserGitHubAccount(userId, accountId)
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Delete bucket
    const result = await deleteBucketForAccount(accountId, userId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to delete bucket' },
        { status: 500 }
      )
    }

    return NextResponse.json({ message: 'Bucket deleted successfully' })
  } catch (error: any) {
    console.error('Error in DELETE /api/github-accounts/[id]/bucket:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}


