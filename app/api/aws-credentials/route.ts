import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'
import { validateAWSCredentials } from '@/lib/credentials/helpers'

// Helper to get authenticated user (DEV: returns default 'dev' user if no auth)
async function getAuthenticatedUser(request: Request): Promise<{ id: string; email: string } | null> {
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

  if (isUsingNeon) {
    // DEV: Return default dev user for local development
    return { id: 'dev', email: 'dev@local' }
  }

  // DEV: Check if we're in dev mode (no auth required)
  const isDevMode = process.env.NODE_ENV === 'development' || !process.env.NEXT_PUBLIC_SUPABASE_URL
  if (isDevMode) {
    return { id: 'dev', email: 'dev@local' }
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
 * GET /api/aws-credentials
 * List all AWS credentials for the authenticated user
 */
export async function GET(request: Request) {
  try {
    // DEV: AWS credentials work without auth in development
    let user = await getAuthenticatedUser(request)
    if (!user) {
      // DEV: Use default dev user in dev mode
      const isDevMode = process.env.NODE_ENV === 'development' || !process.env.NEXT_PUBLIC_SUPABASE_URL
      if (!isDevMode) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      // Use default dev user
      user = { id: 'dev', email: 'dev@local' }
    }

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      try {
        const result = await query(
          `
          SELECT id, profile_name, region, default_profile, created_at, updated_at
          FROM user_aws_credentials
          WHERE user_id = $1
          ORDER BY default_profile DESC, created_at ASC
          `,
          [user.id]
        )

        return NextResponse.json({ credentials: result.rows || [] })
      } catch (dbError: any) {
        // If table doesn't exist or other DB error, return empty array
        if (dbError.message?.includes('does not exist') || dbError.message?.includes('relation')) {
          console.warn('AWS credentials table does not exist, returning empty array:', dbError.message)
          return NextResponse.json({ credentials: [] })
        }
        throw dbError
      }
    } else {
      // Using Supabase
      const supabase = await createClient()

      // Check if user.id is a valid UUID for Supabase
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)
      
      if (!isUUID && user.id === 'dev') {
        // In dev mode with Supabase, try to use service role client or return empty
        // This handles the case where 'dev' user doesn't exist in auth.users
        try {
          // Try to use service role client for dev mode
          const { createServiceRoleClient } = await import('@/lib/supabase/server')
          const serviceClient = createServiceRoleClient()
          
          // Try to find any credentials (dev mode bypass)
          const { data, error } = await serviceClient
            .from('user_aws_credentials')
            .select('id, profile_name, region, default_profile, created_at, updated_at')
            .eq('user_id', user.id)
            .order('default_profile', { ascending: false })
            .order('created_at', { ascending: true })

          if (error) {
            console.warn('Error fetching AWS credentials with service role (dev mode):', error)
            // Return empty array instead of error for dev mode
            return NextResponse.json({ credentials: [] })
          }

          return NextResponse.json({ credentials: data || [] })
        } catch (serviceError: any) {
          // If service role client fails, just return empty array for dev mode
          console.warn('Service role client not available, returning empty credentials for dev mode:', serviceError.message)
          return NextResponse.json({ credentials: [] })
        }
      }

      // Normal Supabase query with UUID user
      const { data, error } = await supabase
        .from('user_aws_credentials')
        .select('id, profile_name, region, default_profile, created_at, updated_at')
        .eq('user_id', user.id)
        .order('default_profile', { ascending: false })
        .order('created_at', { ascending: true })

      if (error) {
        // Check if it's a table/relation error
        if (error.message?.includes('does not exist') || error.code === 'PGRST116') {
          console.warn('AWS credentials table does not exist, returning empty array:', error.message)
          return NextResponse.json({ credentials: [] })
        }
        console.error('Error fetching AWS credentials:', error)
        return NextResponse.json({ 
          error: 'Failed to fetch credentials',
          details: error.message 
        }, { status: 500 })
      }

      return NextResponse.json({ credentials: data || [] })
    }
  } catch (error: any) {
    console.error('Error in GET /api/aws-credentials:', error)
    
    // Return empty array instead of error if it's a table/relation issue
    if (error.message?.includes('does not exist') || error.message?.includes('relation')) {
      console.warn('AWS credentials table does not exist, returning empty array')
      return NextResponse.json({ credentials: [] })
    }
    
    return NextResponse.json(
      { 
        error: error.message || 'Internal server error',
        details: error.stack 
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/aws-credentials
 * Add a new AWS credential profile
 */
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { profile_name, access_key_id, secret_access_key, region, default_profile } = body

    if (!profile_name || !access_key_id || !secret_access_key) {
      return NextResponse.json(
        { error: 'profile_name, access_key_id, and secret_access_key are required' },
        { status: 400 }
      )
    }

    // Validate credentials format
    const isValid = await validateAWSCredentials(access_key_id, secret_access_key)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid AWS credentials format' },
        { status: 400 }
      )
    }

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      try {
        // Check if profile name already exists
        const existing = await query(
          `SELECT id FROM user_aws_credentials WHERE user_id = $1 AND profile_name = $2`,
          [user.id, profile_name]
        )

        if (existing.rows.length > 0) {
          return NextResponse.json(
            { error: 'A profile with this name already exists' },
            { status: 400 }
          )
        }

        // If setting as default, unset other defaults
        if (default_profile) {
          await query(
            `UPDATE user_aws_credentials SET default_profile = false WHERE user_id = $1`,
            [user.id]
          )
        }

        const result = await query(
          `
          INSERT INTO user_aws_credentials 
            (user_id, profile_name, access_key_id, secret_access_key, region, default_profile)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, profile_name, region, default_profile, created_at, updated_at
          `,
          [user.id, profile_name, access_key_id, secret_access_key, region || 'us-east-1', default_profile || false]
        )

        if (result.rows.length === 0) {
          console.error('Failed to create credential: INSERT returned no rows')
          return NextResponse.json(
            { 
              error: 'Failed to create credential',
              details: 'Database insert returned no rows. This may indicate a database constraint violation or trigger issue.'
            },
            { status: 500 }
          )
        }

        return NextResponse.json({ credential: result.rows[0] }, { status: 201 })
      } catch (dbError: any) {
        // Check if table doesn't exist
        if (dbError.message?.includes('does not exist') || dbError.message?.includes('relation')) {
          console.error('AWS credentials table does not exist:', dbError.message)
          return NextResponse.json(
            { 
              error: 'Database table does not exist. Please run migrations to create the user_aws_credentials table.',
              details: dbError.message 
            },
            { status: 500 }
          )
        }
        console.error('Database error creating AWS credential:', dbError)
        return NextResponse.json(
          { 
            error: 'Failed to create credential',
            details: dbError.message 
          },
          { status: 500 }
        )
      }
    } else {
      // Using Supabase
      const supabase = await createClient()

      // Check if user.id is a valid UUID for Supabase
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)
      
      if (!isUUID && user.id === 'dev') {
        // In dev mode with Supabase, try to use service role client
        try {
          const { createServiceRoleClient } = await import('@/lib/supabase/server')
          const serviceClient = createServiceRoleClient()
          
          // Check if profile name already exists
          const { data: existing } = await serviceClient
            .from('user_aws_credentials')
            .select('id')
            .eq('user_id', user.id)
            .eq('profile_name', profile_name)
            .single()

          if (existing) {
            return NextResponse.json(
              { error: 'A profile with this name already exists' },
              { status: 400 }
            )
          }

          // If setting as default, unset other defaults
          if (default_profile) {
            await serviceClient
              .from('user_aws_credentials')
              .update({ default_profile: false })
              .eq('user_id', user.id)
              .eq('default_profile', true)
          }

          const { data, error } = await serviceClient
            .from('user_aws_credentials')
            .insert({
              user_id: user.id,
              profile_name,
              access_key_id,
              secret_access_key,
              region: region || 'us-east-1',
              default_profile: default_profile || false,
            })
            .select('id, profile_name, region, default_profile, created_at, updated_at')
            .single()

          if (error) {
            console.error('Error creating AWS credential with service role:', error)
            // Check for specific error types
            if (error.code === '23503') {
              return NextResponse.json(
                { 
                  error: 'Invalid user ID. The user_id must be a valid UUID that exists in auth.users table.',
                  details: error.message,
                  hint: 'For dev mode, you may need to create a dev user in auth.users or modify the table schema to allow TEXT user_id.'
                },
                { status: 400 }
              )
            }
            if (error.code === '42P01' || error.message?.includes('does not exist')) {
              return NextResponse.json(
                { 
                  error: 'Database table does not exist. Please run migrations to create the user_aws_credentials table.',
                  details: error.message 
                },
                { status: 500 }
              )
            }
            return NextResponse.json(
              { 
                error: 'Failed to create credential',
                details: error.message,
                code: error.code,
                hint: error.hint
              },
              { status: 500 }
            )
          }

          return NextResponse.json({ credential: data }, { status: 201 })
        } catch (serviceError: any) {
          console.error('Service role client error:', serviceError)
          // Check if service role key is missing
          if (serviceError.message?.includes('SUPABASE_SERVICE_ROLE_KEY') || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            return NextResponse.json(
              { 
                error: 'Service role key not configured. SUPABASE_SERVICE_ROLE_KEY environment variable is required for dev mode.',
                details: serviceError.message,
                hint: 'Set SUPABASE_SERVICE_ROLE_KEY in your environment variables to enable dev mode credential creation.'
              },
              { status: 500 }
            )
          }
          return NextResponse.json(
            { 
              error: 'Failed to create credential. Database may not be properly configured.',
              details: serviceError.message,
              stack: process.env.NODE_ENV === 'development' ? serviceError.stack : undefined
            },
            { status: 500 }
          )
        }
      }

      // Normal Supabase query with UUID user
      // Check if profile name already exists
      const { data: existing } = await supabase
        .from('user_aws_credentials')
        .select('id')
        .eq('user_id', user.id)
        .eq('profile_name', profile_name)
        .single()

      if (existing) {
        return NextResponse.json(
          { error: 'A profile with this name already exists' },
          { status: 400 }
        )
      }

      // If setting as default, unset other defaults (trigger handles this, but we can be explicit)
      if (default_profile) {
        await supabase
          .from('user_aws_credentials')
          .update({ default_profile: false })
          .eq('user_id', user.id)
          .eq('default_profile', true)
      }

      const { data, error } = await supabase
        .from('user_aws_credentials')
        .insert({
          user_id: user.id,
          profile_name,
          access_key_id,
          secret_access_key,
          region: region || 'us-east-1',
          default_profile: default_profile || false,
        })
        .select('id, profile_name, region, default_profile, created_at, updated_at')
        .single()

      if (error) {
        // Check if it's a table/relation error
        if (error.message?.includes('does not exist') || error.code === 'PGRST116') {
          console.error('AWS credentials table does not exist:', error.message)
          return NextResponse.json(
            { 
              error: 'Database table does not exist. Please run migrations to create the user_aws_credentials table.',
              details: error.message 
            },
            { status: 500 }
          )
        }
        // Check for foreign key constraint violation (invalid user_id)
        if (error.code === '23503') {
          return NextResponse.json(
            { 
              error: 'Invalid user ID. The user_id must be a valid UUID that exists in auth.users table.',
              details: error.message,
              hint: 'For dev mode, you may need to create a dev user in auth.users or modify the table schema to allow TEXT user_id.'
            },
            { status: 400 }
          )
        }
        console.error('Error creating AWS credential:', error)
        return NextResponse.json(
          { 
            error: 'Failed to create credential',
            details: error.message,
            code: error.code,
            hint: error.hint
          },
          { status: 500 }
        )
      }

      return NextResponse.json({ credential: data }, { status: 201 })
    }
  } catch (error: any) {
    console.error('Error in POST /api/aws-credentials:', error)
    return NextResponse.json(
      { 
        error: error.message || 'Internal server error',
        details: error.stack && process.env.NODE_ENV === 'development' ? error.stack : undefined
      },
      { status: 500 }
    )
  }
}

