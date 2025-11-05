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

export async function GET() {
  try {
    // Get GitHub token from environment or files
    const token = getGitHubToken();
    
    if (!token) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN not found. Please set GITHUB_TOKEN environment variable or create a token file.', repos: [] },
        { status: 400 }
      );
    }
    
    // Fetch all repositories dynamically with pagination
    const allRepositories: any[] = [];
    const repoMap = new Map<string, any>(); // Use full_name as key to deduplicate
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    
    try {
      // Fetch all user repositories with pagination
      let page = 1;
      let hasMore = true;
      const perPage = 100;
      
      while (hasMore) {
        const url = `https://api.github.com/user/repos?type=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`;
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch repositories: ${response.status} ${response.statusText}`);
        }
        
        const repos = await response.json();
        
        if (repos.length === 0) {
          hasMore = false;
        } else {
          repos.forEach((repo: any) => {
            // Use full_name as key to avoid duplicates
            if (!repoMap.has(repo.full_name)) {
              repoMap.set(repo.full_name, repo);
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
          console.warn('Reached pagination limit (100 pages)');
          hasMore = false;
        }
      }
      
      // Convert to array and sort by updated date
      allRepositories.push(...Array.from(repoMap.values()));
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
        
        // Use the repo name as the key, or full_name if we want to distinguish org/user repos
        const key = repo.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        
        return {
          key,
          name: repo.name,
          full_name: repo.full_name,
          url: repo.html_url || repo.url,
          exists,
          path: repoPath,
          description: repo.description,
          private: repo.private,
        };
      });
      
      console.log(`Fetched ${repos.length} repositories dynamically`);
      
      return NextResponse.json({ repos });
      
    } catch (error: any) {
      console.error('Error fetching repositories:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to fetch repositories', repos: [] },
        { status: 500 }
      );
    }
    
  } catch (error: any) {
    console.error('Error in GET /api/repos:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch repositories', repos: [] },
      { status: 500 }
    );
  }
}




