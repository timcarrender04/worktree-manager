import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { getUserGitHubToken, getAuthenticatedUserId } from '@/lib/credentials/helpers';
import { query } from '@/lib/db/client'

const execAsync = promisify(exec);
const ROOT_DIR = process.env.REPO_ROOT || '/repos';

interface AccountRecord {
  id: string
  account_name: string
  github_username: string | null
  encrypted_token: string
  source: 'account' | 'token'
  token_name?: string
  token_id?: string
}

// Helper function to get all GitHub accounts for a user (Project Tim is source of truth)
async function getAllGitHubAccounts(userId: string | null): Promise<AccountRecord[]> {
  const accounts: AccountRecord[] = []

  let effectiveUserId = userId
  if (!effectiveUserId && process.env.NODE_ENV === 'development') {
    effectiveUserId = 'dev'
  }

  if (!effectiveUserId) {
    return accounts
  }

  try {
    const result = await query(
      `SELECT id, account_name, github_username, encrypted_token
       FROM github_accounts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [effectiveUserId]
    )

    accounts.push(
      ...result.rows.map((row: any) => ({
        id: row.id,
        account_name: row.account_name,
        github_username: row.github_username,
        encrypted_token: row.encrypted_token,
        source: 'account' as const,
      }))
    )
  } catch (error: any) {
    console.warn('Error fetching github_accounts:', error.message)
  }

  try {
    const tokensResult = await query(
      `SELECT id, name, value
       FROM tokens
       ORDER BY created_at DESC`
    )

    for (const token of tokensResult.rows || []) {
      accounts.push({
        id: `token-${token.id}`,
        account_name: token.name,
        github_username: null,
        encrypted_token: token.value,
        source: 'token',
        token_name: token.name,
        token_id: token.id,
      })
    }
  } catch (tokenError: any) {
    console.warn('Error fetching tokens table (may not exist):', tokenError.message)
  }

  return accounts
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
  account: AccountRecord,
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
          const updated = {
            ...repo,
            github_account_ids: existing?.github_account_ids ? [...existing.github_account_ids] : [],
            github_account_names: existing?.github_account_names ? [...existing.github_account_names] : [],
            github_account_sources: existing?.github_account_sources ? [...existing.github_account_sources] : [],
          }

          if (!updated.github_account_ids.includes(account.id)) {
            updated.github_account_ids.push(account.id)
            updated.github_account_names.push(account.account_name)
            updated.github_account_sources.push({
              id: account.id,
              name: account.account_name,
              source: account.source,
              github_username: account.github_username,
              token_name: account.token_name,
              token_id: account.token_id,
            })
          }

          repoMap.set(repo.full_name, updated)
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
    const accountMap = new Map<string, { id: string; name: string; github_username: string | null; source: 'account' | 'token'; token_name?: string; token_id?: string }>()

    accountsToUse.forEach((account) => {
      accountMap.set(account.id, {
        id: account.id,
        name: account.account_name,
        github_username: account.github_username,
        source: account.source,
        token_name: account.token_name,
        token_id: account.token_id,
      })
    })

    // Fetch repos from each account
    await Promise.all(
      accountsToUse.map(account => fetchReposFromAccount(account, repoMap))
    );
    
    // Format repositories for the frontend
    const accountGroups: Record<string, { account: any; repositories: any[] }> = {}

    repoMap.forEach((repo) => {
      const repoPath = path.join(ROOT_DIR, repo.name)
      const gitPath = path.join(repoPath, '.git')
      const exists = existsSync(repoPath) && existsSync(gitPath)

      const baseRepoData = {
        name: repo.name,
        full_name: repo.full_name,
        url: repo.html_url || repo.url,
        exists,
        path: repoPath,
        description: repo.description,
        private: repo.private,
        updated_at: repo.updated_at || repo.pushed_at,
        owner: repo.owner?.login,
        default_branch: repo.default_branch,
        language: repo.language,
      }

      const associatedAccountIds: string[] = repo.github_account_ids || []

      if (associatedAccountIds.length === 0) {
        const key = 'uncategorized'
        if (!accountGroups[key]) {
          accountGroups[key] = {
            account: {
              id: key,
              name: 'Uncategorized',
              github_username: null,
              source: 'account',
            },
            repositories: [],
          }
        }
        accountGroups[key].repositories.push({
          key: `${repo.full_name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${key}`,
          github_account_id: key,
          github_account_name: 'Uncategorized',
          github_account_source: 'account',
          ...baseRepoData,
        })
        return
      }

      associatedAccountIds.forEach((accountId) => {
        const accountInfo = accountMap.get(accountId) || {
          id: accountId,
          name: accountId,
          github_username: null,
          source: 'account',
        }

        if (!accountGroups[accountId]) {
          accountGroups[accountId] = {
            account: accountInfo,
            repositories: [],
          }
        }

        const key = `${repo.full_name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${accountId.toLowerCase().replace(/[^a-z0-9]/g, '-')}`

        accountGroups[accountId].repositories.push({
          key,
          github_account_id: accountId,
          github_account_name: accountInfo.name,
          github_account_source: accountInfo.source,
          github_account_username: accountInfo.github_username,
          token_name: accountInfo.token_name,
          token_id: accountInfo.token_id,
          ...baseRepoData,
        })
      })
    })

    Object.values(accountGroups).forEach((group) => {
      group.repositories.sort((a, b) => {
        const dateA = new Date(a.updated_at || 0).getTime()
        const dateB = new Date(b.updated_at || 0).getTime()
        return dateB - dateA
      })
    })

    console.log(`[API /repos] Grouped repositories under ${Object.keys(accountGroups).length} account(s)`)

    const flatRepos = Object.values(accountGroups).flatMap((group) => group.repositories)

    return NextResponse.json({ repos: flatRepos, repoGroups: accountGroups })
    
  } catch (error: any) {
    console.error('Error in GET /api/repos:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch repositories', repos: [] },
      { status: 500 }
    );
  }
}




