import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { getUserGitHubToken, getAuthenticatedUserId } from '@/lib/credentials/helpers';

const execAsync = promisify(exec);
const ROOT_DIR = process.env.REPO_ROOT || '/repos';

// Helper function to get all GitHub accounts for a user
async function getAllGitHubAccounts(userId: string | null): Promise<Array<{ id: string; account_name: string; github_username: string; encrypted_token: string; from_env?: boolean }>> {
  const accounts: Array<{ id: string; account_name: string; github_username: string; encrypted_token: string; from_env?: boolean }> = [];
  
  // Check if using Neon (direct database) or local dev
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isLocalDev = !isUsingNeon && (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost') || 
    process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1')
  );

  // First, check for GITHUB_TOKEN in environment variables
  const envToken = getGitHubToken();
  if (envToken) {
    try {
      const headers = {
        'Authorization': `Bearer ${envToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      const response = await fetch('https://api.github.com/user', { headers });
      if (response.ok) {
        const githubUser = await response.json();
        accounts.push({
          id: 'env-default',
          account_name: 'Default (from .env)',
          github_username: githubUser.login,
          encrypted_token: envToken,
          from_env: true,
        });
      }
    } catch (error) {
      console.warn('GITHUB_TOKEN from environment is invalid:', error);
    }
  }

  if (isUsingNeon || (isLocalDev && process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    // Use direct database connection for Neon or local dev
    try {
      if (isLocalDev && !process.env.DATABASE_URL && !process.env.PGHOST) {
        process.env.PGHOST = 'localhost';
        process.env.PGPORT = '5433';
        process.env.PGUSER = 'postgres';
        process.env.PGPASSWORD = process.env.POSTGRES_PASSWORD || 'postgres';
        process.env.PGDATABASE = 'repo_hub';
      }
      
      const { query } = await import('@/lib/db/client');
      const targetUserId = userId || 'dev';
      const result = await query(
        `SELECT id, account_name, github_username, encrypted_token 
         FROM github_accounts 
         WHERE user_id = $1 
         ORDER BY created_at DESC`,
        [targetUserId]
      );
      
      if (result.rows.length > 0) {
        accounts.push(...result.rows.map((row: any) => ({
          id: row.id,
          account_name: row.account_name,
          github_username: row.github_username,
          encrypted_token: row.encrypted_token,
        })));
      }
    } catch (error: any) {
      console.warn('Error fetching GitHub accounts from database:', error.message);
    }
  } else {
    // Use Supabase client for remote Supabase
    try {
      if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
        const { createClient, createServiceRoleClient } = await import('@/lib/supabase/server');
        const supabase = await createClient();
        
        let targetUserId = userId;
        if (!targetUserId) {
          const { data: { user }, error: authError } = await supabase.auth.getUser();
          if (!authError && user) {
            targetUserId = user.id;
          } else if (process.env.NODE_ENV === 'development') {
            targetUserId = 'dev';
          }
        }
        
        if (targetUserId) {
          const { data: dbAccounts, error: dbError } = await supabase
            .from('github_accounts')
            .select('id, account_name, github_username, encrypted_token')
            .eq('user_id', targetUserId)
            .order('created_at', { ascending: false });

          if (!dbError && dbAccounts) {
            accounts.push(...dbAccounts.map((acc: any) => ({
              id: acc.id,
              account_name: acc.account_name,
              github_username: acc.github_username,
              encrypted_token: acc.encrypted_token,
            })));
          }
        } else if (process.env.NODE_ENV === 'development' && process.env.SUPABASE_SERVICE_ROLE_KEY) {
          // Fallback: use service role client in dev mode
          try {
            const serviceClient = createServiceRoleClient();
            const { data: allAccounts } = await serviceClient
              .from('github_accounts')
              .select('id, account_name, github_username, encrypted_token, user_id')
              .order('created_at', { ascending: true });
            
            if (allAccounts && allAccounts.length > 0) {
              // Try 'dev' user first, then any account
              const devAccounts = allAccounts.filter((a: any) => a.user_id === 'dev');
              const accountsToUse = devAccounts.length > 0 ? devAccounts : allAccounts;
              accounts.push(...accountsToUse.map((acc: any) => ({
                id: acc.id,
                account_name: acc.account_name,
                github_username: acc.github_username,
                encrypted_token: acc.encrypted_token,
              })));
            }
          } catch (serviceError: any) {
            console.warn('Error using service role client:', serviceError?.message);
          }
        }
      }
    } catch (error: any) {
      console.warn('Error accessing Supabase for GitHub accounts:', error.message);
    }
  }

  return accounts;
}

// Helper function to get GitHub token from environment (.env.local) or files
function getGitHubToken(): string | null {
  // First check process.env (which includes .env.local via Next.js)
  let token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    // Fallback to reading from files (for backward compatibility)
    // Check both project root and ROOT_DIR for token files
    const projectRoot = process.cwd();
    const homeDir = os.homedir();
    const username = process.env.USER || process.env.USERNAME || 'root';
    const userHomeDir = path.join('/home', username);
    
    // Also check worktree-manager directory explicitly (where .env files are)
    const worktreeManagerDir = path.join(projectRoot, 'worktree-manager');
    const isWorktreeManagerDir = projectRoot.includes('worktree-manager');
    const worktreeManagerRoot = isWorktreeManagerDir ? projectRoot : worktreeManagerDir;
    
    const tokenFiles = [
      path.join(projectRoot, '..', '.github-token'),
      path.join(projectRoot, '..', 'token'),
      path.join(projectRoot, '..', 'GITHUB_TOKEN'),
      path.join(projectRoot, '.github-token'),
      path.join(projectRoot, 'token'),
      path.join(projectRoot, 'GITHUB_TOKEN'),
      path.join(worktreeManagerRoot, '.github-token'),
      path.join(worktreeManagerRoot, 'token'),
      path.join(worktreeManagerRoot, 'GITHUB_TOKEN'),
      path.join(worktreeManagerRoot, '..', '.github-token'),
      path.join(worktreeManagerRoot, '..', 'token'),
      path.join(worktreeManagerRoot, '..', 'GITHUB_TOKEN'),
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

// Helper function to fetch repos from a single account
async function fetchReposFromAccount(
  account: { id: string; account_name: string; github_username: string; encrypted_token: string; from_env?: boolean },
  repoMap: Map<string, any>
): Promise<void> {
  const headers = {
    'Authorization': `Bearer ${account.encrypted_token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  
  try {
    let page = 1;
    let hasMore = true;
    const perPage = 100;
    
    while (hasMore) {
      const url = `https://api.github.com/user/repos?type=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`;
      const response = await fetch(url, { headers });
      
      if (!response.ok) {
        console.warn(`[API /repos] Failed to fetch repos for account ${account.account_name} (${account.id}): ${response.status}`);
        break;
      }
      
      const repos = await response.json();
      
      if (repos.length === 0) {
        hasMore = false;
      } else {
        repos.forEach((repo: any) => {
          // Use full_name as key to deduplicate across accounts
          // If repo already exists, keep the one with the most recent update
          const existing = repoMap.get(repo.full_name);
          if (!existing || new Date(repo.updated_at || repo.pushed_at || 0) > new Date(existing.updated_at || existing.pushed_at || 0)) {
            repoMap.set(repo.full_name, {
              ...repo,
              // Track which accounts have access to this repo
              github_account_ids: existing?.github_account_ids 
                ? [...new Set([...existing.github_account_ids, account.id])]
                : [account.id],
              github_account_names: existing?.github_account_names
                ? [...new Set([...existing.github_account_names, account.account_name])]
                : [account.account_name],
            });
          } else if (existing) {
            // Add this account to the list if not already present
            if (!existing.github_account_ids?.includes(account.id)) {
              existing.github_account_ids = [...(existing.github_account_ids || []), account.id];
              existing.github_account_names = [...(existing.github_account_names || []), account.account_name];
            }
          }
        });
        
        // Check if there are more pages
        const linkHeader = response.headers.get('link');
        if (linkHeader && linkHeader.includes('rel="next"')) {
          page++;
        } else {
          hasMore = false;
        }
      }
      
      // Safety limit
      if (page > 100) {
        console.warn(`[API /repos] Reached pagination limit for account ${account.account_name}`);
        hasMore = false;
      }
    }
    
    console.log(`[API /repos] Fetched repos from account: ${account.account_name} (${account.id})`);
  } catch (error: any) {
    console.error(`[API /repos] Error fetching repos from account ${account.account_name}:`, error.message);
  }
}

export async function GET(request: Request) {
  try {
    // Check for github_account_id query parameter (for backward compatibility - filter to single account)
    const { searchParams } = new URL(request.url);
    const githubAccountId = searchParams.get('github_account_id');
    
    console.log('[API /repos] Fetching repos from ALL GitHub accounts...');
    
    // Get authenticated user ID
    const userId = await getAuthenticatedUserId();
    console.log('[API /repos] User ID:', userId || 'none (using dev fallback)');
    
    // Get all GitHub accounts for the user
    const accounts = await getAllGitHubAccounts(userId);
    console.log(`[API /repos] Found ${accounts.length} GitHub account(s)`);
    
    if (accounts.length === 0) {
      // No accounts found - return helpful error message
      const projectRoot = process.cwd();
      const homeDir = os.homedir();
      const username = process.env.USER || process.env.USERNAME || 'root';
      const userHomeDir = path.join('/home', username);
      const worktreeManagerDir = path.join(projectRoot, 'worktree-manager');
      const isWorktreeManagerDir = projectRoot.includes('worktree-manager');
      const worktreeManagerRoot = isWorktreeManagerDir ? projectRoot : worktreeManagerDir;
      
      const quickFix = `No GitHub accounts found. Please add a GitHub account:

1. Go to Settings → GitHub Accounts
2. Add a new GitHub account with your token
3. Or add GITHUB_TOKEN to worktree-manager/.env.local

To get a GitHub token:
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a name and select scopes: repo (full control of private repositories)
4. Copy the token and add it to Settings or .env.local

Alternative locations for token file:
- ${worktreeManagerRoot}/.github-token
- ${homeDir}/.github-token
- ${userHomeDir}/.github-token

Current working directory: ${projectRoot}`;
      
      return NextResponse.json(
        { 
          error: quickFix, 
          repos: [] 
        },
        { status: 200 }
      );
    }
    
    // Filter to specific account if requested (for backward compatibility)
    const accountsToUse = githubAccountId 
      ? accounts.filter(acc => acc.id === githubAccountId)
      : accounts;
    
    if (githubAccountId && accountsToUse.length === 0) {
      return NextResponse.json(
        { 
          error: `GitHub account with ID ${githubAccountId} not found`,
          repos: [] 
        },
        { status: 404 }
      );
    }
    
    console.log(`[API /repos] Fetching repos from ${accountsToUse.length} account(s)`);
    
    // Fetch repos from all accounts in parallel
    const repoMap = new Map<string, any>(); // Use full_name as key to deduplicate
    
    // Fetch repos from each account
    await Promise.all(
      accountsToUse.map(account => fetchReposFromAccount(account, repoMap))
    );
    
    // Convert to array and sort by updated date
    const allRepositories = Array.from(repoMap.values());
    allRepositories.sort((a, b) => {
      const dateA = new Date(a.updated_at || a.pushed_at || 0).getTime();
      const dateB = new Date(b.updated_at || b.pushed_at || 0).getTime();
      return dateB - dateA; // Descending order
    });
    
    // Format repositories for the frontend
    const repos = allRepositories.map((repo: any) => {
      const repoPath = path.join(ROOT_DIR, repo.name);
      const gitPath = path.join(repoPath, '.git');
      const exists = existsSync(repoPath) && existsSync(gitPath);
      
      // Use full_name to create a unique key to avoid duplicates from different accounts
      // Sanitize full_name: convert to lowercase and replace non-alphanumeric with hyphens
      // e.g., "org/repo-name" -> "org-repo-name"
      const key = repo.full_name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      
      return {
        key,
        name: repo.name,
        full_name: repo.full_name,
        url: repo.html_url || repo.url,
        exists,
        path: repoPath,
        description: repo.description,
        private: repo.private,
        // Include account information
        github_account_ids: repo.github_account_ids || [],
        github_account_names: repo.github_account_names || [],
      };
    });
    
    console.log(`[API /repos] Fetched ${repos.length} unique repositories from ${accountsToUse.length} account(s)`);
    
    return NextResponse.json({ repos });
    
  } catch (error: any) {
    console.error('Error in GET /api/repos:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch repositories', repos: [] },
      { status: 500 }
    );
  }
}




