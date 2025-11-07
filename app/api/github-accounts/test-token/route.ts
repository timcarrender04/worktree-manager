import { NextResponse } from 'next/server';
import { getUserGitHubToken, getAuthenticatedUserId } from '@/lib/credentials/helpers';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

// Helper to get token from environment files
function getGitHubTokenFromEnv(): string | null {
  let token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    const projectRoot = process.cwd();
    const homeDir = os.homedir();
    const username = process.env.USER || process.env.USERNAME || 'root';
    const userHomeDir = path.join('/home', username);
    const worktreeManagerDir = path.join(projectRoot, 'worktree-manager');
    const isWorktreeManagerDir = projectRoot.includes('worktree-manager');
    const worktreeManagerRoot = isWorktreeManagerDir ? projectRoot : worktreeManagerDir;
    const ROOT_DIR = process.env.REPO_ROOT || '/repos';
    
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
      path.join(ROOT_DIR, '..', '.github-token'),
      path.join(ROOT_DIR, '.github-token'),
      path.join(homeDir, '.github-token'),
      path.join(userHomeDir, '.github-token'),
    ];
    
    for (const tokenFile of tokenFiles) {
      try {
        if (existsSync(tokenFile)) {
          token = readFileSync(tokenFile, 'utf-8').trim();
          break;
        }
      } catch {
        // Continue
      }
    }
  }
  
  return token || null;
}

/**
 * Test endpoint to get GitHub token
 * Useful for testing token retrieval with curl
 * 
 * Usage:
 *   curl http://localhost:3000/api/github-accounts/test-token
 *   curl http://localhost:3000/api/github-accounts/test-token?github_account_id=<account-id>
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const githubAccountId = searchParams.get('github_account_id');
    
    const result: {
      source: string;
      tokenFound: boolean;
      tokenLength?: number;
      accountId?: string;
      accountName?: string;
      githubUsername?: string;
      tokenPreview?: string; // First 4 and last 4 chars only
      error?: string;
    } = {
      source: 'unknown',
      tokenFound: false,
    };
    
    // Try database first
    try {
      const userId = await getAuthenticatedUserId();
      if (userId) {
        const token = githubAccountId 
          ? await getUserGitHubToken(userId, githubAccountId)
          : await getUserGitHubToken(userId);
        
        if (token) {
          result.source = 'database';
          result.tokenFound = true;
          result.tokenLength = token.length;
          result.tokenPreview = token.length > 8 
            ? `${token.substring(0, 4)}...${token.substring(token.length - 4)}`
            : '***';
          result.accountId = githubAccountId || 'default';
          
          // Try to get account info
          try {
            const { getUserGitHubAccount } = await import('@/lib/credentials/helpers');
            const account = githubAccountId
              ? await getUserGitHubAccount(userId, githubAccountId)
              : await getUserGitHubAccount(userId);
            
            if (account) {
              result.accountName = account.account_name;
              result.githubUsername = account.github_username;
            }
          } catch (err) {
            // Ignore account info errors
          }
          
          return NextResponse.json(result);
        }
      }
    } catch (error: any) {
      result.error = `Database lookup failed: ${error.message}`;
    }
    
    // Fallback to environment
    const envToken = getGitHubTokenFromEnv();
    if (envToken) {
      result.source = 'environment';
      result.tokenFound = true;
      result.tokenLength = envToken.length;
      result.tokenPreview = envToken.length > 8 
        ? `${envToken.substring(0, 4)}...${envToken.substring(envToken.length - 4)}`
        : '***';
      return NextResponse.json(result);
    }
    
    return NextResponse.json(
      { 
        ...result,
        error: 'No token found. Please add a GitHub account in Settings or set GITHUB_TOKEN in environment.',
        sources: {
          database: 'Checked user accounts from database',
          environment: 'Checked GITHUB_TOKEN from .env.local/.env files'
        }
      },
      { status: 404 }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get token' },
      { status: 500 }
    );
  }
}

