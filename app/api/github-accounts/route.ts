import { NextResponse } from 'next/server'
import { createGitHubClient } from '@/lib/github/client'
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs'
import path from 'path'
import os from 'os'
import { query } from '@/lib/db/client'

// Helper function to get GitHub token from environment (.env.local) or files
function getGitHubToken(): string | null {
  // First check process.env (which includes .env.local via Next.js)
  let token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    // Fallback to reading from files (for backward compatibility)
    const ROOT_DIR = process.cwd();
    const homeDir = os.homedir();
    const username = process.env.USER || process.env.USERNAME || 'root';
    const userHomeDir = path.join('/home', username);
    
    const tokenFiles = [
      path.join(ROOT_DIR, '..', '.github-token'),
      path.join(ROOT_DIR, '..', 'token'),
      path.join(ROOT_DIR, '..', 'GITHUB_TOKEN'),
      path.join(ROOT_DIR, '.github-token'),
      path.join(ROOT_DIR, 'token'),
      path.join(ROOT_DIR, 'GITHUB_TOKEN'),
      path.join(homeDir, '.github-token'),
      path.join(homeDir, 'token'),
      path.join(homeDir, 'GITHUB_TOKEN'),
      path.join(userHomeDir, '.github-token'),
      path.join(userHomeDir, 'token'),
      path.join(userHomeDir, 'GITHUB_TOKEN'),
      path.join('/home', '.github-token'),
      path.join('/home', 'token'),
      path.join('/home', 'GITHUB_TOKEN'),
    ];
    
    for (const tokenFile of tokenFiles) {
      try {
        if (existsSync(tokenFile)) {
          console.log(`[getGitHubToken] Found token file at: ${tokenFile}`);
          token = readFileSync(tokenFile, 'utf-8').trim();
          break;
        }
      } catch (error) {
        // Continue to next file
        console.debug(`[getGitHubToken] Error checking ${tokenFile}:`, error);
      }
    }
    
    if (!token) {
      console.log(`[getGitHubToken] Token not found. Checked ${tokenFiles.length} locations.`);
      console.log(`[getGitHubToken] Home dir: ${homeDir}, User: ${username}, ROOT_DIR: ${ROOT_DIR}`);
    }
  }
  
  return token || null;
}

