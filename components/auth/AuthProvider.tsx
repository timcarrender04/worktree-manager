'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { User } from '@supabase/supabase-js'

type AuthContextType = {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
})

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Get initial session
    const getSession = async () => {
      setLoading(true)
      try {
        // Check for session cookie first (from our custom signin)
        const response = await fetch('/api/auth/me', {
          credentials: 'include', // Important: include cookies
          cache: 'no-store', // Ensure we don't get cached responses
        })
        
        if (response.ok) {
          const data = await response.json()
          console.log('AuthProvider: /api/auth/me response:', data)
          
          if (data.user) {
            // Create a user object from the session data
            const userObj = {
              id: data.user.id,
              email: data.user.email,
              // Add other required User properties
            } as User
            console.log('AuthProvider: Setting user from session:', userObj.email)
            setUser(userObj)
            setLoading(false)
            return
          }
        } else {
          console.log('AuthProvider: /api/auth/me returned non-OK status:', response.status)
        }
      } catch (error) {
        console.error('AuthProvider: Error checking session:', error)
      }

      // No session found from cookie, clear user
      console.log('AuthProvider: No session found, clearing user')
      setUser(null)
      setLoading(false)
      
      // If we're on a protected route, redirect to login
      const protectedRoutes = ['/projects', '/settings', '/']
      const isProtectedRoute = protectedRoutes.some(route => 
        pathname === route || (route !== '/' && pathname?.startsWith(route))
      )
      
      if (isProtectedRoute && pathname !== '/auth/login') {
        console.log('AuthProvider: On protected route without session, redirecting to login')
        router.push('/auth/login')
      }
      
      return
    }

    getSession()

    // Listen for custom auth:signin event to refetch session after login
    const handleSignIn = async () => {
      console.log('AuthProvider: Received auth:signin event, refetching session...')
      // Add a small delay to ensure cookie is set
      await new Promise(resolve => setTimeout(resolve, 200))
      await getSession()
    }

    window.addEventListener('auth:signin', handleSignIn)

    return () => {
      window.removeEventListener('auth:signin', handleSignIn)
    }
  }, [pathname, router])

  // Redirect to login if on protected route without user (after loading completes)
  useEffect(() => {
    const protectedRoutes = ['/projects', '/settings', '/']
    const isProtectedRoute = protectedRoutes.some(route => 
      pathname === route || (route !== '/' && pathname?.startsWith(route))
    )
    
    if (!loading && !user && isProtectedRoute && pathname && pathname !== '/auth/login') {
      console.log('AuthProvider: No user on protected route, redirecting to login')
      router.push('/auth/login')
    }
  }, [pathname, user, loading, router])

  const signOut = async () => {
    try {
      // Clear our custom session cookie
      await fetch('/api/auth/signout', { method: 'POST', credentials: 'include' })
      
      setUser(null)
      // Redirect to login page
      router.push('/auth/login')
      router.refresh()
    } catch (error) {
      console.error('Error signing out:', error)
      // Still clear local state and redirect
      setUser(null)
      router.push('/auth/login')
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
