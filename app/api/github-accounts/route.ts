import { NextResponse } from 'next/server'
import { createGitHubClient } from '@/lib/github/client'
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import { query } from '@/lib/db/client'

// Helper function to get GitHub token from environment (.env.local) or files
function getGitHubToken(): string | null {
  // First check process.env (which includes .env.local via Next.js)
  let token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    // Fallback to reading from files (for backward compatibility)
    const ROOT_DIR = process.cwd();
    const tokenFiles = [
      path.join(ROOT_DIR, '..', '.github-token'),
      path.join(ROOT_DIR, '..', 'token'),
      path.join(ROOT_DIR, '..', 'GITHUB_TOKEN'),
      path.join(ROOT_DIR, '.github-token'),
      path.join(ROOT_DIR, 'token'),
      path.join(ROOT_DIR, 'GITHUB_TOKEN'),
    ];
    
    for (const tokenFile of tokenFiles) {
      try {
        if (existsSync(tokenFile)) {
          token = readFileSync(tokenFile, 'utf-8').trim();
          break;
        }
      } catch {
        // Continue to next file
      }
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

    // Check if DATABASE_URL is configured (Neon PostgreSQL)
    if (!process.env.DATABASE_URL) {
      console.warn('DATABASE_URL not configured. Returning env-based account if available.')
      return NextResponse.json({ accounts })
    }

    // For now, return only env-based account since we don't have auth system
    // TODO: When authentication is implemented, query GitHub accounts from Neon:
    // try {
    //   const dbAccounts = await query(
    //     'SELECT id, account_name, github_username, created_at FROM github_accounts WHERE user_id = $1 ORDER BY created_at DESC',
    //     [userId]
    //   )
    //   accounts.push(...dbAccounts.rows)
    // } catch (error) {
    //   console.error('Error fetching GitHub accounts from database:', error)
    // }

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

    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
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
    const githubClient = createGitHubClient(token)
    let githubUser: { login: string } | null = null
    
    try {
      githubUser = await githubClient.getAuthenticatedUser()
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Invalid GitHub token. Please check your token and try again.' },
        { status: 400 }
      )
    }

    // Check if account name already exists for this user
    const { data: existing } = await supabase
      .from('github_accounts')
      .select('id')
      .eq('user_id', user.id)
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
        user_id: user.id,
        account_name,
        encrypted_token: token, // In production, encrypt this
        github_username: githubUser.login,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating GitHub account:', error)
      return NextResponse.json(
        { error: 'Failed to create GitHub account' },
        { status: 500 }
      )
    }

    // Return account without the token
    const { encrypted_token, ...accountWithoutToken } = account
    return NextResponse.json({ account: accountWithoutToken })
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

    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Account ID is required' },
        { status: 400 }
      )
    }

    // Delete the account (RLS will ensure user can only delete their own)
    const { error } = await supabase
      .from('github_accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error deleting GitHub account:', error)
      return NextResponse.json(
        { error: 'Failed to delete GitHub account' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error in DELETE /api/github-accounts:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

