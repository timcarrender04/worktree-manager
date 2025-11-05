import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSuperAdmin } from '@/lib/auth/helpers'

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

    // Get all users with their roles
    const { data: users, error: usersError } = await supabase
      .from('auth.users')
      .select('id, email, created_at')

    if (usersError) {
      // If direct access to auth.users fails, try via service role
      const serviceClient = createClient()
      // In production, you'd use createServiceRoleClient() here
      // For now, return what we can get
      return NextResponse.json(
        { error: 'Failed to fetch users' },
        { status: 500 }
      )
    }

    // Get roles for all users
    const { data: roles, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id, is_super_admin')

    const rolesMap = new Map(
      (roles || []).map(r => [r.user_id, r.is_super_admin])
    )

    // Combine user data with roles
    const usersWithRoles = (users || []).map(u => ({
      id: u.id,
      email: u.email,
      isSuperAdmin: rolesMap.get(u.id) || false,
    }))

    return NextResponse.json({ users: usersWithRoles })
  } catch (error: any) {
    console.error('Error fetching users:', error)
    return NextResponse.json(
      { error: 'Failed to fetch users' },
      { status: 500 }
    )
  }
}

