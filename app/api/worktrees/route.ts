import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync, mkdirSync, chmodSync } from 'fs';
import path from 'path';
import os from 'os';
import { getUserGitHubToken, getAuthenticatedUserId } from '@/lib/credentials/helpers';

interface GitHubRepoInfo {
  name: string;
  full_name: string;
  url: string;
  accountIds: string[];
  fromEnv?: boolean;
}

const sanitizeKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '-');

const buildRepoAccountKey = (fullName: string, accountId: string): string =>
  `${sanitizeKey(fullName)}-${sanitizeKey(accountId)}`;

const execAsync = promisify(exec);

// Repository configuration - can be overridden via environment variables
// Format: GITHUB_ORG=yourorg,REPO_KEY=repo-name,REPO_KEY=repo-name2
// Example: GITHUB_ORG=myorg,FRONTEND_REPO=my-frontend,BACKEND_REPO=my-backend
const getRepoMap = (): Record<string, { name: string; url: string }> => {
  const githubOrg = process.env.GITHUB_ORG || 'timcarrender04';
  
  // Allow custom repository configuration via environment variables
  // Format: REPO_KEY=repo-name or use defaults
  const frontendRepo = process.env.FRONTEND_REPO || 'sideline-frontend';
  const viewerRepo = process.env.VIEWER_REPO || 'ohif-viewer';
  const backendRepo = process.env.BACKEND_REPO || 'sideline-backend';
  
  // Support custom repository keys via env var
  // Format: FRONTEND_KEY=frontend,VIEWER_KEY=viewer,BACKEND_KEY=backend
  const frontendKey = process.env.FRONTEND_KEY || 'frontend';
  const viewerKey = process.env.VIEWER_KEY || 'viewer';
  const backendKey = process.env.BACKEND_KEY || 'backend';
  
  return {
    [frontendKey]: {
      name: frontendRepo,
      url: `https://github.com/${githubOrg}/${frontendRepo}`
    },
    [viewerKey]: {
      name: viewerRepo,
      url: `https://github.com/${githubOrg}/${viewerRepo}`
    },
    [backendKey]: {
      name: backendRepo,
      url: `https://github.com/${githubOrg}/${backendRepo}`
    }
  };
};

const REPO_MAP = getRepoMap();

// Create a reverse lookup map from repo name to key and config
const REPO_NAME_MAP: Record<string, { key: string; config: { name: string; url: string } }> = {};
for (const [key, config] of Object.entries(REPO_MAP)) {
  REPO_NAME_MAP[config.name] = { key, config };
}

function getRepoFullNameFromConfig(config?: { name: string; url?: string | null }): string | null {
  if (!config) {
    return null;
  }

  if (config.url) {
    try {
      const parsed = new URL(config.url);
      const sanitizedPath = parsed.pathname.replace(/^\/+|\/+$/g, '');
      if (sanitizedPath) {
        const segments = sanitizedPath.split('/');
        if (segments.length >= 2) {
          const owner = segments[segments.length - 2];
          const repo = segments[segments.length - 1];
          if (owner && repo) {
            return `${owner}/${repo}`;
          }
        }
      }
    } catch (error) {
      console.warn('[worktrees] Failed to parse repository URL for full name:', error instanceof Error ? error.message : error);
    }
  }

  if (config.name) {
    const githubOrg = process.env.GITHUB_ORG || 'timcarrender04';
    return `${githubOrg}/${config.name}`;
  }

  return null;
}

const VALID_TYPES = ['feat', 'bugs', 'fixes', 'qaqc'];
const TYPE_LABELS: Record<string, string> = {
  feat: 'New Feature',
  bugs: 'Bug Fix',
  fixes: 'Fix',
  qaqc: 'QAQC',
};
// Use repo-hub directory structure - repos should be in repo-hub/repos
// This works with Supabase storage buckets for file storage while git worktrees use local filesystem
const REPO_HUB_ROOT = process.env.REPO_HUB_ROOT || path.resolve(process.cwd(), '..', 'repos');
const ROOT_DIR = process.env.REPO_ROOT || REPO_HUB_ROOT;
const HOST_ROOT_DIR = process.env.HOST_REPO_ROOT || ROOT_DIR;
const WORKTREE_MANAGER_ROOT = process.env.WORKTREE_MANAGER_ROOT || process.cwd();
const FIX_PERMISSIONS_COMMAND = `cd ${WORKTREE_MANAGER_ROOT} && ./scripts/fix-permissions.sh`;
    // Worktrees are organized in Tree/{repo}/{branchName} at the root level
    // Use ROOT_DIR (container path) for actual file operations, HOST_ROOT_DIR is only for path translation
    const WORKTREE_ROOT = process.env.WORKTREE_ROOT || path.join(ROOT_DIR, 'Tree');

// Helper function to get GitHub token from environment (.env.local) or files
export function getGitHubToken(): string | null {
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

// Helper function to fetch repositories dynamically from GitHub
// If no token is provided, fetches from all GitHub accounts in the database
async function fetchRepositoriesFromGitHub(token?: string, userId?: string, sourceAccountId?: string): Promise<Map<string, GitHubRepoInfo>> {
  const repoMap = new Map<string, GitHubRepoInfo>();
  const addRepoToMap = (repo: any, accountId?: string, fromEnv?: boolean) => {
    const baseKey = repo.full_name.toLowerCase();
    let existingInfo = repoMap.get(baseKey);

    if (!existingInfo) {
      existingInfo = {
        name: repo.name,
        full_name: repo.full_name,
        url: repo.clone_url || repo.html_url || repo.url,
        accountIds: [],
        fromEnv: false,
      };
    }

    if (accountId) {
      if (!existingInfo.accountIds.includes(accountId)) {
        existingInfo.accountIds.push(accountId);
      }
      if (accountId === 'env-default') {
        existingInfo.fromEnv = true;
      }
    }

    if (fromEnv) {
      existingInfo.fromEnv = true;
    }

    const keys = new Set<string>();
    keys.add(baseKey);
    keys.add(sanitizeKey(repo.name));
    keys.add(sanitizeKey(repo.full_name));
    if (accountId) {
      keys.add(buildRepoAccountKey(repo.full_name, accountId));
      keys.add(`${sanitizeKey(repo.name)}-${sanitizeKey(accountId)}`);
    }

    for (const key of keys) {
      repoMap.set(key, existingInfo);
    }
  };
  
  // If a specific token is provided, use it (for backward compatibility)
  if (token) {
    const headers = {
      'Authorization': `Bearer ${token}`,
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
          break;
        }
        
        const repos = await response.json();
        
        if (repos.length === 0) {
          hasMore = false;
        } else {
          repos.forEach((repo: any) => {
            addRepoToMap(repo, sourceAccountId, sourceAccountId === 'env-default');
          });
          
          const linkHeader = response.headers.get('link');
          if (linkHeader && linkHeader.includes('rel="next"')) {
            page++;
          } else {
            hasMore = false;
          }
        }
        
        if (page > 100) {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error('Error fetching repositories from GitHub:', error);
    }
  } else {
    // No token provided - fetch from all GitHub accounts
    try {
      // Import the helper function from repos route (or duplicate the logic)
      // For now, we'll use the same approach as repos route
      const { getAuthenticatedUserId } = await import('@/lib/credentials/helpers');
      const targetUserId = userId || await getAuthenticatedUserId();
      
      // Get all GitHub accounts
      const accounts = await getAllGitHubAccountsForWorktrees(targetUserId);
      
      // Fetch repos from each account
      await Promise.all(
        accounts.map(async (account) => {
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
                break;
              }
              
              const repos = await response.json();
              
              if (repos.length === 0) {
                hasMore = false;
              } else {
                repos.forEach((repo: any) => {
                  addRepoToMap(repo, account.id);
                });
                
                const linkHeader = response.headers.get('link');
                if (linkHeader && linkHeader.includes('rel="next"')) {
                  page++;
                } else {
                  hasMore = false;
                }
              }
              
              if (page > 100) {
                hasMore = false;
              }
            }
          } catch (error) {
            console.error(`Error fetching repos from account ${account.account_name}:`, error);
          }
        })
      );
    } catch (error) {
      console.error('Error fetching repositories from all accounts:', error);
    }
  }
  
  return repoMap;
}

