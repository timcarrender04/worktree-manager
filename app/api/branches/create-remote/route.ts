import { NextResponse } from 'next/server';
import { createRemoteBranch, updateBranchStatus } from '@/lib/github/branch-utils';
import { getGitHubToken } from '../../worktrees/route';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { itemId, repositories, branchName, baseBranch } = body;

    if (!itemId || !repositories || !Array.isArray(repositories) || repositories.length === 0 || !branchName) {
      return NextResponse.json(
        { error: 'Missing required fields: itemId, repositories (array), branchName' },
        { status: 400 }
      );
    }

    const token = getGitHubToken();
    if (!token) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN not found. Cannot create remote branches.' },
        { status: 400 }
      );
    }

    const results = [];
    const errors = [];

    // Create remote branch for each repository
    for (const repo of repositories) {
      const repoFullName = typeof repo === 'string' ? repo : repo.repository_full_name || repo.repoFullName;
      const repoBaseBranch = typeof repo === 'object' && repo.baseBranch ? repo.baseBranch : (baseBranch || 'dev');

      if (!repoFullName) {
        errors.push({
          repository: repo,
          error: 'Repository full name not provided',
        });
        continue;
      }

      try {
        // Update status: remote_git: pending
        await updateBranchStatus(itemId, repoFullName, 'remote_git', 'pending');

        // Create remote branch
        const result = await createRemoteBranch(repoFullName, branchName, repoBaseBranch, token);

        if (result.success) {
          // Update status: remote_git: success
          await updateBranchStatus(itemId, repoFullName, 'remote_git', 'success');
          results.push({
            repository: repoFullName,
            success: true,
          });
        } else {
          // Update status: remote_git: failed
          await updateBranchStatus(itemId, repoFullName, 'remote_git', 'failed', result.error);
          errors.push({
            repository: repoFullName,
            error: result.error || 'Failed to create remote branch',
          });
          console.warn(`Failed to create remote branch for ${repoFullName}:`, result.error);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await updateBranchStatus(itemId, repoFullName, 'remote_git', 'failed', errorMessage);
        errors.push({
          repository: repoFullName,
          error: errorMessage,
        });
        console.warn(`Error creating remote branch for ${repoFullName}:`, errorMessage);
      }
    }

    return NextResponse.json({
      success: results.length > 0,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: unknown) {
    console.error('Error in POST /api/branches/create-remote:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

