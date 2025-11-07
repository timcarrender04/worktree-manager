import { createClient } from '@/lib/supabase/server'
import bcrypt from 'bcryptjs'

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

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
      .maybeSingle()
    
    if (error) {
      console.error('Error checking super admin status:', error)
      return false
    }
    
    return data?.is_super_admin === true
  } catch (error) {
    console.error('Error checking super admin status:', error)
    return false
  }
}

/**
 * Get user role information
 */
export async function getUserRole(userId: string): Promise<{ isSuperAdmin: boolean }> {
  const isAdmin = await isSuperAdmin(userId)
  return { isSuperAdmin: isAdmin }
}

/**
 * Get authenticated user from session
 * For worktree-manager, we'll use a simple session-based auth
 */
export async function getAuthenticatedUser(request?: Request): Promise<{ id: string; email: string } | null> {
  try {
    // For now, we'll implement a simple cookie-based session
    // In the future, this could use Supabase Auth or JWT tokens
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (user) {
      return {
        id: user.id,
        email: user.email || '',
      }
    }
    
    return null
  } catch (error) {
    console.error('Error getting authenticated user:', error)
    return null
  }
}
