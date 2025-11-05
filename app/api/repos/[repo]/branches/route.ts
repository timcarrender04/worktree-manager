import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);
const ROOT_DIR = process.env.REPO_ROOT || '/repos';

// Helper function to get GitHub token from environment (.env.local) or files
function getGitHubToken(): string | null {
  // First check process.env (which includes .env.local via Next.js)
  let token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    // Fallback to reading from files (for backward compatibility)
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
    
    // Get GitHub token
    const token = getGitHubToken();
    
    if (!token) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN not found', branches: [] },
        { status: 400 }
      );
    }
    
    // Fetch user repos to find the correct full_name by matching the repo key
    // The repo parameter is the sanitized key (e.g., "nhs-app"), we need to find the full_name
    let repoFullName: string | null = null;
    const githubOrg = process.env.GITHUB_ORG || 'timcarrender04';
    
    // Prepare headers for GitHub API
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    
    try {
      // Fetch all user repos with pagination to match by key
      const userRepos = await fetchAllUserRepositories(token, headers);
      // Match by sanitized key (repo name converted to key format)
      const matchedRepo = userRepos.find((r: any) => {
        const repoKey = r.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        return repoKey === repo.toLowerCase();
      });
      
      if (matchedRepo) {
        repoFullName = matchedRepo.full_name;
      }
    } catch {
      // Continue with fallback
    }
    
    // If we couldn't find it, try constructing from org and repo name
    if (!repoFullName) {
      repoFullName = `${githubOrg}/${repo}`;
    }
    
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
          // If 404, try to find the correct repo name with pagination
          if (response.status === 404) {
            // Try fetching all user repos with pagination to find the correct full_name
            try {
              const userRepos = await fetchAllUserRepositories(token, headers);
              const matchedRepo = userRepos.find((r: any) => 
                r.name.toLowerCase().replace(/[^a-z0-9]/g, '-') === repo.toLowerCase()
              );
              if (matchedRepo) {
                repoFullName = matchedRepo.full_name;
                // Retry with correct full_name - reset pagination
                page = 1;
                hasMore = true;
                continue; // Retry the fetch with correct repoFullName
              }
            } catch (repoFetchError) {
              console.warn('Failed to fetch user repos for 404 retry:', repoFetchError);
            }
          }
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

