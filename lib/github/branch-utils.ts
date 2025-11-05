import { createGitHubClient } from '@/lib/github/client';
import { createClient } from '@/lib/supabase/server';

// Helper function to update branch status in database
export async function updateBranchStatus(
  itemId: string,
  repoFullName: string,
  operation: 'file' | 'local_git' | 'remote_git',
  status: 'success' | 'failed' | 'pending',
  error?: string
): Promise<void> {
  try {
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;
    const timestamp = new Date().toISOString();

    if (isUsingNeon) {
      // For Neon, use dynamic import
      const { query } = await import('@/lib/db/client');
      
      // Get current status
      const currentResult = await query(`
        SELECT branch_status FROM kanban_items WHERE id = $1
      `, [itemId]);

      let currentStatus: any = {};
      if (currentResult.rows.length > 0 && currentResult.rows[0].branch_status) {
        currentStatus = currentResult.rows[0].branch_status;
      }

      // Update status for this repository
      if (!currentStatus[repoFullName]) {
        currentStatus[repoFullName] = {};
      }
      currentStatus[repoFullName][operation] = status;
      currentStatus[repoFullName].updated_at = timestamp;
      if (error) {
        currentStatus[repoFullName].error = error;
      }

      // Update database
      await query(`
        UPDATE kanban_items 
        SET branch_status = $1, updated_at = NOW()
        WHERE id = $2
      `, [JSON.stringify(currentStatus), itemId]);
    } else {
      // Supabase path
      const supabase = await createClient();
      
      // Get current status
      const { data: item } = await supabase
        .from('kanban_items')
        .select('branch_status')
        .eq('id', itemId)
        .single();

      let currentStatus: any = item?.branch_status || {};

      // Update status for this repository
      if (!currentStatus[repoFullName]) {
        currentStatus[repoFullName] = {};
      }
      currentStatus[repoFullName][operation] = status;
      currentStatus[repoFullName].updated_at = timestamp;
      if (error) {
        currentStatus[repoFullName].error = error;
      }

      // Update database
      await supabase
        .from('kanban_items')
        .update({ branch_status: currentStatus })
        .eq('id', itemId);
    }
  } catch (error: any) {
    // Log error but don't throw - status tracking shouldn't block operations
    console.warn(`Failed to update branch status for ${repoFullName}:`, error.message);
  }
}

// Helper function to create remote branch via GitHub API
export async function createRemoteBranch(
  repoFullName: string,
  branchName: string,
  baseBranch: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      return { success: false, error: `Invalid repository format: ${repoFullName}` };
    }

    const githubClient = createGitHubClient(token);
    await githubClient.createBranch(owner, repo, branchName, baseBranch);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to create remote branch' };
  }
}

// Helper function to delete remote branch via GitHub API
export async function deleteRemoteBranch(
  repoFullName: string,
  branchName: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const [owner, repo] = repoFullName.split('/');
    if (!owner || !repo) {
      return { success: false, error: `Invalid repository format: ${repoFullName}` };
    }

    const githubClient = createGitHubClient(token);
    const deleted = await githubClient.deleteBranch(owner, repo, branchName);
    return { success: deleted || false };
  } catch (error: any) {
    return { success: false, error: error.message || 'Failed to delete remote branch' };
  }
}

