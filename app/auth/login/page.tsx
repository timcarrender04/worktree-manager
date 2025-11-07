'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth/AuthProvider'
// import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  // const supabase = createClient()

  // If user is already authenticated, redirect
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/projects')
    }
  }, [user, authLoading, router])

  // After successful sign-in, wait for auth state to update
  useEffect(() => {
    if (isSigningIn && !authLoading && user) {
      setIsSigningIn(false)
      // Small delay to ensure state is fully updated
      setTimeout(() => {
        router.push('/projects')
        router.refresh()
      }, 100)
    }
  }, [isSigningIn, authLoading, user, router])

  // Timeout fallback: if session doesn't update within 3 seconds, navigate anyway
  useEffect(() => {
    if (isSigningIn) {
      const timeout = setTimeout(() => {
        if (isSigningIn) {
          setIsSigningIn(false)
          router.push('/projects')
          router.refresh()
        }
      }, 3000)
      return () => clearTimeout(timeout)
    }
  }, [isSigningIn, router])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sign in')
      }

      // Success - wait a moment for cookie to be set, then trigger refetch
      // Dispatch event multiple times to ensure it's caught
      setTimeout(() => {
        window.dispatchEvent(new Event('auth:signin'))
      }, 100)
      setTimeout(() => {
        window.dispatchEvent(new Event('auth:signin'))
      }, 300)
      
      // Set flag to wait for auth state to update
      setIsSigningIn(true)
      setLoading(false)
      // Navigation will happen via useEffect when user state is ready
    } catch (error: any) {
      setError(error.message || 'Failed to sign in')
      setLoading(false)
    }
  }

  // Show loading state while checking auth or signing in
  if (authLoading || isSigningIn) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-xl">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or{' '}
            <a
              href="/auth/signup"
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              create a new account
            </a>
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <div className="text-sm text-red-800">{error}</div>
            </div>
          )}
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm">
              <a
                href="/auth/forgot-password"
                className="font-medium text-blue-600 hover:text-blue-500"
              >
                Forgot your password?
              </a>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

