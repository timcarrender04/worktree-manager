import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { verifyPassword } from '@/lib/auth/helpers'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Try service role client first, fallback to direct PostgreSQL
    let user: { id: string; email: string; password: string; name: string | null } | null = null
    
    try {
      const supabase = createServiceRoleClient()
      const { data: supabaseUser, error: userError } = await supabase
        .from('users')
        .select('id, email, password, name')
        .eq('email', email.toLowerCase())
        .maybeSingle()

      if (!userError && supabaseUser) {
        user = supabaseUser
      } else if (userError) {
        console.warn('Supabase query failed, trying direct PostgreSQL:', userError.message)
        throw userError
      }
    } catch (supabaseError) {
      // Fallback to direct PostgreSQL connection
      console.log('Using direct PostgreSQL connection for authentication')
      const { Pool } = await import('pg')
      const pool = new Pool({
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || 'repo_hub',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
      })
      
      const result = await pool.query(
        'SELECT id, email, password, name FROM users WHERE email = $1',
        [email.toLowerCase()]
      )
      
      await pool.end()
      
      if (result.rows.length > 0) {
        user = result.rows[0]
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // If user doesn't have a password set
    if (!user.password) {
      return NextResponse.json(
        { error: 'Password not set. Please use password reset.' },
        { status: 401 }
      )
    }

    // Verify password
    const isValid = await verifyPassword(password, user.password)

    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Create session token (simple JWT-like approach)
    // In production, use a proper JWT library
    const sessionToken = Buffer.from(JSON.stringify({
      userId: user.id,
      email: user.email,
      exp: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days
    })).toString('base64')

    // Set session cookie
    const cookieStore = await cookies()
    cookieStore.set('wt_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    })

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      message: 'Signed in successfully',
    })
  } catch (error: any) {
    console.error('Error in signin:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to sign in' },
      { status: 500 }
    )
  }
}

