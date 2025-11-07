import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { getUserGitHubToken, getAuthenticatedUserId } from '@/lib/credentials/helpers';

const execAsync = promisify(exec);
const ROOT_DIR = process.env.REPO_ROOT || '/repos';

// Helper function to get all GitHub accounts (similar to repos route)
async function getAllGitHubAccountsForBranches(userId: string | null): Promise<Array<{ id: string; account_name: string; github_username: string; encrypted_token: string; from_env?: boolean }>> {
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
          try {
            const serviceClient = createServiceRoleClient();
            const { data: allAccounts } = await serviceClient
              .from('github_accounts')
              .select('id, account_name, github_username, encrypted_token, user_id')
              .order('created_at', { ascending: true });
            
            if (allAccounts && allAccounts.length > 0) {
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

// Helper function to fetch all user repositories with pagination
async function fetchAllUserRepositories(token: string, headers: Record<string, string>): Promise<any[]> {
  const allRepos: any[] = [];
  let page = 1;
  let hasMore = true;
  const perPage = 100;
  
  while (hasMore) {
    const url = `https://api.github.com/user/repos?type=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`;
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      break;
    }
    
    const repos = await response.json();
    
    if (repos.length === 0) {
      hasMore = false;
    } else {
      allRepos.push(...repos);
      
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
      console.warn('Reached pagination limit (100 pages) for user repositories');
      hasMore = false;
    }
  }
  
  return allRepos;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ repo: string }> }
) {
  try {
    const { repo } = await params;
    const repoParam = repo;

    const sanitizeKey = (value: string) => value
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-');
    
    const repoKey = sanitizeKey(repoParam);
    
    // The repo parameter may include a sanitized account identifier suffix
    // (as generated in /api/repos). Track possible account matches so we
    // can prefer those tokens when looking up the repository.
    const accountKeyMap = new Map<string, { id: string; account_name: string; github_username: string; encrypted_token: string; from_env?: boolean }>();
    
    // Get authenticated user ID
    const userId = await getAuthenticatedUserId();
    
    // Get all GitHub accounts
    const accounts = await getAllGitHubAccountsForBranches(userId);
    
    for (const account of accounts) {
      accountKeyMap.set(sanitizeKey(account.id), account);
    }
    
    if (accounts.length === 0) {
      // Fallback to env token
      const token = getGitHubToken();
      if (!token) {
        return NextResponse.json(
          { error: 'GITHUB_TOKEN not found and no GitHub accounts configured', branches: [] },
          { status: 400 }
        );
      }
      accounts.push({
        id: 'env-default',
        account_name: 'Default (from .env)',
        github_username: '',
        encrypted_token: token,
        from_env: true,
      });
    }
    
    // Search for the repo across all accounts
    let repoFullName: string | null = null;
    let tokenToUse: string | null = null;
    let repoKeyWithoutAccount = repoKey;
    let targetedAccounts: typeof accounts = accounts;

    // Try to detect if the key ends with a sanitized account identifier so we
    // can limit the search space and recover the original repo key.
    for (const [accountKey, account] of accountKeyMap.entries()) {
      if (repoKey.endsWith(`-${accountKey}`)) {
        repoKeyWithoutAccount = repoKey.slice(0, -(`${accountKey}`.length + 1));
        targetedAccounts = [account];
        break;
      }
    }
    
    // Prepare headers template
    const getHeaders = (token: string) => ({
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    
    // Search across all accounts to find the repo
    const accountsToSearch = targetedAccounts;
    for (const account of accountsToSearch) {
      try {
        const headers = getHeaders(account.encrypted_token);
        const userRepos = await fetchAllUserRepositories(account.encrypted_token, headers);
        
        // Match by sanitized full_name key (the format used in /api/repos)
        const matchedRepo = userRepos.find((r: any) => {
          const sanitizedFullName = sanitizeKey(r.full_name);
          const sanitizedName = sanitizeKey(r.name);
          const accountKey = sanitizeKey(account.id);
          return (
            sanitizedFullName === repoKeyWithoutAccount ||
            sanitizedName === repoKeyWithoutAccount ||
            `${sanitizedFullName}-${accountKey}` === repoKey ||
            `${sanitizedName}-${accountKey}` === repoKey
          );
        });
        
        if (matchedRepo) {
          repoFullName = matchedRepo.full_name;
          tokenToUse = account.encrypted_token;
          break;
        }
      } catch (error) {
        console.warn(`Error searching repos in account ${account.account_name}:`, error);
        continue;
      }
    }
    
    // If we still couldn't find it, try the old format (just repo name) for backward compatibility
    if (!repoFullName) {
      const githubOrg = process.env.GITHUB_ORG || 'timcarrender04';
      // Try matching by repo name only (old format)
      for (const account of accounts) {
        try {
          const headers = getHeaders(account.encrypted_token);
          const userRepos = await fetchAllUserRepositories(account.encrypted_token, headers);
          const matchedRepo = userRepos.find((r: any) => {
            const sanitizedName = sanitizeKey(r.name);
            const sanitizedFullName = sanitizeKey(r.full_name);
            const accountKey = sanitizeKey(account.id);
            return (
              sanitizedName === repoKeyWithoutAccount ||
              sanitizedFullName === repoKeyWithoutAccount ||
              `${sanitizedName}-${accountKey}` === repoKey ||
              `${sanitizedFullName}-${accountKey}` === repoKey
            );
          });
          
          if (matchedRepo) {
            repoFullName = matchedRepo.full_name;
            tokenToUse = account.encrypted_token;
            break;
          }
        } catch (error) {
          continue;
        }
      }
      
      // Last resort: try constructing from org and repo name
      if (!repoFullName) {
        repoFullName = `${githubOrg}/${repoKeyWithoutAccount}`;
        tokenToUse = accounts[0]?.encrypted_token || getGitHubToken();
      }
    }
    
    if (!tokenToUse) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN not found', branches: [] },
        { status: 400 }
      );
    }
    
    const headers = getHeaders(tokenToUse);
    
    // Fetch branches from GitHub API
    try {
      // Fetch all branches from GitHub API with pagination
      const allBranches: string[] = [];
      let page = 1;
      let hasMore = true;
      const perPage = 100;
      
      while (hasMore) {
        const url = `https://api.github.com/repos/${repoFullName}/branches?per_page=${perPage}&page=${page}`;
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
          // If 404, the repo might not exist or we have the wrong full_name
          throw new Error(`Failed to fetch branches: ${response.status} ${response.statusText}`);
        }
        
        const branches = await response.json();
        
        if (branches.length === 0) {
          hasMore = false;
        } else {
          branches.forEach((branch: any) => {
            allBranches.push(branch.name);
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
          console.warn('Reached pagination limit (100 pages)');
          hasMore = false;
        }
      }
      
      // Sort branches (main/master first, then alphabetically)
      allBranches.sort((a, b) => {
        if (a === 'main' || a === 'master') return -1;
        if (b === 'main' || b === 'master') return 1;
        if (a === 'dev' || a === 'develop') return -1;
        if (b === 'dev' || b === 'develop') return 1;
        return a.localeCompare(b);
      });
      
      return NextResponse.json({ branches: allBranches });
      
    } catch (error: any) {
      console.error(`Error fetching branches from GitHub for ${repo}:`, error);
      return NextResponse.json(
        { error: `Failed to fetch branches: ${error.message}`, branches: [] },
        { status: 500 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch branches', branches: [] },
      { status: 500 }
    );
  }
}

