import { createClient } from '@/lib/supabase/server'

/**
 * Check if a user is a super admin
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('user_roles')
      .select('is_super_admin')
      .eq('user_id', userId)
      .single()
    
    if (error || !data) {
      return false
    }
    
    return data.is_super_admin === true
  } catch (error) {
    console.error('Error checking super admin status:', error)
    return false
  }
}

/**
 * Get user role information
 */
export async function getUserRole(userId: string): Promise<{ isSuperAdmin: boolean }> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('user_roles')
      .select('is_super_admin')
      .eq('user_id', userId)
      .single()
    
    if (error || !data) {
      return { isSuperAdmin: false }
    }
    
    return { isSuperAdmin: data.is_super_admin === true }
  } catch (error) {
    console.error('Error getting user role:', error)
    return { isSuperAdmin: false }
  }
}