export async function GET() {
  try {
    const accounts: any[] = [];
    
    // First, check for GITHUB_TOKEN in environment variables
    const envToken = getGitHubToken();
    if (envToken) {
      try {
        // Validate the token by fetching the user
        const githubClient = createGitHubClient(envToken);
        const githubUser = await githubClient.getAuthenticatedUser();
        
        // Add a virtual account from environment variable
        accounts.push({
          id: 'env-default', // Special ID to indicate it's from env
          account_name: 'Default (from .env)',
          github_username: githubUser.login,
          created_at: new Date().toISOString(),
          from_env: true, // Flag to indicate this is from environment
        });
      } catch (error) {
        console.warn('GITHUB_TOKEN from environment is invalid:', error);
        // Continue to check database accounts
      }
    }

    // Check if using Neon (direct database) or local dev
    // Prioritize Neon if DATABASE_URL is set (even if Supabase is also configured)
    const isUsingNeon = !!process.env.DATABASE_URL
    const isLocalDev = !isUsingNeon && (
      process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost') || 
      process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1')
    )

    if (isUsingNeon || (isLocalDev && process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      // Use direct database connection for Neon or local dev
      try {
        // For local dev, set default connection params if not set
        if (isLocalDev && !process.env.DATABASE_URL && !process.env.PGHOST) {
          process.env.PGHOST = 'localhost'
          process.env.PGPORT = '5433'
          process.env.PGUSER = 'postgres'
          process.env.PGPASSWORD = process.env.POSTGRES_PASSWORD || 'postgres'
          process.env.PGDATABASE = 'repo_hub'
        }
        
        const { query } = await import('@/lib/db/client')
        // Use 'dev' user_id for development mode
        const userId = 'dev'
        const result = await query(
          `SELECT id, account_name, github_username, created_at 
           FROM github_accounts 
           WHERE user_id = $1 
           ORDER BY created_at DESC`,
          [userId]
        )
        
        if (result.rows.length > 0) {
          accounts.push(...result.rows)
        }
      } catch (error: any) {
        console.warn('Error fetching GitHub accounts from database:', error.message)
      }
    } else {
      // Use Supabase client for remote Supabase
      try {
        if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
          const { createClient } = await import('@/lib/supabase/server')
          const supabase = await createClient()
          const {
            data: { user },
            error: authError,
          } = await supabase.auth.getUser()

          // DEV: In dev mode, allow fetching accounts even without auth
          if (!authError && user) {
            // Fetch accounts from Supabase
            const { data: dbAccounts, error: dbError } = await supabase
              .from('github_accounts')
              .select('id, account_name, github_username, created_at')
              .eq('user_id', user.id)
              .order('created_at', { ascending: false })

            if (!dbError && dbAccounts) {
              accounts.push(...dbAccounts)
            }
          } else if (process.env.NODE_ENV === 'development') {
            // DEV: In dev mode, try to fetch accounts for 'dev' user
            const { data: dbAccounts, error: dbError } = await supabase
              .from('github_accounts')
              .select('id, account_name, github_username, created_at')
              .eq('user_id', 'dev')
              .order('created_at', { ascending: false })

            if (!dbError && dbAccounts) {
              accounts.push(...dbAccounts)
            }
          }
        }
      } catch (error: any) {
        // If Supabase is not configured or there's an error, continue with env-based account only
        console.warn('Error accessing Supabase for GitHub accounts:', error.message)
      }
    }

    return NextResponse.json({ accounts })
  } catch (error: any) {
    console.error('Error in GET /api/github-accounts:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error', accounts: [] },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    // Check if using Neon - if so, return error (not implemented yet)
    if (process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json(
        { error: 'GitHub account creation not yet implemented for Neon. Use env-default account.' },
        { status: 501 }
      )
    }

    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json(
        { error: 'Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL environment variable.' },
        { status: 500 }
      )
    }

    let supabase;
    try {
      const { createClient } = await import('@/lib/supabase/server')
      supabase = await createClient()
    } catch (error: any) {
      console.error('Error creating Supabase client:', error)
      return NextResponse.json(
        { error: `Failed to create Supabase client: ${error.message}` },
        { status: 500 }
      )
    }
    
    // Get authenticated user (DEV: allow 'dev' user in dev mode)
    let userId: string | null = null;
    
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (!authError && user) {
        userId = user.id;
      } else if (process.env.NODE_ENV === 'development') {
        // DEV: Use 'dev' user in development mode
        userId = 'dev';
      } else {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }
    } catch (error: any) {
      // If auth fails but we're in dev mode, use dev user
      if (process.env.NODE_ENV === 'development') {
        userId = 'dev';
      } else {
        return NextResponse.json(
          { error: 'Authentication failed' },
          { status: 401 }
        )
      }
    }

    const body = await request.json()
    const { account_name, token } = body

    if (!account_name || !token) {
      return NextResponse.json(
        { error: 'account_name and token are required' },
        { status: 400 }
      )
    }

    // Validate token with GitHub API
    let githubUser: { login: string } | null = null
    
    try {
      const githubClient = createGitHubClient(token)
      githubUser = await githubClient.getAuthenticatedUser()
    } catch (error: any) {
      console.error('GitHub token validation error:', error)
      return NextResponse.json(
        { error: `Invalid GitHub token: ${error.message || 'Please check your token and try again.'}` },
        { status: 400 }
      )
    }

    // For dev mode with local Supabase, use direct database connection
    const isLocalDev = process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost') || 
                       process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1')

    if (isLocalDev) {
      // Use direct database connection for local dev
      // Set DB connection env vars if not already set
      if (!process.env.DATABASE_URL && !process.env.PGHOST) {
        process.env.PGHOST = 'localhost'
        process.env.PGPORT = '5433'
        process.env.PGUSER = 'postgres'
        process.env.PGPASSWORD = process.env.POSTGRES_PASSWORD || 'postgres'
        process.env.PGDATABASE = 'repo_hub'
      }
      
      const { query } = await import('@/lib/db/client')
      
      // Check if account name already exists
      const existingResult = await query(
        `SELECT id FROM github_accounts WHERE user_id = $1 AND account_name = $2`,
        [userId, account_name]
      )

      if (existingResult.rows.length > 0) {
        return NextResponse.json(
          { error: 'An account with this name already exists' },
          { status: 400 }
        )
      }

      // Insert account
      const result = await query(
        `INSERT INTO github_accounts (user_id, account_name, encrypted_token, github_username)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, account_name, github_username, created_at`,
        [userId, account_name, token, githubUser.login]
      )

      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: 'Failed to create GitHub account' },
          { status: 500 }
        )
      }

      // Also update .env.local/.env file with GITHUB_TOKEN
      try {
        const projectRoot = process.cwd();
        const envLocalPath = path.join(projectRoot, '.env.local');
        const envPath = path.join(projectRoot, '.env');
        
        // Prefer .env.local, fallback to .env
        const envFile = existsSync(envLocalPath) ? envLocalPath : envPath;
        
        let envContent = '';
        if (existsSync(envFile)) {
          envContent = readFileSync(envFile, 'utf-8');
        }
        
        // Update or add GITHUB_TOKEN
        const lines = envContent.split('\n');
        let found = false;
        const updatedLines = lines.map(line => {
          if (line.startsWith('GITHUB_TOKEN=')) {
            found = true;
            return `GITHUB_TOKEN=${token}`;
          }
          return line;
        });
        
        if (!found) {
          // Add GITHUB_TOKEN if it doesn't exist
          if (envContent && !envContent.endsWith('\n')) {
            updatedLines.push('');
          }
          updatedLines.push(`GITHUB_TOKEN=${token}`);
        }
        
        writeFileSync(envFile, updatedLines.join('\n'), 'utf-8');
        console.log(`[API /github-accounts] Updated ${envFile} with GITHUB_TOKEN`);
      } catch (envError: any) {
        console.error('[API /github-accounts] Error updating .env file:', envError);
        // Don't fail the request if env file update fails
      }

      // Create bucket for the account (non-blocking)
      try {
        const { createBucketForAccount } = await import('@/lib/buckets/service')
        const bucketResult = await createBucketForAccount(
          result.rows[0].id,
          account_name,
          userId
        )
        if (bucketResult.success && bucketResult.bucket) {
          console.log(`[API /github-accounts] Created bucket ${bucketResult.bucket.bucket_name} for account ${account_name}`)
        } else {
          console.warn(`[API /github-accounts] Failed to create bucket for account ${account_name}:`, bucketResult.error)
        }
      } catch (bucketError: any) {
        console.error('[API /github-accounts] Error creating bucket:', bucketError)
        // Don't fail the request if bucket creation fails
      }

      return NextResponse.json({ account: result.rows[0] })
    } else {
      // Use Supabase client for remote Supabase
      // Check if account name already exists for this user
      const { data: existing } = await supabase
        .from('github_accounts')
        .select('id')
        .eq('user_id', userId)
        .eq('account_name', account_name)
        .single()

      if (existing) {
        return NextResponse.json(
          { error: 'An account with this name already exists' },
          { status: 400 }
        )
      }

      // Store encrypted token (for now, we'll store it as-is; in production use encryption)
      // TODO: Implement proper encryption using Supabase Vault or pgcrypto
      const { data: account, error } = await supabase
        .from('github_accounts')
        .insert({
          user_id: userId,
          account_name,
          encrypted_token: token, // In production, encrypt this
          github_username: githubUser.login,
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating GitHub account:', error)
        return NextResponse.json(
          { error: `Failed to create GitHub account: ${error.message || JSON.stringify(error)}` },
          { status: 500 }
        )
      }

      // Also update .env.local/.env file with GITHUB_TOKEN
      try {
        const projectRoot = process.cwd();
        const envLocalPath = path.join(projectRoot, '.env.local');
        const envPath = path.join(projectRoot, '.env');
        
        // Prefer .env.local, fallback to .env
        const envFile = existsSync(envLocalPath) ? envLocalPath : envPath;
        
        let envContent = '';
        if (existsSync(envFile)) {
          envContent = readFileSync(envFile, 'utf-8');
        }
        
        // Update or add GITHUB_TOKEN
        const lines = envContent.split('\n');
        let found = false;
        const updatedLines = lines.map(line => {
          if (line.startsWith('GITHUB_TOKEN=')) {
            found = true;
            return `GITHUB_TOKEN=${token}`;
          }
          return line;
        });
        
        if (!found) {
          // Add GITHUB_TOKEN if it doesn't exist
          if (envContent && !envContent.endsWith('\n')) {
            updatedLines.push('');
          }
          updatedLines.push(`GITHUB_TOKEN=${token}`);
        }
        
        writeFileSync(envFile, updatedLines.join('\n'), 'utf-8');
        console.log(`[API /github-accounts] Updated ${envFile} with GITHUB_TOKEN`);
      } catch (envError: any) {
        console.error('[API /github-accounts] Error updating .env file:', envError);
        // Don't fail the request if env file update fails
      }

      // Create bucket for the account (non-blocking)
      try {
        const { createBucketForAccount } = await import('@/lib/buckets/service')
        const bucketResult = await createBucketForAccount(
          account.id,
          account_name,
          userId
        )
        if (bucketResult.success && bucketResult.bucket) {
          console.log(`[API /github-accounts] Created bucket ${bucketResult.bucket.bucket_name} for account ${account_name}`)
        } else {
          console.warn(`[API /github-accounts] Failed to create bucket for account ${account_name}:`, bucketResult.error)
        }
      } catch (bucketError: any) {
        console.error('[API /github-accounts] Error creating bucket:', bucketError)
        // Don't fail the request if bucket creation fails
      }

      // Return account without the token
      const { encrypted_token, ...accountWithoutToken } = account
      return NextResponse.json({ account: accountWithoutToken })
    }
  } catch (error: any) {
    console.error('Error in POST /api/github-accounts:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    // Check if using Neon - if so, return error (not implemented yet)
    if (process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json(
        { error: 'GitHub account deletion not yet implemented for Neon.' },
        { status: 501 }
      )
    }

    // Check if Supabase is configured
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json(
        { error: 'Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL environment variable.' },
        { status: 500 }
      )
    }

    // For dev mode with local Supabase, use direct database connection
    const isLocalDev = process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost') || 
                       process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1')

    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Account ID is required' },
        { status: 400 }
      )
    }

    let userId: string | null = null;

    if (isLocalDev) {
      // Use direct database connection for local dev
      // Set DB connection env vars if not already set
      if (!process.env.DATABASE_URL && !process.env.PGHOST) {
        process.env.PGHOST = 'localhost'
        process.env.PGPORT = '5433'
        process.env.PGUSER = 'postgres'
        process.env.PGPASSWORD = process.env.POSTGRES_PASSWORD || 'postgres'
        process.env.PGDATABASE = 'repo_hub'
      }
      
      const { query } = await import('@/lib/db/client')
      
      // Use 'dev' user in local dev mode
      userId = 'dev';

      // Get the token before deleting (to remove from .env if it matches)
      const { rows: accountRows } = await query(
        `SELECT encrypted_token FROM github_accounts WHERE id = $1 AND user_id = $2`,
        [id, userId]
      )
      
      const accountToken = accountRows.length > 0 ? accountRows[0].encrypted_token : null;

      // Delete the account (ensure user can only delete their own)
      await query(
        `DELETE FROM github_accounts
         WHERE id = $1 AND user_id = $2`,
        [id, userId]
      )

      // If this was the token in .env.local, remove it
      if (accountToken && process.env.GITHUB_TOKEN === accountToken) {
        try {
          const projectRoot = process.cwd();
          const envLocalPath = path.join(projectRoot, '.env.local');
          const envPath = path.join(projectRoot, '.env');
          
          const envFile = existsSync(envLocalPath) ? envLocalPath : envPath;
          
          if (existsSync(envFile)) {
            const envContent = readFileSync(envFile, 'utf-8');
            const lines = envContent.split('\n').filter(line => !line.startsWith('GITHUB_TOKEN='));
            writeFileSync(envFile, lines.join('\n'), 'utf-8');
            console.log(`[API /github-accounts] Removed GITHUB_TOKEN from ${envFile}`);
          }
        } catch (envError: any) {
          console.error('[API /github-accounts] Error removing GITHUB_TOKEN from .env file:', envError);
        }
      }

      return NextResponse.json({ success: true })
    } else {
      // Use Supabase client for remote Supabase
      let supabase;
      try {
        const { createClient } = await import('@/lib/supabase/server')
        supabase = await createClient()
      } catch (error: any) {
        console.error('Error creating Supabase client:', error)
        return NextResponse.json(
          { error: `Failed to create Supabase client: ${error.message}` },
          { status: 500 }
        )
      }
      
      // Get authenticated user (DEV: allow 'dev' user in dev mode)
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      
      if (!authError && user) {
        userId = user.id;
      } else if (process.env.NODE_ENV === 'development') {
        // DEV: Use 'dev' user in development mode
        userId = 'dev';
      } else {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        )
      }

      // Get the token before deleting (to remove from .env if it matches)
      const { data: accountData } = await supabase
        .from('github_accounts')
        .select('encrypted_token')
        .eq('id', id)
        .eq('user_id', userId)
        .single()

      const accountToken = accountData?.encrypted_token || null;

      // Delete the account (RLS will ensure user can only delete their own)
      const { error } = await supabase
        .from('github_accounts')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)

      if (error) {
        console.error('Error deleting GitHub account:', error)
        return NextResponse.json(
          { error: 'Failed to delete GitHub account' },
          { status: 500 }
        )
      }

      // If this was the token in .env.local, remove it
      if (accountToken && process.env.GITHUB_TOKEN === accountToken) {
        try {
          const projectRoot = process.cwd();
          const envLocalPath = path.join(projectRoot, '.env.local');
          const envPath = path.join(projectRoot, '.env');
          
          const envFile = existsSync(envLocalPath) ? envLocalPath : envPath;
          
          if (existsSync(envFile)) {
            const envContent = readFileSync(envFile, 'utf-8');
            const lines = envContent.split('\n').filter(line => !line.startsWith('GITHUB_TOKEN='));
            writeFileSync(envFile, lines.join('\n'), 'utf-8');
            console.log(`[API /github-accounts] Removed GITHUB_TOKEN from ${envFile}`);
          }
        } catch (envError: any) {
          console.error('[API /github-accounts] Error removing GITHUB_TOKEN from .env file:', envError);
        }
      }

      return NextResponse.json({ success: true })
    }
  } catch (error: any) {
    console.error('Error in DELETE /api/github-accounts:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

