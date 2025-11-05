import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isSuperAdmin } from '@/lib/auth/helpers'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params
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

    // Prevent self-demotion
    if (userId === user.id) {
      return NextResponse.json(
        { error: 'Cannot modify your own admin status' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { isSuperAdmin: newAdminStatus } = body

    if (typeof newAdminStatus !== 'boolean') {
      return NextResponse.json(
        { error: 'isSuperAdmin must be a boolean' },
        { status: 400 }
      )
    }

    // Upsert user role
    const { data, error } = await supabase
      .from('user_roles')
      .upsert({
        user_id: userId,
        is_super_admin: newAdminStatus,
      }, {
        onConflict: 'user_id',
      })
      .select()
      .single()

    if (error) {
      console.error('Error updating user role:', error)
      return NextResponse.json(
        { error: 'Failed to update user role' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      success: true,
      user: {
        id: userId,
        isSuperAdmin: data.is_super_admin,
      }
    })
  } catch (error: any) {
    console.error('Error updating user role:', error)
    return NextResponse.json(
      { error: 'Failed to update user role' },
      { status: 500 }
    )
  }
}

