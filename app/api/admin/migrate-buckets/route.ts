import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { migrateExistingAccounts, getMigrationStats } from '@/lib/buckets/migrate-existing-accounts'
import { isSuperAdmin } from '@/lib/auth/helpers'

/**
 * GET /api/admin/migrate-buckets
 * Get migration statistics
 */
export async function GET() {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user is super admin
    const adminStatus = await isSuperAdmin(user.id)
    if (!adminStatus) {
      return NextResponse.json(
        { error: 'Forbidden - Super admin access required' },
        { status: 403 }
      )
    }

    // Get migration statistics
    const stats = await getMigrationStats()

    return NextResponse.json({ stats })
  } catch (error: any) {
    console.error('Error getting migration stats:', error)
    return NextResponse.json(
      { error: 'Failed to get migration stats' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/admin/migrate-buckets
 * Run migration for all existing accounts or specific user
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if user is super admin
    const adminStatus = await isSuperAdmin(user.id)
    if (!adminStatus) {
      return NextResponse.json(
        { error: 'Forbidden - Super admin access required' },
        { status: 403 }
      )
    }

    // Parse request body for optional userId
    let userId: string | undefined
    try {
      const body = await request.json().catch(() => ({}))
      userId = body.userId
    } catch {
      // Body is optional
    }

    // Run migration
    const results = await migrateExistingAccounts(userId)

    // Calculate statistics
    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    return NextResponse.json({
      message: 'Migration completed',
      results,
      summary: {
        total: results.length,
        successful,
        failed,
      },
    })
  } catch (error: any) {
    console.error('Error running migration:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to run migration' },
      { status: 500 }
    )
  }
}