// Helper function to get all GitHub accounts (similar to repos route)
async function getAllGitHubAccountsForWorktrees(userId: string | null): Promise<Array<{ id: string; account_name: string; github_username: string; encrypted_token: string }>> {
  const accounts: Array<{ id: string; account_name: string; github_username: string; encrypted_token: string }> = [];
  
  // Check if using Neon (direct database) or local dev
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;
  const isLocalDev = !isUsingNeon && (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('localhost') || 
    process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('127.0.0.1')
  );

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

// Accepts either repo name (GitHub repo name) or repo key for backward compatibility
async function createWorktreeForRepo(
  repo: string,
  type: string,
  name: string,
  baseBranch?: string,
  githubAccountId?: string,
  userId?: string
): Promise<{ success: boolean; worktree?: any; error?: string }> {
  try {
    // First try to find in hardcoded REPO_MAP (for backward compatibility)
    let repoKey: string | undefined;
    let config: { name: string; url: string } | undefined;
    let matchedRepoAccountIds: string[] = [];
    
    if (REPO_NAME_MAP[repo]) {
      // Found by repo name in hardcoded map
      repoKey = REPO_NAME_MAP[repo].key;
      config = REPO_NAME_MAP[repo].config;
    } else if (REPO_MAP[repo]) {
      // Found by repo key in hardcoded map
      repoKey = repo;
      config = REPO_MAP[repo];
    } else {
      // Try to fetch dynamically from GitHub
      // If account ID is provided, use that account's token
      // Otherwise, fetch from all accounts
      let token: string | null = null;
      if (githubAccountId && userId) {
        token = await getUserGitHubToken(userId, githubAccountId);
      }
      // Pass userId so it can fetch from all accounts if no token
      const dynamicRepos = await fetchRepositoriesFromGitHub(token || undefined, userId, githubAccountId);

      // Try multiple matching strategies (same as validation)
      let matchType = '';
      let matchedRepoInfo: GitHubRepoInfo | undefined = dynamicRepos.get(repo.toLowerCase());
      if (matchedRepoInfo) {
        matchType = 'dynamic-exact';
      }

      // Strategy: Try extracting repo name from full name format
      if (!matchedRepoInfo && repo.includes('-')) {
        const parts = repo.split('-');
        if (parts.length > 1) {
          const repoNameOnly = parts[parts.length - 1].toLowerCase();
          const repoNameTwoParts = parts.slice(-2).join('-').toLowerCase();

          matchedRepoInfo = dynamicRepos.get(repoNameOnly) || dynamicRepos.get(repoNameTwoParts);
          if (matchedRepoInfo) {
            matchType = matchedRepoInfo === dynamicRepos.get(repoNameOnly) ? 'dynamic-repo-name-only' : 'dynamic-repo-name-two-parts';
          }
        }
      }

      // Strategy: Try matching by full_name format
      if (!matchedRepoInfo && repo.includes('-')) {
        const fullNameFormat = repo.replace(/-/g, '/');
        for (const [, repoData] of dynamicRepos.entries()) {
          if (repoData.full_name.toLowerCase() === fullNameFormat.toLowerCase()) {
            matchedRepoInfo = repoData;
            matchType = 'dynamic-full-name';
            break;
          }
        }
      }

      if (!matchedRepoInfo) {
        const lowerRepo = repo.toLowerCase();
        const sanitizedLowerRepo = sanitizeKey(lowerRepo);

        const dynamicEntries = Array.from(dynamicRepos.entries()).sort((a, b) => b[0].length - a[0].length);

        for (const [key, repoData] of dynamicEntries) {
          const lowerKey = key.toLowerCase();
          const sanitizedKey = sanitizeKey(lowerKey);

          const lowerBoundaryChar = lowerRepo.charAt(lowerKey.length);
          const sanitizedBoundaryChar = sanitizedLowerRepo.charAt(sanitizedKey.length);

          const lowerMatches =
            lowerRepo === lowerKey ||
            (lowerRepo.startsWith(lowerKey) && (lowerBoundaryChar === '-' || lowerBoundaryChar === '/' || lowerBoundaryChar === ''));
          const sanitizedMatches =
            sanitizedLowerRepo === sanitizedKey ||
            (sanitizedLowerRepo.startsWith(sanitizedKey) && (sanitizedBoundaryChar === '-' || sanitizedBoundaryChar === ''));

          if (lowerMatches || sanitizedMatches) {
            matchedRepoInfo = repoData;
            matchType = 'dynamic-prefix';
            break;
          }
        }
      }

      if (!matchedRepoInfo) {
        matchedRepoInfo = dynamicRepos.get(repo);
        if (matchedRepoInfo) {
          matchType = 'dynamic-literal';
        }
      }

      if (!matchedRepoInfo) {
        return { success: false, error: `Invalid repository: ${repo}. Repository not found in any GitHub account.` };
      }

      if (!matchType) {
        matchType = 'dynamic-exact';
      }
      matchedRepoAccountIds = matchedRepoInfo.accountIds || [];
      repoKey = repo;
      config = {
        name: matchedRepoInfo.name,
        url: matchedRepoInfo.url,
      };
    }
    
    const resolvedRepoFullName = getRepoFullNameFromConfig(config);

    const repoPath = path.join(ROOT_DIR, config.name);
    const branchName = `${config.name}-${type}-${name}`;
    
    // Ensure bucket exists for the account (non-blocking)
    let bucketInfo: { name: string; type: 's3' | 'supabase'; apiUrl: string } | undefined;
    if (githubAccountId && userId) {
      try {
        const { ensureBucketExists } = await import('@/lib/buckets/service');
        const bucketResult = await ensureBucketExists(githubAccountId, userId);
        if (bucketResult.success && bucketResult.bucket) {
          bucketInfo = {
            name: bucketResult.bucket.bucket_name,
            type: bucketResult.bucket.bucket_type,
            apiUrl: `/api/buckets/${bucketResult.bucket.bucket_name}/files`
          };
          console.log(`Bucket ensured for account ${githubAccountId}: ${bucketResult.bucket.bucket_name}`);
        } else {
          console.warn(`Failed to ensure bucket for account ${githubAccountId}: ${bucketResult.error || 'Unknown error'}`);
        }
      } catch (bucketError: any) {
        // Don't fail worktree creation if bucket creation fails
        console.warn(`Error ensuring bucket exists: ${bucketError.message}`);
      }
    }
    
    // Determine worktree path - optionally organize by account if account ID is provided
    let worktreePath: string;
    let worktreeDir: string;
    
    if (githubAccountId && userId) {
      // Organize by account: Tree/{account_name}/{repo}/{branchName}
      try {
        const { getUserGitHubAccount } = await import('@/lib/credentials/helpers');
        const account = await getUserGitHubAccount(userId, githubAccountId);
        if (account) {
          // Sanitize account name for filesystem
          const sanitizedAccountName = account.account_name
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          worktreePath = path.join(WORKTREE_ROOT, sanitizedAccountName, config.name, branchName);
          worktreeDir = path.join(WORKTREE_ROOT, sanitizedAccountName, config.name);
        } else {
          // Fallback to default organization if account not found
          worktreePath = path.join(WORKTREE_ROOT, config.name, branchName);
          worktreeDir = path.join(WORKTREE_ROOT, config.name);
        }
      } catch (error) {
        // Fallback to default organization on error
        console.warn('Error getting account info for worktree organization:', error);
        worktreePath = path.join(WORKTREE_ROOT, config.name, branchName);
        worktreeDir = path.join(WORKTREE_ROOT, config.name);
      }
    } else {
      // Default organization: Tree/{repo}/{branchName} where branchName includes repo prefix
      worktreePath = path.join(WORKTREE_ROOT, config.name, branchName);
      worktreeDir = path.join(WORKTREE_ROOT, config.name);
    }
    
    // Ensure WORKTREE_ROOT and repository directory exist (mkdir -p style)
    // Create directories one level at a time to handle permission issues
    try {
      // Check parent directory of WORKTREE_ROOT first
      const parentOfTreeRoot = path.dirname(WORKTREE_ROOT);
      
      // Create parent directory if it doesn't exist
      if (!existsSync(parentOfTreeRoot)) {
        try {
          mkdirSync(parentOfTreeRoot, { recursive: true, mode: 0o755 });
          console.log(`Created parent directory: ${parentOfTreeRoot}`);
        } catch (mkdirError: any) {
          return { 
            success: false, 
            error: `Failed to create parent directory ${parentOfTreeRoot}: ${mkdirError.message}. Please ensure the directory exists or run: ${FIX_PERMISSIONS_COMMAND}` 
          };
        }
      }
      
      // Check if parent directory is writable
      try {
        const parentStat = statSync(parentOfTreeRoot);
        if (!parentStat.isDirectory()) {
          return { 
            success: false, 
            error: `Parent path exists but is not a directory: ${parentOfTreeRoot}` 
          };
        }
        // Try to access parent directory (check if writable)
        try {
          readdirSync(parentOfTreeRoot);
        } catch (readError: any) {
          return { 
            success: false, 
            error: `Cannot read parent directory ${parentOfTreeRoot}: ${readError.message}. Please run: ${FIX_PERMISSIONS_COMMAND}` 
          };
        }
      } catch (parentStatError: any) {
        return { 
          success: false, 
          error: `Cannot access parent directory ${parentOfTreeRoot}: ${parentStatError.message}. Please run: ${FIX_PERMISSIONS_COMMAND}` 
        };
      }
      
      // First ensure WORKTREE_ROOT exists
      if (!existsSync(WORKTREE_ROOT)) {
        try {
          mkdirSync(WORKTREE_ROOT, { recursive: true, mode: 0o755 });
          console.log(`Created WORKTREE_ROOT directory: ${WORKTREE_ROOT}`);
        } catch (mkdirError: any) {
          // Provide helpful error message with fix instructions
          const errorMsg = mkdirError.code === 'EACCES' 
            ? `Permission denied creating ${WORKTREE_ROOT}. The process does not have write permission to ${parentOfTreeRoot}. Please run: ${FIX_PERMISSIONS_COMMAND}`
            : `Failed to create ${WORKTREE_ROOT}: ${mkdirError.message}. Please run: ${FIX_PERMISSIONS_COMMAND}`;
          return { 
            success: false, 
            error: errorMsg
          };
        }
      }
      
      // Check if WORKTREE_ROOT is writable
      try {
        const stat = statSync(WORKTREE_ROOT);
        if (!stat.isDirectory()) {
          return { 
            success: false, 
            error: `WORKTREE_ROOT exists but is not a directory: ${WORKTREE_ROOT}` 
          };
        }
        // Verify we can write to it by trying to read it
        try {
          readdirSync(WORKTREE_ROOT);
        } catch (readError: any) {
          return { 
            success: false, 
            error: `Cannot access WORKTREE_ROOT ${WORKTREE_ROOT}: ${readError.message}. Please run: ${FIX_PERMISSIONS_COMMAND}` 
          };
        }
      } catch (statError: any) {
        return { 
          success: false, 
          error: `Cannot access WORKTREE_ROOT ${WORKTREE_ROOT}: ${statError.message}. Please run: ${FIX_PERMISSIONS_COMMAND}` 
        };
      }
      
      // Create parent directories one level at a time
      const dirParts = worktreeDir.split(path.sep);
      let currentPath = '';
      for (const part of dirParts) {
        if (!part) continue; // Skip empty parts (leading slash)
        currentPath = currentPath ? path.join(currentPath, part) : part;
        
        if (!existsSync(currentPath)) {
          try {
            mkdirSync(currentPath, { mode: 0o755 });
            console.log(`Created directory: ${currentPath}`);
          } catch (mkdirError: any) {
            // If recursive creation failed, try to set permissions on parent and retry
            if (currentPath !== WORKTREE_ROOT) {
              try {
                const parentPath = path.dirname(currentPath);
                if (existsSync(parentPath)) {
                  try {
                    chmodSync(parentPath, 0o755);
                  } catch (chmodError) {
                    // Log but continue - might not have permission to chmod
                    console.warn(`Could not set permissions on parent ${parentPath}: ${chmodError}`);
                  }
                  mkdirSync(currentPath, { mode: 0o755 });
                  console.log(`Created directory after fixing parent permissions: ${currentPath}`);
                } else {
                  throw mkdirError;
                }
              } catch (retryError: any) {
                const errorMsg = retryError.code === 'EACCES'
                  ? `Permission denied creating ${currentPath}. Please run: ${FIX_PERMISSIONS_COMMAND}`
                  : `Failed to create worktree directory ${worktreeDir}: ${retryError.message}. Parent directory: ${path.dirname(currentPath)}. Please run: ${FIX_PERMISSIONS_COMMAND}`;
                return { 
                  success: false, 
                  error: errorMsg
                };
              }
            } else {
              // This is WORKTREE_ROOT creation failure - already handled above, but just in case
              const errorMsg = mkdirError.code === 'EACCES'
                ? `Permission denied creating ${WORKTREE_ROOT}. Please run: ${FIX_PERMISSIONS_COMMAND}`
                : `Failed to create ${WORKTREE_ROOT}: ${mkdirError.message}. Please run: ${FIX_PERMISSIONS_COMMAND}`;
              return { 
                success: false, 
                error: errorMsg
              };
            }
          }
        } else {
          // Directory exists, try to ensure it's writable (but don't fail if we can't)
          try {
            chmodSync(currentPath, 0o755);
          } catch (chmodError) {
            // Log but don't fail - directory might already have correct permissions or we might not have permission to chmod
            console.warn(`Could not set permissions on ${currentPath}: ${chmodError}`);
          }
        }
      }
      
      console.log(`Ensured worktree directory exists: ${worktreeDir}`);
    } catch (error: any) {
      const errorMsg = error.code === 'EACCES'
        ? `Permission denied: ${error.message}. Please run: ${FIX_PERMISSIONS_COMMAND}`
        : `Failed to create worktree directory ${worktreeDir}: ${error.message}. Please run: ${FIX_PERMISSIONS_COMMAND}`;
      return { 
        success: false, 
        error: errorMsg
      };
    }
    
    // Check if worktree path would conflict with a main repository
    // Main repos have .git as a directory, worktrees have .git as a file
    if (existsSync(worktreePath)) {
      const gitPath = path.join(worktreePath, '.git');
      if (existsSync(gitPath)) {
        try {
          const stat = statSync(gitPath);
          if (stat.isDirectory()) {
            return { 
              success: false, 
              error: `Path ${worktreePath} conflicts with an existing repository directory. Please use a different branch name.` 
            };
          }
        } catch {
          // Continue - might be a worktree
        }
      }
    }
    
    // Check if repo exists, if not clone it
    if (!existsSync(repoPath) || !existsSync(path.join(repoPath, '.git'))) {
      // Get token: prefer account-specific token from database
      let token: string | null = null;
      
      // Try to get userId if not provided but githubAccountId is
      let effectiveUserId = userId;
      if (githubAccountId && !effectiveUserId) {
        effectiveUserId = await getAuthenticatedUserId() || undefined;
        console.log(`[createWorktreeForRepo] Retrieved userId for githubAccountId ${githubAccountId}: ${effectiveUserId}`);
      }
      
      if (githubAccountId && effectiveUserId) {
        token = await getUserGitHubToken(effectiveUserId, githubAccountId);
        console.log(`[createWorktreeForRepo] Token from getUserGitHubToken(${effectiveUserId}, ${githubAccountId}): ${token ? 'found' : 'not found'}`);
      }
      
      // If still no token, try getting from all accounts
      if (!token && effectiveUserId) {
        token = await getUserGitHubToken(effectiveUserId);
        console.log(`[createWorktreeForRepo] Token from getUserGitHubToken(${effectiveUserId}): ${token ? 'found' : 'not found'}`);
      }
      
      // Final fallback: look up first available GitHub account (preferring hinted account, then database accounts)
      if (!token) {
        try {
          const accounts = await getAllGitHubAccountsForWorktrees(effectiveUserId || null);
          const candidateAccountIds = [
            githubAccountId,
            ...matchedRepoAccountIds,
          ].filter(Boolean) as string[];

          const seenCandidates = new Set<string>();
          const orderedCandidates = candidateAccountIds.filter(id => {
            if (seenCandidates.has(id)) {
              return false;
            }
            seenCandidates.add(id);
            return true;
          });

          let preferredAccount =
            orderedCandidates.length > 0
              ? orderedCandidates
                  .map(id => accounts.find(account => account.id === id))
                  .find(Boolean)
              : undefined;

          if (!preferredAccount && accounts.length > 0) {
            preferredAccount = accounts[0];
          }

          if (preferredAccount) {
            token = preferredAccount.encrypted_token;
            console.log(
              `[createWorktreeForRepo] Token from github_accounts fallback (${preferredAccount.account_name || preferredAccount.github_username || preferredAccount.id}): found`
            );
          } else {
            console.log('[createWorktreeForRepo] No GitHub accounts available for fallback token retrieval');
          }
        } catch (accountError) {
          console.warn('[createWorktreeForRepo] Failed to load fallback GitHub account token:', accountError);
        }
      }
      
      if (!token) {
        return { 
          success: false, 
          error: 'GitHub token not found for this repository. Please add a GitHub account with an access token in Project Tim settings.' 
        };
      }
      
      const authUrl = config.url.replace('https://', `https://${token}@`);
      await execAsync(`git clone ${authUrl} ${repoPath}`, {
        cwd: ROOT_DIR,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });
    }
    
    // Ensure we're in the repo directory
    // Check if dev branch exists, create it if needed
    try {
      await execAsync('git fetch origin', { cwd: repoPath });
      
      try {
        await execAsync('git checkout dev', { cwd: repoPath });
        await execAsync('git pull origin dev', { cwd: repoPath }).catch(() => {});
      } catch {
        try {
          await execAsync('git checkout -b dev origin/dev', { cwd: repoPath });
        } catch {
          try {
            try {
              await execAsync('git checkout main', { cwd: repoPath });
            } catch {
              await execAsync('git checkout -b main origin/main', { cwd: repoPath });
            }
            await execAsync('git checkout -b dev', { cwd: repoPath });
          } catch {
            try {
              await execAsync('git checkout master', { cwd: repoPath });
            } catch {
              await execAsync('git checkout -b master origin/master', { cwd: repoPath });
            }
            await execAsync('git checkout -b dev', { cwd: repoPath });
          }
        }
      }
    } catch (err) {
      // Continue anyway
    }
    
    // Check if branch already exists
    let branchExists = false;
    try {
      await execAsync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
        cwd: repoPath
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }
    
    // Check if worktree already exists at the target path
    if (existsSync(worktreePath)) {
      console.log(`Worktree directory already exists at ${worktreePath}, checking if it's registered with git...`);
      try {
        const { stdout } = await execAsync('git worktree list', { cwd: repoPath });
        const worktreeLines = stdout.trim().split('\n');
        let isRegistered = false;
        let existingBranch = '';
        
        const normalizePath = (p: string) => {
          let normalized = p.replace(/\/$/, '');
          if (normalized.includes(HOST_ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR) {
            normalized = normalized.replace(HOST_ROOT_DIR, ROOT_DIR);
          }
          return normalized;
        };
        const normalizedTargetPath = normalizePath(worktreePath);
        
        for (const line of worktreeLines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 2) continue;
          const existingPath = parts[0];
          const branchInfo = line.match(/\[(.*?)\]/);
          const normalizedExistingPath = normalizePath(existingPath);
          
          if (normalizedExistingPath === normalizedTargetPath) {
            isRegistered = true;
            if (branchInfo) {
              existingBranch = branchInfo[1];
            }
            break;
          }
        }
        
        if (isRegistered) {
          console.log(`Worktree is registered at ${worktreePath} with branch ${existingBranch}`);
          if (existingBranch === branchName) {
            console.log(`Removing existing worktree at ${worktreePath} (same branch ${branchName})`);
            try {
              await execAsync(`git worktree remove "${worktreePath}" --force`, {
                cwd: repoPath
              });
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error: any) {
              console.warn(`Failed to remove worktree via git: ${error.message}`);
              try {
                rmSync(worktreePath, { recursive: true, force: true });
              } catch (rmError: any) {
                return { success: false, error: `Failed to remove existing worktree: ${rmError.message}` };
              }
            }
          } else {
            console.log(`Worktree at ${worktreePath} uses different branch ${existingBranch}, not removing`);
            return { 
              success: false, 
              error: `A worktree already exists at ${worktreePath} with a different branch (${existingBranch}). Please use a different name.` 
            };
          }
        } else {
          console.log(`Directory exists at ${worktreePath} but is not a registered worktree, removing...`);
          try {
            // Check if it's a main repository before removing
            const gitPath = path.join(worktreePath, '.git');
            if (existsSync(gitPath)) {
              try {
                const stat = statSync(gitPath);
                if (stat.isDirectory()) {
                  return { 
                    success: false, 
                    error: `Cannot remove directory at ${worktreePath} - it appears to be a main repository. Please use a different branch name.` 
                  };
                }
              } catch {
                // Continue - might be a worktree .git file
              }
            }
            rmSync(worktreePath, { recursive: true, force: true });
          } catch (error: any) {
            return { success: false, error: `Directory exists at ${worktreePath} and could not be removed: ${error.message}` };
          }
        }
      } catch (error: any) {
        console.warn(`Failed to check worktree list: ${error.message}, checking directory...`);
        // Before removing, verify it's not a main repository
        const gitPath = path.join(worktreePath, '.git');
        if (existsSync(gitPath)) {
          try {
            const stat = statSync(gitPath);
            if (stat.isDirectory()) {
              return { 
                success: false, 
                error: `Cannot use path ${worktreePath} - it is a main repository directory. Please use a different branch name.` 
              };
            }
          } catch {
            // Continue - might be a worktree .git file
          }
        }
        try {
          rmSync(worktreePath, { recursive: true, force: true });
        } catch (rmError: any) {
          return { success: false, error: `Directory exists at ${worktreePath} and could not be removed: ${rmError.message}` };
        }
      }
    }
    
    // Check if branch is already used by another worktree or checked out in main repo
    try {
      // First, prune any prunable worktrees to clean up orphaned entries
      try {
        await execAsync('git worktree prune', { cwd: repoPath });
        console.log('Pruned any prunable worktrees');
        
        // Also remove the worktree registration if the directory doesn't exist
        // Check if our target worktree path would conflict with a prunable entry
        const { stdout: worktreeListBefore } = await execAsync('git worktree list', { cwd: repoPath });
        const worktreeLinesBefore = worktreeListBefore.trim().split('\n');
        
        for (const line of worktreeLinesBefore) {
          if (line.includes('prunable')) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
              const prunablePath = parts[0];
              // If this prunable path matches our target or uses the same branch, remove it
              if (prunablePath.includes(branchName) || prunablePath === worktreePath) {
                try {
                  // Force remove the prunable worktree entry
                  await execAsync(`git worktree remove --force "${prunablePath}"`, {
                    cwd: repoPath
                  }).catch(() => {
                    // If that fails, try pruning again
                    return execAsync('git worktree prune', { cwd: repoPath });
                  });
                  console.log(`Removed prunable worktree entry for ${prunablePath}`);
                } catch (removeError) {
                  console.warn(`Failed to remove prunable worktree: ${removeError}`);
                }
              }
            }
          }
        }
      } catch (pruneError) {
        // Continue even if prune fails
        console.warn('Failed to prune worktrees:', pruneError);
      }
      
      try {
        const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
        const currentBranchName = currentBranch.trim();
        if (currentBranchName === branchName) {
          try {
            await execAsync('git checkout dev', { cwd: repoPath }).catch(async () => {
              await execAsync('git checkout main', { cwd: repoPath }).catch(async () => {
                await execAsync('git checkout master', { cwd: repoPath });
              });
            });
          } catch {
            // Continue
          }
        }
      } catch {
        // Continue
      }

      const { stdout } = await execAsync('git worktree list', { cwd: repoPath });
      const worktreeLines = stdout.trim().split('\n');
      
      const normalizePathForComparison = (p: string) => {
        let normalized = p.replace(/\/$/, '');
        if (normalized.includes(HOST_ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR) {
          normalized = normalized.replace(HOST_ROOT_DIR, ROOT_DIR);
        }
        return normalized;
      };
      const normalizedTargetPath = normalizePathForComparison(worktreePath);
      
      for (const line of worktreeLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) continue;
        
        const existingPath = parts[0];
        const branchInfo = line.match(/\[(.*?)\]/);
        const isPrunable = line.includes('prunable');
        
        if (branchInfo && branchInfo[1] === branchName) {
          if (existingPath === repoPath || existingPath.replace(/\/$/, '') === repoPath.replace(/\/$/, '')) {
            continue;
          }
          
          const normalizedExistingPath = normalizePathForComparison(existingPath);
          if (normalizedExistingPath !== normalizedTargetPath) {
            console.log(`Removing conflicting worktree at ${existingPath} (same branch ${branchName}, different path${isPrunable ? ', prunable' : ''})`);
            // Try to remove using absolute path (works even for prunable worktrees)
            const absolutePath = path.isAbsolute(existingPath) ? existingPath : path.resolve(repoPath, existingPath);
            
            // For prunable worktrees, the directory doesn't exist but git still has it registered
            // Try to remove it regardless of whether the directory exists
            try {
              // First try git worktree remove (works even if directory doesn't exist)
              await execAsync(`git worktree remove "${absolutePath}" --force`, {
                cwd: repoPath
              }).catch(async () => {
                // If that fails, try with the original path
                await execAsync(`git worktree remove "${existingPath}" --force`, {
                  cwd: repoPath
                });
              });
              // Wait for cleanup
              await new Promise(resolve => setTimeout(resolve, 500));
              
              // Verify it's actually removed from git
              const { stdout: verifyList } = await execAsync('git worktree list', { cwd: repoPath });
              const verifyLines = verifyList.trim().split('\n');
              const stillExists = verifyLines.some(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 2) return false;
                const linePath = parts[0];
                const normalizedLinePath = normalizePathForComparison(linePath);
                return normalizedLinePath === normalizedExistingPath;
              });
              
              if (stillExists) {
                console.warn(`Worktree still exists after removal attempt, trying git worktree prune`);
                // Try git worktree prune to clean up prunable worktrees
                try {
                  await execAsync('git worktree prune', { cwd: repoPath });
                  await new Promise(resolve => setTimeout(resolve, 500));
                } catch (pruneError: any) {
                  console.warn(`git worktree prune failed: ${pruneError.message}`);
                }
                
                // Try manual directory removal as fallback (only if directory exists)
                if (existsSync(absolutePath)) {
                  rmSync(absolutePath, { recursive: true, force: true });
                } else if (existsSync(existingPath)) {
                  rmSync(existingPath, { recursive: true, force: true });
                }
              }
              
              console.log(`Successfully removed conflicting worktree at ${existingPath}`);
            } catch (error: any) {
              console.warn(`Failed to remove conflicting worktree via git: ${error.message}`);
              
              // For prunable worktrees, try git worktree prune
              if (isPrunable) {
                try {
                  console.log(`Trying git worktree prune to clean up prunable worktree`);
                  await execAsync('git worktree prune', { cwd: repoPath });
                  await new Promise(resolve => setTimeout(resolve, 500));
                  console.log(`Successfully pruned worktree`);
                } catch (pruneError: any) {
                  console.warn(`git worktree prune failed: ${pruneError.message}`);
                  return {
                    success: false,
                    error: `Failed to remove conflicting prunable worktree at ${existingPath}. Please run 'git worktree prune' manually in ${repoPath} and try again.`
                  };
                }
              } else {
                // Try manual cleanup as fallback (only if directory exists)
                try {
                  if (existsSync(absolutePath)) {
                    rmSync(absolutePath, { recursive: true, force: true });
                  } else if (existsSync(existingPath)) {
                    rmSync(existingPath, { recursive: true, force: true });
                  }
                  console.log(`Manually removed directory at ${existingPath}`);
                } catch (rmError: any) {
                  console.error(`Failed to manually remove directory: ${rmError.message}`);
                  return {
                    success: false,
                    error: `Failed to remove conflicting worktree at ${existingPath}. Please remove it manually and try again.`
                  };
                }
              }
            }
          } else {
            console.log(`Worktree with branch ${branchName} already exists at target path, will be replaced`);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to list worktrees:', error);
    }
    
    // Ensure we're not on the branch we're trying to create a worktree for
    try {
      const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath });
      const currentBranchName = currentBranch.trim();
      if (currentBranchName === branchName) {
        try {
          await execAsync('git checkout dev', { cwd: repoPath }).catch(async () => {
            await execAsync('git checkout main', { cwd: repoPath }).catch(async () => {
              await execAsync('git checkout master', { cwd: repoPath });
            });
          });
        } catch {
          // Continue
        }
      }
    } catch {
      // Continue
    }
    
    // Ensure parent directory exists (already created above, but double-check)
    const parentDir = path.dirname(worktreePath);
    if (!existsSync(parentDir)) {
      try {
        mkdirSync(parentDir, { recursive: true });
        console.log(`Created parent directory: ${parentDir}`);
      } catch (error: any) {
        return { 
          success: false, 
          error: `Failed to create parent directory ${parentDir}: ${error.message}` 
        };
      }
    }
    
    // Remove any existing directory at worktree path
    if (existsSync(worktreePath)) {
      try {
        rmSync(worktreePath, { recursive: true, force: true });
        console.log(`Removed existing directory at ${worktreePath}`);
      } catch (error: any) {
        return { 
          success: false, 
          error: `Failed to remove existing directory: ${error.message}` 
        };
      }
    }
    
    // Determine the base branch to create the worktree from
    // Use provided baseBranch or detect available branch
    let resolvedBaseBranch = baseBranch || 'dev';
    if (!branchExists) {
      if (baseBranch) {
        // Verify the provided base branch exists
        try {
          await execAsync(`git show-ref --verify --quiet refs/heads/${baseBranch}`, { cwd: repoPath });
        } catch {
          // Try remote branch
          try {
            await execAsync(`git show-ref --verify --quiet refs/remotes/origin/${baseBranch}`, { cwd: repoPath });
            // Checkout the remote branch locally first
            await execAsync(`git checkout -b ${baseBranch} origin/${baseBranch}`, { cwd: repoPath }).catch(() => {});
          } catch {
            console.warn(`Base branch ${baseBranch} not found in ${repoPath}, trying defaults...`);
            resolvedBaseBranch = 'dev'; // Will be overridden by fallback below
          }
        }
      }
      
      // Fallback to detecting available branches if baseBranch not provided or not found
      if (!baseBranch) {
        try {
          await execAsync('git show-ref --verify --quiet refs/heads/dev', { cwd: repoPath });
          resolvedBaseBranch = 'dev';
        } catch {
          try {
            await execAsync('git show-ref --verify --quiet refs/heads/main', { cwd: repoPath });
            resolvedBaseBranch = 'main';
          } catch {
            try {
              await execAsync('git show-ref --verify --quiet refs/heads/master', { cwd: repoPath });
              resolvedBaseBranch = 'master';
            } catch {
              console.warn(`Neither dev, main, nor master branch found in ${repoPath}. Defaulting to 'dev'.`);
              resolvedBaseBranch = 'dev';
            }
          }
        }
      }
    } else {
      // Branch exists, use it directly (won't be used in worktree command but keep for reference)
      resolvedBaseBranch = branchName;
    }
    
    // Create working tree - ensure the directory doesn't exist first
    // IMPORTANT: Use container path (ROOT_DIR) for worktree creation to ensure git stores correct paths
    const worktreeCommand = branchExists 
      ? `git worktree add "${worktreePath}" ${branchName}`
      : `git worktree add -b ${branchName} "${worktreePath}" ${resolvedBaseBranch}`;
    console.log(`Creating worktree with command: ${worktreeCommand} (branch exists: ${branchExists})`);
    console.log(`Worktree path: ${worktreePath}, Parent dir: ${parentDir}, WORKTREE_ROOT: ${WORKTREE_ROOT}`);
    console.log(`Using container paths: ROOT_DIR=${ROOT_DIR}, HOST_ROOT_DIR=${HOST_ROOT_DIR}`);
    console.log(`Repository path: ${repoPath}`);
    console.log(`Base branch: ${resolvedBaseBranch}`);
    
    // Verify the repository exists and is a valid git repo
    if (!existsSync(repoPath) || !existsSync(path.join(repoPath, '.git'))) {
      return { 
        success: false, 
        error: `Repository ${config.name} not found or not a valid git repository at ${repoPath}` 
      };
    }
    
    try {
      // Ensure we're using container paths for git operations
      const result = await execAsync(worktreeCommand, {
        cwd: repoPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: 60000 // 60 second timeout
      });
      console.log(`Git command output: ${result.stdout}`);
      if (result.stderr && result.stderr.trim()) {
        console.log(`Git command stderr: ${result.stderr}`);
      }
      
      // Verify the worktree directory was actually created and has .git file
      if (!existsSync(worktreePath)) {
        throw new Error(`Worktree directory was not created at ${worktreePath}`);
      }
      
      const gitFile = path.join(worktreePath, '.git');
      if (!existsSync(gitFile)) {
        // Clean up the directory if it was created but .git file is missing
        try {
          rmSync(worktreePath, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn(`Failed to cleanup incomplete worktree directory: ${cleanupError}`);
        }
        throw new Error(`Worktree was created but .git file is missing. This indicates git worktree add failed.`);
      }
      
      // Verify it's a file, not a directory
      try {
        const gitStat = statSync(gitFile);
        if (gitStat.isDirectory()) {
          // Clean up - this shouldn't happen but handle it
          try {
            rmSync(worktreePath, { recursive: true, force: true });
          } catch (cleanupError) {
            console.warn(`Failed to cleanup invalid worktree: ${cleanupError}`);
          }
          throw new Error(`Worktree directory contains .git as directory instead of file. This is invalid.`);
        }
      } catch (statError: any) {
        if (statError.message && statError.message.includes('invalid')) {
          throw statError;
        }
        // Continue if stat check fails for other reasons
      }
      
      console.log(`Successfully created worktree at ${worktreePath}`);
      
      // Verify the worktree was created with correct paths
      const { stdout: worktreeListAfter } = await execAsync('git worktree list', { cwd: repoPath });
      console.log(`Worktree list after creation:\n${worktreeListAfter}`);
      
      // Fix the .git file to use host path for host access (VS Code, etc.)
      // gitFile is already declared above, reuse it
      if (existsSync(gitFile)) {
        try {
          const gitContent = readFileSync(gitFile, 'utf-8').trim();
          // If we're in a container and the .git file uses container path, update it to host path for host access
          if (gitContent.startsWith('gitdir: ')) {
            const gitdirPath = gitContent.replace('gitdir: ', '').trim();
            // Convert container path to host path if they differ
            if (gitdirPath.includes(ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR) {
              const hostGitdirPath = gitdirPath.replace(ROOT_DIR, HOST_ROOT_DIR);
              // Always write host path so git works from the host (VS Code, etc.)
              // The container can still access it via the mounted volume
              const fixedContent = `gitdir: ${hostGitdirPath}`;
              writeFileSync(gitFile, fixedContent + '\n', 'utf-8');
              console.log(`Fixed .git file path from container to host: ${gitFile}`);
              console.log(`  Old: ${gitContent}`);
              console.log(`  New: ${fixedContent}`);
            }
          }
        } catch (error) {
          console.warn('Failed to fix .git file path:', error);
        }
      }
      
      // Verify git operations work in the worktree
      try {
        const { stdout: branchName } = await execAsync('git rev-parse --abbrev-ref HEAD', {
          cwd: worktreePath
        });
        console.log(`Verified worktree git repository: on branch ${branchName.trim()}`);
      } catch (error) {
        console.warn(`Warning: Could not verify git repository in worktree: ${error}`);
      }
      
      // Configure git safe.directory for the worktree (for host access)
      // This prevents "dubious ownership" errors when accessing from the host
      try {
        const hostWorktreePath = worktreePath.includes(ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR
          ? worktreePath.replace(ROOT_DIR, HOST_ROOT_DIR)
          : worktreePath;
        await execAsync(`git config --global --add safe.directory "${hostWorktreePath}"`, {
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
        }).catch(() => {
          // Ignore if already added or fails
        });
        console.log(`Added worktree to git safe.directory: ${hostWorktreePath}`);
      } catch (error) {
        console.warn('Failed to add worktree to safe.directory:', error);
      }
      
      // Note: Branch is created locally only. User can push manually when ready.
      console.log(`Branch ${branchName} created locally. Push to remote when ready using: git push -u origin ${branchName}`);
    } catch (error: any) {
      // Capture the actual error message from git
      const errorMessage = error.stderr || error.stdout || error.message || 'Unknown error';
      console.error(`Failed to create worktree: ${errorMessage}`);
      console.error(`Full error object:`, error);
      console.error(`Command that failed: ${worktreeCommand}`);
      console.error(`Repository path: ${repoPath}`);
      console.error(`Worktree path: ${worktreePath}`);
      
      // Clean up any partially created directory
      if (existsSync(worktreePath)) {
        try {
          // Check if it's a valid worktree before removing
          const gitFile = path.join(worktreePath, '.git');
          if (!existsSync(gitFile)) {
            // Not a valid worktree, safe to remove
            console.log(`Cleaning up incomplete worktree directory: ${worktreePath}`);
            rmSync(worktreePath, { recursive: true, force: true });
          } else {
            // Has .git file, might be a valid worktree - check if it's registered
            try {
              const { stdout: worktreeList } = await execAsync('git worktree list', { cwd: repoPath });
              const isRegistered = worktreeList.includes(worktreePath);
              if (!isRegistered) {
                // Not registered, safe to remove
                console.log(`Cleaning up unregistered worktree directory: ${worktreePath}`);
                rmSync(worktreePath, { recursive: true, force: true });
              } else {
                console.log(`Worktree directory exists and is registered, not removing`);
              }
            } catch (listError) {
              // If we can't check, be conservative and don't remove
              console.warn(`Could not verify worktree registration, not removing directory`);
            }
          }
        } catch (cleanupError) {
          console.warn(`Failed to cleanup after error: ${cleanupError}`);
        }
      }
      
      return { 
        success: false, 
        error: `Failed to create worktree: ${errorMessage}` 
      };
    }
    
    // Fix .git file and worktree metadata paths
    // Note: We need to keep container paths for git operations, but may need host paths for .git file
    const gitFile = path.join(worktreePath, '.git');
    if (existsSync(gitFile)) {
      try {
        const gitContent = readFileSync(gitFile, 'utf-8').trim();
        // The .git file should point to the worktree's gitdir
        // Git stores the absolute path, which might be in host or container format
        let fixedContent = gitContent;
        
        // If git stored host path but we're in container, convert it
        if (ROOT_DIR !== HOST_ROOT_DIR && gitContent.includes(HOST_ROOT_DIR)) {
          // Keep host path for .git file (for VS Code compatibility when opened on host)
          // But we need to ensure the referenced gitdir exists at that path or we convert it
          console.log(`Git file uses host path: ${gitContent}`);
        } else if (ROOT_DIR !== HOST_ROOT_DIR && gitContent.includes(ROOT_DIR)) {
          // If it uses container path, we might want to convert to host for VS Code
          // But for now, keep container path for git operations to work
          console.log(`Git file uses container path: ${gitContent}`);
        }
        
        // Actually, let's ensure the .git file points to a path that exists
        // Extract the gitdir path from the .git file
        if (gitContent.startsWith('gitdir: ')) {
          const gitdirPath = gitContent.replace('gitdir: ', '').trim();
          // Check if the gitdir path exists (try both container and host paths)
          const containerGitdirPath = gitdirPath.includes(HOST_ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR
            ? gitdirPath.replace(HOST_ROOT_DIR, ROOT_DIR)
            : gitdirPath;
          
          if (!existsSync(containerGitdirPath)) {
            console.warn(`Gitdir path does not exist: ${containerGitdirPath}, git may have issues`);
          }
        }
      } catch (error) {
        console.warn('Failed to fix .git file path:', error);
      }
    }
    
    // Fix worktree metadata - ensure gitdir files use correct paths
    try {
      const worktreesDir = path.join(repoPath, '.git', 'worktrees');
      if (existsSync(worktreesDir)) {
        const entries = readdirSync(worktreesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const gitdirFile = path.join(worktreesDir, entry.name, 'gitdir');
            if (existsSync(gitdirFile)) {
              let gitdirContent = readFileSync(gitdirFile, 'utf-8').trim();
              const originalContent = gitdirContent;
              
              // Check if this gitdir corresponds to our worktree
              if (gitdirContent.includes(worktreePath) || gitdirContent.includes(branchName)) {
                // If gitdir uses host path but we need container path for git to work
                if (gitdirContent.includes(HOST_ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR) {
                  const containerGitdirPath = gitdirContent.replace(HOST_ROOT_DIR, ROOT_DIR);
                  // Verify the container path exists
                  if (existsSync(containerGitdirPath)) {
                    gitdirContent = containerGitdirPath;
                  }
                }
                
                // Update the gitdir file if changed
                if (gitdirContent !== originalContent) {
                  writeFileSync(gitdirFile, gitdirContent + '\n', 'utf-8');
                  console.log(`Fixed gitdir file: ${gitdirFile} to use container path`);
                }
              }
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to fix worktree metadata:', error);
    }
    
    // Verify the worktree is properly registered
    try {
      const { stdout: worktreeList } = await execAsync('git worktree list', { cwd: repoPath });
      console.log(`Current worktree list:\n${worktreeList}`);
      const worktreeLines = worktreeList.trim().split('\n');
      const worktreeFound = worktreeLines.some(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) return false;
        const wtPath = parts[0];
        // Check both container and host paths
        const normalizedWtPath = wtPath.replace(/\/$/, '');
        const normalizedTargetPath = worktreePath.replace(/\/$/, '');
        return normalizedWtPath === normalizedTargetPath || 
               normalizedWtPath === normalizedTargetPath.replace(ROOT_DIR, HOST_ROOT_DIR) ||
               normalizedWtPath.replace(HOST_ROOT_DIR, ROOT_DIR) === normalizedTargetPath;
      });
      
      if (!worktreeFound) {
        console.error(`ERROR: Worktree at ${worktreePath} not found in git worktree list after creation!`);
        console.error(`This means the worktree was not properly registered with git.`);
        // Try to verify the directory exists
        if (existsSync(worktreePath)) {
          console.error(`Directory exists but is not registered. This may indicate a git worktree creation failure.`);
        }
      } else {
        console.log(`✓ Worktree successfully registered in git`);
      }
    } catch (error) {
      console.error('Failed to verify worktree registration:', error);
    }
    
    return {
      success: true,
      worktree: {
        repo: repoKey, // Keep key for backward compatibility
        repoName: config.name, // Actual GitHub repo name
        type,
        name,
        branch: branchName,
        path: worktreePath,
        ...(bucketInfo && { bucket: bucketInfo })
      }
    };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to create working tree' };
  }
}

export async function GET() {
  try {
    const worktrees: Array<{
      repo: string;
      repoName: string;
      repoFullName: string | null;
      type: string;
      name: string;
      branch: string;
      path: string;
      fullPath: string;
      projectId?: string | null;
      kanbanItemId?: string | null;
      kanbanBoardId?: string | null;
      status?: string;
      columnId?: string;
    }> = [];
    const worktreeSet = new Set<string>(); // Track worktrees by path to avoid duplicates
    
    // First, fetch dynamic repositories to include all possible repos
    const dynamicRepos = await fetchRepositoriesFromGitHub();
    const allReposMap = new Map<string, { name: string; url: string; key: string }>();
    
    // Add hardcoded repos
    for (const [repoKey, config] of Object.entries(REPO_MAP)) {
      allReposMap.set(repoKey, { ...config, key: repoKey });
    }
    
    // Add dynamically fetched repos
    dynamicRepos.forEach((repo, key) => {
      if (!allReposMap.has(key)) {
        allReposMap.set(key, { name: repo.name, url: repo.url, key });
      }
    });
    
    // First, discover worktrees using git worktree list for each repository
    // This finds worktrees regardless of their location (old format, new format, etc.)
    for (const [repoKey, config] of allReposMap.entries()) {
      const repoPath = path.join(ROOT_DIR, config.name);
      if (!existsSync(repoPath) || !existsSync(path.join(repoPath, '.git'))) {
        continue;
      }
      
      try {
        const { stdout } = await execAsync('git worktree list', { cwd: repoPath });
        const worktreeLines = stdout.trim().split('\n');
        
        for (const line of worktreeLines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 2) continue;
          
          const worktreePath = parts[0];
          // Skip the main repository path
          if (worktreePath === repoPath || worktreePath.replace(/\/$/, '') === repoPath.replace(/\/$/, '')) {
            continue;
          }
          
          // Normalize path for comparison (convert host path to container path if needed)
          const normalizePath = (p: string) => {
            let normalized = p.replace(/\/$/, '');
            if (normalized.includes(HOST_ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR) {
              normalized = normalized.replace(HOST_ROOT_DIR, ROOT_DIR);
            }
            return normalized;
          };
          const normalizedPath = normalizePath(worktreePath);
          
          // Skip if we've already processed this worktree
          if (worktreeSet.has(normalizedPath)) {
            continue;
          }
          
          // Check if worktree directory exists
          const containerPath = worktreePath.includes(HOST_ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR
            ? worktreePath.replace(HOST_ROOT_DIR, ROOT_DIR)
            : worktreePath;
          
          // Check if directory exists - if it does, include it even if marked as prunable
          const directoryExists = existsSync(containerPath);
          
          // Only skip if marked prunable AND directory doesn't exist
          if (line.includes('prunable') && !directoryExists) {
            continue;
          }
          
          // If directory doesn't exist, skip it
          if (!directoryExists) {
            continue;
          }
          
          // Verify it's a worktree (has .git file, not directory)
          const gitFile = path.join(containerPath, '.git');
          if (!existsSync(gitFile)) {
            continue;
          }
          
          try {
            const stat = statSync(gitFile);
            if (stat.isDirectory()) {
              continue; // This is a main repo, not a worktree
            }
          } catch {
            continue;
          }
          
                    // Extract branch name from git worktree list output
          const branchMatch = line.match(/\[(.*?)\]/);
          if (!branchMatch) continue;
          const branchName = branchMatch[1];

          // Try to extract repo, type and name from branch name (format: repoName-type-name)
          // Branch name should start with repo name, then type, then name
          // Example: sideline-frontend-feat-test1 -> repo: sideline-frontend, type: feat, name: test1
          if (!branchName.startsWith(config.name + '-')) continue;
          
          // Remove repo name prefix to get type-name part
          const typeAndName = branchName.substring(config.name.length + 1);
          const typeAndNameParts = typeAndName.split('-');
          if (typeAndNameParts.length < 2) continue;
          
          const type = typeAndNameParts[0];
          if (!VALID_TYPES.includes(type)) continue;
          
          const name = typeAndNameParts.slice(1).join('-');
          
          // Get actual branch name from git to verify
          try {
            const { stdout: actualBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: containerPath });
            const actualBranchName = actualBranch.trim();
            const repoFullName = getRepoFullNameFromConfig(config);
            
            worktreeSet.add(normalizedPath);
            worktrees.push({
              repo: repoKey,
              repoName: config.name,
              repoFullName,
              type: type,
              name: name,
              branch: actualBranchName,
              path: containerPath,
              fullPath: containerPath
            });
          } catch (error: any) {
            console.warn(`Failed to get branch name for ${containerPath}: ${error.message}`);
            // Use branch name from worktree list (which should match the directory name)
            // This is the actual branch name: {repoName}-{type}-{name}
            worktreeSet.add(normalizedPath);
            worktrees.push({
              repo: repoKey,
              repoName: config.name,
              repoFullName: getRepoFullNameFromConfig(config),
              type: type,
              name: name,
              branch: branchName, // Use branch name from worktree list output
              path: containerPath,
              fullPath: containerPath
            });
          }
        }
      } catch (error: any) {
        console.warn(`Failed to list worktrees for ${config.name}: ${error.message}`);
      }
    }
    
    // Also scan WORKTREE_ROOT for worktree directories (for backward compatibility and structure verification)
    // Structure: Tree/{repo}/{branchName}
    // Note: This is now secondary to git worktree list, but kept for structure verification
    if (existsSync(WORKTREE_ROOT)) {
      try {
      // Scan each repository directory in Tree
      const repoEntries = readdirSync(WORKTREE_ROOT, { withFileTypes: true });
      
      for (const repoEntry of repoEntries) {
        if (!repoEntry.isDirectory()) continue;
        
        const repoDirName = repoEntry.name;
        const repoDirPath = path.join(WORKTREE_ROOT, repoDirName);
        
        // Check if this matches a known repository
        let matchedRepo: { key: string; config: { name: string; url: string } } | null = null;
        if (REPO_NAME_MAP[repoDirName]) {
          matchedRepo = REPO_NAME_MAP[repoDirName];
        } else {
          // Try to find by matching config name
          for (const [key, config] of Object.entries(REPO_MAP)) {
            if (config.name === repoDirName) {
              matchedRepo = { key, config };
              break;
            }
          }
        }
        
        if (!matchedRepo) continue;
        
        // Scan branch directories directly (branch name format: {type}-{name})
        try {
          const branchEntries = readdirSync(repoDirPath, { withFileTypes: true });
          
          for (const branchEntry of branchEntries) {
            if (!branchEntry.isDirectory()) continue;
            
            const branchName = branchEntry.name;
            const worktreePath = path.join(repoDirPath, branchName);
            
                         // Extract repo, type and name from branch name (format: repoName-type-name)
             // Branch name should start with repo name, then type, then name
             // Example: sideline-frontend-feat-test1 -> repo: sideline-frontend, type: feat, name: test1
             if (!branchName.startsWith(matchedRepo.config.name + '-')) continue;
             
             // Remove repo name prefix to get type-name part
             const branchTypeAndName = branchName.substring(matchedRepo.config.name.length + 1);
             const branchTypeAndNameParts = branchTypeAndName.split('-');
             if (branchTypeAndNameParts.length < 2) continue;
             
             const type = branchTypeAndNameParts[0];
             if (!VALID_TYPES.includes(type)) continue;
             
             const gitFile = path.join(worktreePath, '.git');
                
                // Skip if it's not a worktree (no .git file)
                if (!existsSync(gitFile)) continue;
                
                // Verify it's a .git file, not a directory
                try {
                  const stat = statSync(gitFile);
                  if (stat.isDirectory()) {
                    continue; // This is a main repo, not a worktree
                  }
                } catch {
                  continue;
                }
                
                // Extract name from branch (branchName is {repoName}-{type}-{name})
                // Remove repo name prefix to get type-name part
                if (!branchName.startsWith(matchedRepo.config.name + '-')) continue;
                const fsTypeAndName = branchName.substring(matchedRepo.config.name.length + 1);
                const fsTypeAndNameParts = fsTypeAndName.split('-');
                if (fsTypeAndNameParts.length < 2) continue;
                const name = fsTypeAndNameParts.slice(1).join('-'); // Everything after type-
                
                const repoPath = path.join(ROOT_DIR, matchedRepo.config.name);
                if (!existsSync(repoPath)) continue;
                
                // Fix .git file path if needed (for VS Code compatibility)
                let gitFileNeedsFixing = false;
                let originalGitContent = '';
                
                if (ROOT_DIR !== HOST_ROOT_DIR) {
                  try {
                    const gitContent = readFileSync(gitFile, 'utf-8').trim();
                    if (gitContent.includes(HOST_ROOT_DIR)) {
                      originalGitContent = gitContent;
                      const containerGitContent = gitContent.replace(
                        new RegExp(HOST_ROOT_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                        ROOT_DIR
                      );
                      writeFileSync(gitFile, containerGitContent + '\n', 'utf-8');
                      gitFileNeedsFixing = true;
                    } else if (gitContent.includes(ROOT_DIR)) {
                      const fixedContent = gitContent.replace(
                        new RegExp(ROOT_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                        HOST_ROOT_DIR
                      );
                      if (fixedContent !== gitContent) {
                        writeFileSync(gitFile, fixedContent + '\n', 'utf-8');
                      }
                    }
                  } catch (error) {
                    console.warn(`Failed to fix .git file for ${worktreePath}:`, error);
                  }
                }
                
                // Get the actual branch name from git
                let actualBranchName = '';
                try {
                  const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: worktreePath });
                  actualBranchName = stdout.trim();
                } catch (error: any) {
                  console.warn(`Failed to get branch name for ${worktreePath}: ${error.message}`);
                  // Use the directory name as the branch name (should match: {repoName}-{type}-{name})
                  actualBranchName = branchName;
                  if (gitFileNeedsFixing && originalGitContent) {
                    try {
                      writeFileSync(gitFile, originalGitContent + '\n', 'utf-8');
                    } catch {
                      // Ignore
                    }
                  }
                  // Don't continue - use the directory name as branch name
                }
                
                // Restore .git file if needed
                if (gitFileNeedsFixing && originalGitContent) {
                  try {
                    writeFileSync(gitFile, originalGitContent + '\n', 'utf-8');
                  } catch {
                    // Ignore
                  }
                }
                
                // Skip if already added from git worktree list scan
                const normalizePath = (p: string) => {
                  let normalized = p.replace(/\/$/, '');
                  if (normalized.includes(HOST_ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR) {
                    normalized = normalized.replace(HOST_ROOT_DIR, ROOT_DIR);
                  }
                  return normalized;
                };
                const normalizedWorktreePath = normalizePath(worktreePath);
                
                if (!worktreeSet.has(normalizedWorktreePath)) {
                  worktreeSet.add(normalizedWorktreePath);
                  const repoFullName = getRepoFullNameFromConfig(matchedRepo.config);
                  worktrees.push({
                    repo: matchedRepo.key,
                    repoName: matchedRepo.config.name,
                    repoFullName,
                    type: type,
                    name: name,
                    branch: actualBranchName,
                    path: worktreePath,
                    fullPath: worktreePath
                  });
                }
              }
            } catch (err) {
              // Skip if can't read repo directory
              console.warn(`Failed to read repo directory ${repoDirPath}:`, err);
            }
      }
      } catch (err) {
        // Skip if can't read WORKTREE_ROOT
        console.warn('Failed to read WORKTREE_ROOT:', err);
      }
    }

    if (worktrees.length > 0) {
      const branchNames = Array.from(new Set(worktrees.map((item) => `${item.type}-${item.name}`)));

      if (branchNames.length > 0) {
        type KanbanMeta = {
          itemId: string;
          projectId: string | null;
          boardId: string | null;
          repositories: string[];
          columnId: string | null;
          status: string | null;
        };

        const branchMetaMap = new Map<string, KanbanMeta[]>();

        try {
          const usingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;

          if (usingNeon) {
            const { query } = await import('@/lib/db/client');
            const result = await query(
              `
                SELECT ki.id, ki.branch_name, ki.board_id, ki.repositories, ki.column_id, ki.status, kb.project_id
                FROM kanban_items ki
                JOIN kanban_boards kb ON ki.board_id = kb.id
                WHERE ki.branch_name = ANY($1::text[])
              `,
              [branchNames]
            );

            for (const row of result.rows || []) {
              const branchName = typeof row.branch_name === 'string' ? row.branch_name.toLowerCase() : null;
              if (!branchName) continue;

              const repositories = Array.isArray(row.repositories)
                ? row.repositories
                    .map((value: any) => (typeof value === 'string' ? value.toLowerCase() : ''))
                    .filter(Boolean)
                : [];

              const meta: KanbanMeta = {
                itemId: row.id,
                projectId: row.project_id || null,
                boardId: row.board_id || null,
                repositories,
                columnId: typeof row.column_id === 'string' ? row.column_id : null,
                status: typeof row.status === 'string' ? row.status : null,
              };

              if (!branchMetaMap.has(branchName)) {
                branchMetaMap.set(branchName, []);
              }
              branchMetaMap.get(branchName)!.push(meta);
            }
          } else {
            const { createServiceRoleClient } = await import('@/lib/supabase/server');
            const supabase = createServiceRoleClient();

            const { data: items, error: itemsError } = await supabase
              .from('kanban_items')
              .select('id, branch_name, board_id, repositories, column_id, status')
              .in('branch_name', branchNames);

            if (itemsError) {
              throw itemsError;
            }

            const boardIds = Array.from(new Set((items || []).map((item) => item.board_id).filter(Boolean)));
            let boardProjectMap = new Map<string, string | null>();

            if (boardIds.length > 0) {
              const { data: boards, error: boardsError } = await supabase
                .from('kanban_boards')
                .select('id, project_id')
                .in('id', boardIds);

              if (boardsError) {
                throw boardsError;
              }

              boardProjectMap = new Map((boards || []).map((board) => [board.id, board.project_id || null]));
            }

            for (const item of items || []) {
              const branchName = typeof item.branch_name === 'string' ? item.branch_name.toLowerCase() : null;
              if (!branchName) continue;

              const repositories = Array.isArray(item.repositories)
                ? item.repositories
                    .map((value: any) => (typeof value === 'string' ? value.toLowerCase() : ''))
                    .filter(Boolean)
                : [];

              const meta: KanbanMeta = {
                itemId: item.id,
                projectId: boardProjectMap.get(item.board_id) || null,
                boardId: item.board_id || null,
                repositories,
                columnId: typeof item.column_id === 'string' ? item.column_id : null,
                status: typeof item.status === 'string' ? item.status : null,
              };

              if (!branchMetaMap.has(branchName)) {
                branchMetaMap.set(branchName, []);
              }
              branchMetaMap.get(branchName)!.push(meta);
            }
          }

          for (const worktree of worktrees) {
            const branchKey = `${worktree.type}-${worktree.name}`.toLowerCase();
            const metas = branchMetaMap.get(branchKey);
            if (!metas || metas.length === 0) {
              continue;
            }

            const repoFullNameLower = worktree.repoFullName ? worktree.repoFullName.toLowerCase() : null;
            let selectedMeta = repoFullNameLower
              ? metas.find((meta) => meta.repositories.includes(repoFullNameLower))
              : undefined;

            if (!selectedMeta && metas.length === 1) {
              selectedMeta = metas[0];
            }

            if (!selectedMeta && repoFullNameLower) {
              selectedMeta = metas.find((meta) => meta.repositories.length === 0);
            }

            if (selectedMeta) {
              worktree.kanbanItemId = selectedMeta.itemId;
              worktree.projectId = selectedMeta.projectId || null;
              worktree.kanbanBoardId = selectedMeta.boardId || null;
              const resolvedStatus = selectedMeta.status || selectedMeta.columnId || 'backlog';
              worktree.status = resolvedStatus;
              worktree.columnId = selectedMeta.columnId || selectedMeta.status || 'backlog';
            }
          }
        } catch (error) {
          console.warn('[worktrees GET] Unable to attach kanban metadata:', error instanceof Error ? error.message : error);
        }
      }
    }
    
    for (const worktree of worktrees) {
      if (!worktree.status) {
        worktree.status = 'backlog';
      }
      if (!worktree.columnId) {
        worktree.columnId = worktree.status;
      }
    }

    return NextResponse.json({ worktrees });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch worktrees' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { repo, repos, type, name, github_account_id } = body;
    const projectId: string | undefined = body.projectId || body.project_id;
    const kanbanPayload = body.kanban || null;
    const selectedRepoMetadataInput = Array.isArray(body.selectedRepoMetadata) ? body.selectedRepoMetadata : [];
    const repoAccountMap = (body as any)?.repoAccountMap || {};
    
    // Support both single repo (backward compatibility) and multiple repos
    const reposToProcess: string[] = repos || (repo ? [repo] : []);
    
    // Validate inputs
    if (!projectId) {
      return NextResponse.json(
        { error: 'Missing required field: projectId' },
        { status: 400 }
      );
    }

    if (reposToProcess.length === 0 || !type || !name) {
      return NextResponse.json(
        { error: 'Missing required fields: repos (or repo), type, name' },
        { status: 400 }
      );
    }
    
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const metadataByRepoKey = new Map<string, { fullName?: string | null; projectRepositoryId?: string | null }>();
    if (Array.isArray(selectedRepoMetadataInput)) {
      selectedRepoMetadataInput.forEach((item: any) => {
        if (!item || typeof item !== 'object') {
          return;
        }
        const repoKey = item.repoKey || item.key || item.repo || item.identifier;
        if (!repoKey || typeof repoKey !== 'string') {
          return;
        }
        metadataByRepoKey.set(repoKey, {
          fullName: item.fullName || item.repositoryFullName || item.repository_full_name || null,
          projectRepositoryId: item.projectRepositoryId || item.project_repository_id || null,
        });
      });
    }

    const repoFullNameMap: Record<string, string> = {};
    const repoProjectRepositoryIdMap: Record<string, string | null> = {};

    metadataByRepoKey.forEach((value, key) => {
      if (value.fullName) {
        repoFullNameMap[key] = value.fullName;
      }
      if (value.projectRepositoryId) {
        repoProjectRepositoryIdMap[key] = value.projectRepositoryId;
      }
    });

    let projectRepoRows: Array<{ id: string; repository_full_name: string }> = [];
    let projectFound = false;
    let queryAttempted = false;

    try {
      const { query } = await import('@/lib/db/client');
      queryAttempted = true;
      const projectResult = await query(
        'SELECT id FROM projects WHERE id = $1 LIMIT 1',
        [projectId]
      );

      if (projectResult.rows.length > 0) {
        projectFound = true;
        const repoResult = await query(
          'SELECT id, repository_full_name FROM project_repositories WHERE project_id = $1',
          [projectId]
        );
        projectRepoRows = repoResult.rows;
      }
    } catch (dbError: any) {
      console.warn('[worktrees POST] Failed to query project repositories via PostgreSQL:', dbError?.message || dbError);
    }

    if (!projectFound) {
      try {
        const { createServiceRoleClient } = await import('@/lib/supabase/server');
        const supabase = createServiceRoleClient();

        const { data: projectData, error: projectError } = await supabase
          .from('projects')
          .select('id')
          .eq('id', projectId)
          .maybeSingle();

        if (!projectError && projectData) {
          projectFound = true;
          const { data: supabaseRepos, error: reposError } = await supabase
            .from('project_repositories')
            .select('id, repository_full_name')
            .eq('project_id', projectId);

          if (reposError) {
            throw reposError;
          }

          projectRepoRows = supabaseRepos || [];
        }
      } catch (supabaseError: any) {
        console.error('[worktrees POST] Failed to query project repositories via Supabase:', supabaseError?.message || supabaseError);
      }
    }

    if (!projectFound) {
      return NextResponse.json(
        { error: 'Project not found or inaccessible' },
        { status: 404 }
      );
    }
    
    // Get authenticated user ID if available (required for account-scoped tokens)
    const userId = await getAuthenticatedUserId() || undefined;
    
    // Get token for repository fetching if account ID is provided
    let token: string | undefined;
    if (github_account_id && userId) {
      token = await getUserGitHubToken(userId, github_account_id) || undefined;
    }
    
    // Validate all repos exist (by name or key for backward compatibility, or dynamically from GitHub)
    const dynamicRepos = await fetchRepositoriesFromGitHub(token, userId, github_account_id);
    
    // Add detailed logging for debugging
    console.log('[worktrees POST] Validating repositories:', reposToProcess);
    console.log('[worktrees POST] REPO_MAP keys:', Object.keys(REPO_MAP).slice(0, 10));
    console.log('[worktrees POST] REPO_NAME_MAP keys:', Object.keys(REPO_NAME_MAP).slice(0, 10));
    console.log('[worktrees POST] Dynamic repos count:', dynamicRepos.size);
    console.log('[worktrees POST] Dynamic repos sample (first 10):', Array.from(dynamicRepos.keys()).slice(0, 10));
    console.log('[worktrees POST] Token available:', !!token);
    
    const repoAccountAssignments: Record<string, string | undefined> = {};

    for (const repoIdentifier of reposToProcess) {
      // Try multiple matching strategies
      let found = false;
      let matchType = '';
      let matchedRepoInfo: GitHubRepoInfo | undefined;

      const metadata = metadataByRepoKey.get(repoIdentifier);
      if (metadata) {
        if (metadata.fullName && !repoFullNameMap[repoIdentifier]) {
          repoFullNameMap[repoIdentifier] = metadata.fullName;
        }
        if (repoProjectRepositoryIdMap[repoIdentifier] === undefined) {
          repoProjectRepositoryIdMap[repoIdentifier] = metadata.projectRepositoryId || null;
        }
      } else if (repoProjectRepositoryIdMap[repoIdentifier] === undefined) {
        repoProjectRepositoryIdMap[repoIdentifier] = null;
      }

      // Strategy 1: Check hardcoded maps
      const inHardcoded = REPO_NAME_MAP[repoIdentifier] || REPO_MAP[repoIdentifier];
      if (inHardcoded) {
        found = true;
        matchType = 'hardcoded';
      }

      const candidateKeys = [
        { key: repoIdentifier, type: 'dynamic-key' },
        { key: repoIdentifier.toLowerCase(), type: 'dynamic-exact' },
        { key: sanitizeKey(repoIdentifier), type: 'dynamic-sanitized' },
      ];

      if (!found) {
        for (const candidate of candidateKeys) {
          if (!candidate.key) continue;
          const repoInfo = dynamicRepos.get(candidate.key);
          if (repoInfo) {
            found = true;
            matchType = candidate.type;
            matchedRepoInfo = repoInfo;
            break;
          }
        }
      }

      if (!found && repoIdentifier.includes('-')) {
        const parts = repoIdentifier.split('-');
        if (parts.length > 1) {
          const repoNameOnly = parts[parts.length - 1].toLowerCase();
          const repoNameTwoParts = parts.slice(-2).join('-').toLowerCase();

          let repoInfo = dynamicRepos.get(repoNameOnly);
          if (!repoInfo) {
            repoInfo = dynamicRepos.get(repoNameTwoParts);
          }

          if (repoInfo) {
            found = true;
            matchType = repoInfo === dynamicRepos.get(repoNameOnly)
              ? 'dynamic-repo-name-only'
              : 'dynamic-repo-name-two-parts';
            matchedRepoInfo = repoInfo;
          }
        }
      }

      if (!found && repoIdentifier.includes('-')) {
        const fullNameFormat = repoIdentifier.replace(/-/g, '/');
        for (const [, repo] of dynamicRepos.entries()) {
          if (repo.full_name.toLowerCase() === fullNameFormat.toLowerCase()) {
            found = true;
            matchType = 'dynamic-full-name';
            matchedRepoInfo = repo;
            break;
          }
        }
      }

      if (!found) {
        const lowerIdentifier = repoIdentifier.toLowerCase();
        const sanitizedLowerIdentifier = sanitizeKey(lowerIdentifier);

        const dynamicEntries = Array.from(dynamicRepos.entries()).sort((a, b) => b[0].length - a[0].length);

        for (const [key, repo] of dynamicEntries) {
          const lowerKey = key.toLowerCase();
          const sanitizedKey = sanitizeKey(lowerKey);

          const lowerBoundaryChar = lowerIdentifier.charAt(lowerKey.length);
          const sanitizedBoundaryChar = sanitizedLowerIdentifier.charAt(sanitizedKey.length);

          const lowerMatches =
            lowerIdentifier === lowerKey ||
            (lowerIdentifier.startsWith(lowerKey) && (lowerBoundaryChar === '-' || lowerBoundaryChar === '/' || lowerBoundaryChar === ''));
          const sanitizedMatches =
            sanitizedLowerIdentifier === sanitizedKey ||
            (sanitizedLowerIdentifier.startsWith(sanitizedKey) && (sanitizedBoundaryChar === '-' || sanitizedBoundaryChar === ''));

          if (lowerMatches || sanitizedMatches) {
            found = true;
            matchType = 'dynamic-prefix';
            matchedRepoInfo = repo;
            break;
          }
        }
      }

      if (!found && matchedRepoInfo) {
        found = true;
      }

      if (!found) {
        console.error(`[worktrees POST] Repository not found: ${repoIdentifier}`);
        console.error(`[worktrees POST] Tried strategies: hardcoded, dynamic-key, dynamic-exact, dynamic-repo-name, dynamic-full-name, dynamic-prefix`);
        console.error(`[worktrees POST] Available dynamic repo keys:`, Array.from(dynamicRepos.keys()).slice(0, 20));
        
        return NextResponse.json(
          { 
            error: `Invalid repository: ${repoIdentifier}`,
            details: `Repository not found in known GitHub accounts. Ensure the repository key matches the format from /api/repos.`,
            availableRepos: Array.from(dynamicRepos.keys()).slice(0, 10)
          },
          { status: 400 }
        );
      }

      if (matchedRepoInfo) {
        const requestedAccountId = repoAccountMap[repoIdentifier] || github_account_id;
        let resolvedAccountId = requestedAccountId as string | undefined;

        if (!resolvedAccountId && matchedRepoInfo.accountIds?.length) {
          const sanitizedIdentifier = sanitizeKey(repoIdentifier);
          const accountMatch = matchedRepoInfo.accountIds.find(accountId => sanitizedIdentifier === buildRepoAccountKey(matchedRepoInfo!.full_name, accountId));
          if (accountMatch) {
            resolvedAccountId = accountMatch;
          } else if (matchedRepoInfo.accountIds.length === 1) {
            resolvedAccountId = matchedRepoInfo.accountIds[0];
          }
        }

        repoAccountAssignments[repoIdentifier] = resolvedAccountId;
      } else if (repoAccountMap[repoIdentifier]) {
        repoAccountAssignments[repoIdentifier] = repoAccountMap[repoIdentifier];
      }

      if (matchedRepoInfo?.full_name && !repoFullNameMap[repoIdentifier]) {
        repoFullNameMap[repoIdentifier] = matchedRepoInfo.full_name;
      }

      console.log(`[worktrees POST] Repository found: ${repoIdentifier} (matched via ${matchType || 'dynamic'})`);
    }

    const projectRepoMapByFullName = new Map<string, { id: string; repository_full_name: string }>();
    const projectRepoMapByRepoName = new Map<string, Array<{ id: string; repository_full_name: string }>>();

    for (const row of projectRepoRows) {
      const normalized = row.repository_full_name.toLowerCase();
      projectRepoMapByFullName.set(normalized, row);

      const repoName = row.repository_full_name.split('/').pop()?.toLowerCase();
      if (repoName) {
        if (!projectRepoMapByRepoName.has(repoName)) {
          projectRepoMapByRepoName.set(repoName, []);
        }
        projectRepoMapByRepoName.get(repoName)!.push(row);
      }
    }

    const membershipErrors: string[] = [];

    for (const repoIdentifier of reposToProcess) {
      let fullName = repoFullNameMap[repoIdentifier];

      if (!fullName) {
        const metadata = metadataByRepoKey.get(repoIdentifier);
        if (metadata?.fullName) {
          fullName = metadata.fullName;
          repoFullNameMap[repoIdentifier] = fullName;
        }
      }

      let projectRepoRow: { id: string; repository_full_name: string } | undefined;
      if (fullName) {
        projectRepoRow = projectRepoMapByFullName.get(fullName.toLowerCase());
      }

      if (!projectRepoRow) {
        const candidateNames = new Set<string>();
        if (fullName) {
          const baseName = fullName.split('/').pop()?.toLowerCase();
          if (baseName) {
            candidateNames.add(baseName);
          }
        }

        const lowerIdentifier = repoIdentifier.toLowerCase();
        candidateNames.add(lowerIdentifier);

        const slashParts = repoIdentifier.split('/');
        if (slashParts.length > 1) {
          candidateNames.add(slashParts[slashParts.length - 1].toLowerCase());
        }

        const dashParts = repoIdentifier.split('-');
        if (dashParts.length > 1) {
          candidateNames.add(dashParts[dashParts.length - 1].toLowerCase());
        }

        candidateNames.add(sanitizeKey(repoIdentifier));
        candidateNames.delete('');

        for (const candidate of candidateNames) {
          const rows = projectRepoMapByRepoName.get(candidate);
          if (!rows || rows.length === 0) {
            continue;
          }

          if (rows.length === 1) {
            projectRepoRow = rows[0];
            break;
          }

          if (fullName) {
            const normalizedFull = fullName.toLowerCase();
            const exactRow = rows.find((row) => row.repository_full_name.toLowerCase() === normalizedFull);
            if (exactRow) {
              projectRepoRow = exactRow;
              break;
            }
          }
        }

        if (projectRepoRow && !fullName) {
          fullName = projectRepoRow.repository_full_name;
          repoFullNameMap[repoIdentifier] = fullName;
        }
      }

      if (!projectRepoRow) {
        membershipErrors.push(`Repository "${fullName || repoIdentifier}" is not associated with the selected project.`);
        continue;
      }

      if (!fullName) {
        fullName = projectRepoRow.repository_full_name;
        repoFullNameMap[repoIdentifier] = fullName;
      }

      if (!repoProjectRepositoryIdMap[repoIdentifier]) {
        repoProjectRepositoryIdMap[repoIdentifier] = projectRepoRow.id;
      }
    }

    if (membershipErrors.length > 0) {
      return NextResponse.json(
        {
          error: 'One or more repositories are not associated with the selected project.',
          details: membershipErrors,
        },
        { status: 400 }
      );
    }

    const resolvedRepoFullNames = reposToProcess.map((repoIdentifier) => repoFullNameMap[repoIdentifier]).filter(Boolean) as string[];

    const baseBranches = (body as any)?.baseBranches || {};
    const typeLabel = TYPE_LABELS[type] || type;
    const fullBranchName = type ? `${type}-${name}` : name;
    const baseBranchLines = reposToProcess
      .map((repoIdentifier) => {
        const branch = baseBranches[repoIdentifier];
        const fullName = repoFullNameMap[repoIdentifier] || repoIdentifier;
        return branch ? `- ${fullName}: ${branch}` : null;
      })
      .filter(Boolean) as string[];

    const defaultDescriptionSections = [
      `Type: ${typeLabel}`,
      `Branch Name: ${name}`,
      `Repositories: ${resolvedRepoFullNames.length > 0 ? resolvedRepoFullNames.join(', ') : reposToProcess.join(', ')}`,
    ];
    if (baseBranchLines.length > 0) {
      defaultDescriptionSections.push('Base Branches:', ...baseBranchLines);
    }

    const kanbanData = {
      title: (kanbanPayload?.title || `${typeLabel}: ${name}`).toString(),
      description: kanbanPayload?.description || defaultDescriptionSections.join('\n'),
      columnId: kanbanPayload?.columnId || 'backlog',
      status: kanbanPayload?.status || kanbanPayload?.columnId || 'backlog',
      source: kanbanPayload?.source || 'manual',
    };
    
    // Create worktrees for all selected repos
    const results = [];
    const errors = [];
    
    for (const repoIdentifier of reposToProcess) {
      const repoBaseBranch = baseBranches[repoIdentifier];
      const resolvedAccountId = repoAccountAssignments[repoIdentifier] || github_account_id;
      if (resolvedAccountId) {
        console.log(`[worktrees POST] Using account ${resolvedAccountId} for repo ${repoIdentifier}`);
      }
      const result = await createWorktreeForRepo(
        repoIdentifier, 
        type, 
        name, 
        repoBaseBranch,
        resolvedAccountId,
        userId
      );
      
      if (result.success && result.worktree) {
        results.push({
          ...result.worktree,
          repoIdentifier,
          fullName: repoFullNameMap[repoIdentifier] || null,
          projectRepositoryId: repoProjectRepositoryIdMap[repoIdentifier] || null,
        });
      } else {
        errors.push({
          repo: repoIdentifier,
          fullName: repoFullNameMap[repoIdentifier] || null,
          error: result.error || 'Unknown error'
        });
      }
    }
    
    let kanbanItem: any = null;
    let kanbanError: string | null = null;

    if (results.length > 0) {
      const timestamp = new Date().toISOString();
      const errorMap = new Map(errors.map((entry: any) => [entry.repo, entry.error]));
      const branchStatus: Record<string, any> = {};
      const primaryRepoFullName = resolvedRepoFullNames[0] || (reposToProcess.length > 0 ? (repoFullNameMap[reposToProcess[0]] || reposToProcess[0]) : null);

      for (const repoIdentifier of reposToProcess) {
        const fullName = repoFullNameMap[repoIdentifier] || resolvedRepoFullNames.find((name) => name && name.toLowerCase().includes(repoIdentifier.toLowerCase())) || repoIdentifier;
        const statusEntry: any = {
          repoKey: repoIdentifier,
          projectRepositoryId: repoProjectRepositoryIdMap[repoIdentifier] || null,
          file: 'pending',
          local_git: errorMap.has(repoIdentifier) ? 'failed' : 'success',
          remote_git: 'pending',
          updated_at: timestamp,
        };

        if (errorMap.has(repoIdentifier)) {
          statusEntry.error = errorMap.get(repoIdentifier);
        }

        branchStatus[fullName] = statusEntry;
      }

      try {
        const { query } = await import('@/lib/db/client');
        let boardId: string | null = null;

        const boardResult = await query(
          'SELECT id FROM kanban_boards WHERE project_id = $1 LIMIT 1',
          [projectId]
        );

        if (boardResult.rows.length > 0) {
          boardId = boardResult.rows[0].id;
        } else {
          const boardInsert = await query(
            'INSERT INTO kanban_boards (id, project_id) VALUES (gen_random_uuid(), $1) RETURNING id',
            [projectId]
          );
          boardId = boardInsert.rows[0].id;
        }

        const insertResult = await query(
          `INSERT INTO kanban_items (
            id, board_id, title, body, branch_name, repository, repositories, branch_type, column_id, status, branch_status, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, NOW(), NOW()
          ) RETURNING id, title, column_id, status`,
          [
            boardId,
            kanbanData.title,
            kanbanData.description,
            fullBranchName,
            primaryRepoFullName,
            JSON.stringify(resolvedRepoFullNames),
            type,
            kanbanData.columnId,
            kanbanData.status,
            JSON.stringify(branchStatus),
          ]
        );

        if (insertResult.rows.length > 0) {
          kanbanItem = insertResult.rows[0];
        }
      } catch (kanbanDbError: any) {
        console.error('[worktrees POST] Failed to create kanban item via PostgreSQL:', kanbanDbError?.message || kanbanDbError);
        try {
          const { createServiceRoleClient } = await import('@/lib/supabase/server');
          const supabase = createServiceRoleClient();

          const { data: existingBoard, error: boardFetchError } = await supabase
            .from('kanban_boards')
            .select('id')
            .eq('project_id', projectId)
            .maybeSingle();

          if (boardFetchError) {
            throw boardFetchError;
          }

          let boardId = existingBoard?.id || null;

          if (!boardId) {
            const { data: insertedBoard, error: boardInsertError } = await supabase
              .from('kanban_boards')
              .insert({ project_id: projectId })
              .select('id')
              .single();

            if (boardInsertError) {
              throw boardInsertError;
            }

            boardId = insertedBoard?.id || null;
          }

          if (!boardId) {
            throw new Error('Failed to resolve kanban board ID');
          }

          const { data: insertedItem, error: supabaseKanbanError } = await supabase
            .from('kanban_items')
            .insert({
              board_id: boardId,
              title: kanbanData.title,
              body: kanbanData.description,
              branch_name: fullBranchName,
              repository: primaryRepoFullName,
              repositories: resolvedRepoFullNames,
              branch_type: type,
              column_id: kanbanData.columnId,
              status: kanbanData.status,
              branch_status: branchStatus,
            })
            .select('id, title, column_id, status')
            .single();

          if (supabaseKanbanError) {
            throw supabaseKanbanError;
          }

          kanbanItem = insertedItem;
        } catch (kanbanSupabaseError: any) {
          console.error('[worktrees POST] Failed to create kanban item via Supabase:', kanbanSupabaseError?.message || kanbanSupabaseError);
          kanbanError = kanbanSupabaseError?.message || 'Failed to create kanban item';
        }
      }
    }
    
    // Return results
    if (results.length === 0) {
      // All failed - include detailed error messages
      const errorMessages = errors.map(e => `${e.repo}: ${e.error}`).join('; ');
      return NextResponse.json(
        { 
          error: `Failed to create worktrees in all repositories: ${errorMessages}`,
          errors 
        },
        { status: 500 }
      );
    }
    
    // Return success with results and any errors
    return NextResponse.json({
      worktrees: results,
      errors: errors.length > 0 ? errors : undefined,
      kanbanItem: kanbanItem || undefined,
      kanbanError: kanbanError || undefined,
      projectId,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to create worktrees' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    const {
      repo,
      type,
      name,
      path: worktreePath,
      projectId: providedProjectId,
      kanbanItemId: providedKanbanItemId,
      branch: providedBranchName,
      repoFullName: providedRepoFullName,
    } = body;
    
    if (!repo || !type || !name) {
      return NextResponse.json(
        { error: 'Missing required fields: repo, type, name' },
        { status: 400 }
      );
    }
    
    // Find repository config - check both hardcoded and dynamic repos
    let repoKey: string | undefined;
    let config: { name: string; url: string } | undefined;
    
    if (REPO_NAME_MAP[repo]) {
      repoKey = REPO_NAME_MAP[repo].key;
      config = REPO_NAME_MAP[repo].config;
    } else if (REPO_MAP[repo]) {
      repoKey = repo;
      config = REPO_MAP[repo];
    } else {
      // Try to fetch dynamically from GitHub
      const dynamicRepos = await fetchRepositoriesFromGitHub();
      const matchedRepo = dynamicRepos.get(repo.toLowerCase());
      
      if (matchedRepo) {
        repoKey = repo;
        config = {
          name: matchedRepo.name,
          url: matchedRepo.url,
        };
      } else {
        return NextResponse.json(
          { error: `Invalid repository: ${repo}` },
          { status: 400 }
        );
      }
    }
    
    const resolvedRepoFullName = getRepoFullNameFromConfig(config);
    
    const repoPath = path.join(ROOT_DIR, config.name);
    
    if (!existsSync(repoPath)) {
      return NextResponse.json(
        { error: `Repository ${config.name} not found` },
        { status: 404 }
      );
    }
    
    // Use provided path or construct from worktree root
    const targetPath = worktreePath || path.join(WORKTREE_ROOT, config.name, `${config.name}-${type}-${name}`);
    
    // Fix permissions before attempting removal (in case files are owned by host user)
    // This helps when the container user doesn't match the host user
    if (existsSync(targetPath)) {
      try {
        // Make the entire worktree directory writable recursively
        // This allows removal even if files are owned by a different user (if filesystem allows)
        const fixPermissions = (dirPath: string) => {
          try {
            chmodSync(dirPath, 0o755); // Make directory writable
            const gitFile = path.join(dirPath, '.git');
            if (existsSync(gitFile)) {
              chmodSync(gitFile, 0o644); // Make .git file writable
            }
          } catch (chmodError) {
            // Ignore chmod errors - might fail if filesystem doesn't allow it
            console.warn(`Could not fix permissions for ${dirPath}: ${chmodError}`);
          }
        };
        fixPermissions(targetPath);
      } catch (permError) {
        // Ignore permission fixing errors - we'll try removal anyway
        console.warn(`Failed to fix permissions: ${permError}`);
      }
    }
    
    let removalAttempted = false;
    let removalSucceeded = false;
    
    try {
      // Try to remove using git worktree remove
      await execAsync(`git worktree remove "${targetPath}" --force`, {
        cwd: repoPath
      });
      removalAttempted = true;
      removalSucceeded = true;
    } catch (error: any) {
      removalAttempted = true;
      // If git worktree remove fails, try fixing permissions and retrying, then manual removal
      const errorMessage = error.message || String(error);
      const isPermissionError = errorMessage.includes('EACCES') || 
                                errorMessage.includes('permission denied') ||
                                errorMessage.includes('Permission denied') ||
                                errorMessage.includes('EACCES');
      
      if (isPermissionError && existsSync(targetPath)) {
        console.warn(`Permission error during git worktree remove: ${errorMessage}, attempting to fix permissions and retry`);
        try {
          // Fix permissions on the .git file/link specifically (common issue)
          const gitFile = path.join(targetPath, '.git');
          if (existsSync(gitFile)) {
            try {
              await execAsync(`chmod 644 "${gitFile}" 2>/dev/null || chmod 755 "${gitFile}" 2>/dev/null || true`);
            } catch {
              // Ignore individual file permission errors
            }
          }
          
          // Try to make files writable using chmod recursively
          // Use a shell command to recursively chmod the directory
          await execAsync(`chmod -R u+w "${targetPath}" 2>/dev/null || true`, {
            cwd: repoPath
          });
          
          // Also try to fix ownership if possible (if running as root or with sudo)
          try {
            await execAsync(`chown -R $(whoami) "${targetPath}" 2>/dev/null || true`);
          } catch {
            // Ignore chown errors (might not have permission)
          }
          
          // Retry git worktree remove after fixing permissions
          try {
            await execAsync(`git worktree remove "${targetPath}" --force`, {
              cwd: repoPath
            });
            removalSucceeded = true;
            // Don't return early - verify it actually worked
          } catch (retryError) {
            console.warn(`Retry after chmod also failed: ${retryError}`);
          }
        } catch (chmodError) {
          console.warn(`Failed to fix permissions with chmod: ${chmodError}`);
        }
      }
      
      // If git worktree remove fails, try manual removal
      console.warn(`Failed to remove worktree via git: ${errorMessage}, trying manual removal`);
      try {
        if (existsSync(targetPath)) {
          // Fix .git file permissions first (common issue)
          const gitFile = path.join(targetPath, '.git');
          if (existsSync(gitFile)) {
            try {
              // Try to remove the .git file/link first
              await execAsync(`chmod 644 "${gitFile}" 2>/dev/null || chmod 755 "${gitFile}" 2>/dev/null || true`);
              // Try to remove it directly
              try {
                rmSync(gitFile, { force: true });
              } catch {
                // If that fails, try with sudo (if available)
                try {
                  await execAsync(`sudo rm -f "${gitFile}" 2>/dev/null || true`);
                } catch {
                  // Ignore sudo errors
                }
              }
            } catch {
              // Ignore .git file removal errors
            }
          }
          
          // Try to make files writable before manual removal
          try {
            await execAsync(`chmod -R u+w "${targetPath}" 2>/dev/null || true`);
            // Try fixing ownership
            try {
              await execAsync(`chown -R $(whoami) "${targetPath}" 2>/dev/null || true`);
            } catch {
              // Ignore chown errors
            }
          } catch {
            // Ignore chmod errors
          }
          
          // Try manual removal
          try {
            rmSync(targetPath, { recursive: true, force: true });
          } catch (rmSyncError: any) {
            // If rmSync fails, try using shell command with more force
            try {
              await execAsync(`rm -rf "${targetPath}" 2>/dev/null || true`);
            } catch {
              // Last resort: try with sudo if available
              try {
                await execAsync(`sudo rm -rf "${targetPath}" 2>/dev/null || true`);
              } catch {
                throw rmSyncError; // Re-throw original error if all methods fail
              }
            }
          }
          
          // Verify the worktree is removed from git's registry
          try {
            await execAsync(`git worktree prune`, { cwd: repoPath });
          } catch {
            // Ignore prune errors
          }
        } else {
          // Directory doesn't exist, but worktree might still be registered
          // Just prune it
          try {
            await execAsync(`git worktree prune`, { cwd: repoPath });
          } catch {
            // Ignore prune errors
          }
        }
      } catch (rmError: any) {
        return NextResponse.json(
          { error: `Failed to remove worktree: ${rmError.message}. The worktree directory may need to be manually removed or permissions fixed on the host. You can try: sudo rm -rf "${targetPath}"` },
          { status: 500 }
        );
      }
    }
    
    // Verify the worktree was actually removed
    // Check both directory existence and git worktree list
    let actuallyRemoved = false;
    
    // Check if directory still exists
    const dirStillExists = existsSync(targetPath);
    
    // Check if worktree is still registered in git
    try {
      const { stdout: worktreeList } = await execAsync('git worktree list', { cwd: repoPath });
      const worktreeLines = worktreeList.trim().split('\n');
      const normalizedTargetPath = targetPath.replace(/\/$/, '');
      
      const stillRegistered = worktreeLines.some(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) return false;
        const linePath = parts[0].replace(/\/$/, '');
        return linePath === normalizedTargetPath || 
               path.resolve(linePath) === path.resolve(normalizedTargetPath);
      });
      
      // Consider it removed if directory doesn't exist AND not in git list
      actuallyRemoved = !dirStillExists && !stillRegistered;
    } catch {
      // If we can't check git list, just check directory
      actuallyRemoved = !dirStillExists;
    }
    
    if (!actuallyRemoved) {
      // Try one more time with git worktree prune and manual removal
      console.warn('Worktree still exists after removal attempt, trying final cleanup');
      try {
        // Prune first
        await execAsync(`git worktree prune`, { cwd: repoPath }).catch(() => {});
        
        // If directory still exists, try removing it with multiple methods
        if (existsSync(targetPath)) {
          let removed = false;
          
          // Method 1: Fix permissions and ownership, then remove
          try {
            // Get current user info
            const { stdout: currentUser } = await execAsync(`whoami`);
            const { stdout: currentUid } = await execAsync(`id -u`);
            const { stdout: currentGid } = await execAsync(`id -g`);
            
            // Try to change ownership to current user (if we have permissions)
            await execAsync(`chown -R ${currentUid.trim()}:${currentGid.trim()} "${targetPath}" 2>/dev/null || true`).catch(() => {});
            // Make writable
            await execAsync(`chmod -R u+w "${targetPath}" 2>/dev/null || true`).catch(() => {});
            // Try removal
            await execAsync(`rm -rf "${targetPath}"`);
            removed = true;
          } catch (error1) {
            console.warn(`Method 1 failed: ${error1}`);
            
            // Method 2: Use Node's rmSync (may have different permissions)
            try {
              rmSync(targetPath, { recursive: true, force: true });
              removed = true;
            } catch (error2) {
              console.warn(`Method 2 (rmSync) failed: ${error2}`);
              
              // Method 3: Try removing .git file first, then directory
              try {
                const gitFile = path.join(targetPath, '.git');
                if (existsSync(gitFile)) {
                  try {
                    rmSync(gitFile, { force: true });
                  } catch {
                    // Try chmod then remove
                    try {
                      chmodSync(gitFile, 0o777);
                      rmSync(gitFile, { force: true });
                    } catch {
                      // Ignore .git file removal errors
                    }
                  }
                }
                // Now try removing directory again
                rmSync(targetPath, { recursive: true, force: true });
                removed = true;
              } catch (error3) {
                console.warn(`Method 3 failed: ${error3}`);
                
                // Method 4: Last resort - try to remove contents individually
                try {
                  const files = readdirSync(targetPath);
                  for (const file of files) {
                    const filePath = path.join(targetPath, file);
                    try {
                      rmSync(filePath, { recursive: true, force: true });
                    } catch {
                      // Try with chmod first
                      try {
                        chmodSync(filePath, 0o777);
                        rmSync(filePath, { recursive: true, force: true });
                      } catch {
                        // Continue with other files
                      }
                    }
                  }
                  // Try removing empty directory
                  rmSync(targetPath, { force: true });
                  removed = true;
                } catch (error4) {
                  console.error(`All removal methods failed for ${targetPath}`);
                  throw new Error(`Failed to remove directory: ${error4 instanceof Error ? error4.message : String(error4)}`);
                }
              }
            }
          }
          
          if (!removed && existsSync(targetPath)) {
            throw new Error(`Directory still exists after all removal attempts`);
          }
        }
        
        // Verify again
        const dirStillExistsAfter = existsSync(targetPath);
        if (dirStillExistsAfter) {
          // Get host path for error message
          const hostPath = targetPath.includes(ROOT_DIR) && ROOT_DIR !== HOST_ROOT_DIR
            ? targetPath.replace(ROOT_DIR, HOST_ROOT_DIR)
            : targetPath;
          
          return NextResponse.json(
            { 
              error: `Failed to remove worktree due to permission issues. Directory still exists.\n\n` +
                     `The container user (UID ${process.env.USER_ID || '1023'}) cannot delete files owned by UID 1020.\n\n` +
                     `To fix this, run on the host:\n` +
                     `  sudo rm -rf "${hostPath}"\n\n` +
                     `Or fix permissions for all worktrees:\n` +
                    `  ${FIX_PERMISSIONS_COMMAND}`,
              success: false,
              hostPath: hostPath
            },
            { status: 500 }
          );
        }
        
        // Check git list again
        try {
          const { stdout: finalList } = await execAsync('git worktree list', { cwd: repoPath });
          const finalLines = finalList.trim().split('\n');
          const normalizedTargetPath = targetPath.replace(/\/$/, '');
          
          const stillInGit = finalLines.some(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 2) return false;
            const linePath = parts[0].replace(/\/$/, '');
            return linePath === normalizedTargetPath || 
                   path.resolve(linePath) === path.resolve(normalizedTargetPath);
          });
          
          if (stillInGit) {
            return NextResponse.json(
              { 
                error: `Worktree directory removed but still registered in git. Run 'git worktree prune' in ${repoPath} to clean it up.`,
                success: false
              },
              { status: 500 }
            );
          }
        } catch {
          // Can't verify git list, but directory is gone, so consider it success
        }
      } catch (finalError: any) {
        return NextResponse.json(
          { 
            error: `Failed to remove worktree: ${finalError.message}. Directory may still exist at: ${targetPath}`,
            success: false
          },
          { status: 500 }
        );
      }
    }
    
    let kanbanResult: { deleted: boolean; itemId?: string; projectId?: string | null; error?: string } | undefined;

    const branchShort = `${type}-${name}`;
    const branchShortLower = branchShort.toLowerCase();
    const providedBranchValue = typeof providedBranchName === 'string' && providedBranchName.trim()
      ? providedBranchName.trim()
      : null;
    const providedBranchLower = providedBranchValue ? providedBranchValue.toLowerCase() : null;
    const repoFullNameCandidates = new Set<string>();

    if (typeof providedRepoFullName === 'string' && providedRepoFullName.trim()) {
      repoFullNameCandidates.add(providedRepoFullName.trim().toLowerCase());
    }
    if (resolvedRepoFullName) {
      repoFullNameCandidates.add(resolvedRepoFullName.toLowerCase());
    }

    const repoFullNameList = Array.from(repoFullNameCandidates);
    const initialProjectId = typeof providedProjectId === 'string' && providedProjectId.trim()
      ? providedProjectId.trim()
      : null;
    const initialItemId = typeof providedKanbanItemId === 'string' && providedKanbanItemId.trim()
      ? providedKanbanItemId.trim()
      : null;

    try {
      const usingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;
      let targetItemId = initialItemId || null;
      let targetProjectId = initialProjectId || null;

      if (usingNeon) {
        const { query } = await import('@/lib/db/client');

        if (!targetItemId) {
          const branchMatchValues = [branchShortLower];
          if (providedBranchLower && !branchMatchValues.includes(providedBranchLower)) {
            branchMatchValues.push(providedBranchLower);
          }

          const params: Array<any> = [branchMatchValues];
          let sql = `
            SELECT ki.id, ki.repositories, kb.project_id
            FROM kanban_items ki
            JOIN kanban_boards kb ON ki.board_id = kb.id
            WHERE LOWER(ki.branch_name) = ANY($1::text[])
          `;

          if (targetProjectId) {
            params.push(targetProjectId);
            sql += ` AND kb.project_id = $${params.length}`;
          }

          const result = await query(sql, params);
          const rows = result.rows || [];

          let matchingRow = rows.find((row: any) => {
            const repositories = Array.isArray(row.repositories)
              ? row.repositories
                  .map((value: any) => (typeof value === 'string' ? value.toLowerCase() : ''))
                  .filter(Boolean)
              : [];

            if (repoFullNameList.length > 0) {
              return repositories.some((value: string) => repoFullNameList.includes(value));
            }
            return true;
          });

          if (!matchingRow && rows.length === 1) {
            matchingRow = rows[0];
          }

          if (matchingRow) {
            targetItemId = matchingRow.id;
            if (!targetProjectId) {
              targetProjectId = matchingRow.project_id || null;
            }
          }
        }

        if (targetItemId) {
          await query('DELETE FROM kanban_items WHERE id = $1', [targetItemId]);
          kanbanResult = {
            deleted: true,
            itemId: targetItemId,
            projectId: targetProjectId || null,
          };
        } else {
          kanbanResult = {
            deleted: false,
            projectId: targetProjectId || initialProjectId || null,
          };
        }
      } else {
        const { createServiceRoleClient } = await import('@/lib/supabase/server');
        const supabase = createServiceRoleClient();

        if (!targetItemId) {
          const branchNamesToCheck = new Set<string>([branchShort, branchShortLower]);
          if (providedBranchValue) {
            branchNamesToCheck.add(providedBranchValue);
          }
          if (providedBranchLower) {
            branchNamesToCheck.add(providedBranchLower);
          }

          const branchNamesList = Array.from(branchNamesToCheck).filter((value) => !!value && typeof value === 'string');

          const { data: items, error: itemsError } = await supabase
            .from('kanban_items')
            .select('id, branch_name, board_id, repositories')
            .in('branch_name', branchNamesList);

          if (itemsError) {
            throw itemsError;
          }

          const boardIds = Array.from(new Set((items || []).map((item) => item.board_id).filter(Boolean)));
          let boardProjectMap = new Map<string, string | null>();

          if (boardIds.length > 0) {
            const { data: boards, error: boardsError } = await supabase
              .from('kanban_boards')
              .select('id, project_id')
              .in('id', boardIds);

            if (boardsError) {
              throw boardsError;
            }

            boardProjectMap = new Map((boards || []).map((board) => [board.id, board.project_id || null]));
          }

          const rows = items || [];
          let matchingRow = rows.find((row: any) => {
            const repoList = Array.isArray(row.repositories)
              ? row.repositories
                  .map((value: any) => (typeof value === 'string' ? value.toLowerCase() : ''))
                  .filter(Boolean)
              : [];

            if (targetProjectId && boardProjectMap.get(row.board_id) !== targetProjectId) {
              return false;
            }

            if (repoFullNameList.length > 0) {
              return repoList.some((value: string) => repoFullNameList.includes(value));
            }

            return true;
          });

          if (!matchingRow && rows.length === 1) {
            matchingRow = rows[0];
          }

          if (matchingRow) {
            targetItemId = matchingRow.id;
            if (!targetProjectId) {
              targetProjectId = boardProjectMap.get(matchingRow.board_id) || null;
            }
          }
        }

        if (targetItemId) {
          const { error: deleteError } = await supabase
            .from('kanban_items')
            .delete()
            .eq('id', targetItemId);

          if (deleteError) {
            throw deleteError;
          }

          kanbanResult = {
            deleted: true,
            itemId: targetItemId,
            projectId: targetProjectId || null,
          };
        } else {
          kanbanResult = {
            deleted: false,
            projectId: targetProjectId || initialProjectId || null,
          };
        }
      }
    } catch (error: any) {
      kanbanResult = {
        deleted: false,
        projectId: initialProjectId,
        error: error?.message || 'Failed to delete kanban item',
      };
    }

    return NextResponse.json({ success: true, kanban: kanbanResult });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to delete worktree' },
      { status: 500 }
    );
  }
}
