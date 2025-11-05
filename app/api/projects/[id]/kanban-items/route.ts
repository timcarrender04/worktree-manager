import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { deleteRemoteBranch, updateBranchStatus } from '@/lib/github/branch-utils';
import { getGitHubToken } from '../../../worktrees/route';

// Helper to query database (for Neon)
async function queryDatabase(text: string, params?: unknown[]) {
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;
  
  if (isUsingNeon) {
    const { query } = await import('@/lib/db/client');
    return query(text, params);
  }
  
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (isUsingNeon) {
      // Get kanban board for project
      const boardResult = await queryDatabase(`
        SELECT id FROM kanban_boards WHERE project_id = $1
      `, [id]);

      if (!boardResult || boardResult.rows.length === 0) {
        return NextResponse.json({ items: [] });
      }

      const boardId = boardResult.rows[0].id;

      // Get kanban items
      const itemsResult = await queryDatabase(`
        SELECT * FROM kanban_items 
        WHERE board_id = $1
        ORDER BY created_at DESC
      `, [boardId]);

      return NextResponse.json({ items: itemsResult?.rows || [] });
    }
    
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

      // Get kanban board for project
      const { data: board } = await supabase
        .from('kanban_boards')
        .select('id')
        .eq('project_id', id)
        .single();

      if (!board) {
        return NextResponse.json({ items: [] });
      }

      // Get kanban items
      const { data: items } = await supabase
        .from('kanban_items')
        .select('*')
        .eq('board_id', board.id)
        .order('created_at', { ascending: false });

    return NextResponse.json({ items: items || [] });
  } catch (error: unknown) {
    console.error('Error in GET /api/projects/[id]/kanban-items:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, body: itemBody, branch_name, repository, branch_type, repositories, column_id = 'backlog' } = body;

    if (!title || !repository) {
      return NextResponse.json(
        { error: 'Missing required fields: title, repository' },
        { status: 400 }
      );
    }

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (isUsingNeon) {
      // Get or create kanban board
      let boardResult = await queryDatabase(`
        SELECT id FROM kanban_boards WHERE project_id = $1
      `, [id]);

      let boardId: string;
      if (!boardResult || boardResult.rows.length === 0) {
        // Create board
        const createResult = await queryDatabase(`
          INSERT INTO kanban_boards (project_id)
          VALUES ($1)
          RETURNING id
        `, [id]);
        if (!createResult || createResult.rows.length === 0) {
          throw new Error('Failed to create kanban board');
        }
        boardId = createResult.rows[0].id;
      } else {
        boardId = boardResult.rows[0].id;
      }

      // Insert kanban item
      const reposArray = repositories || [repository];
      const insertResult = await queryDatabase(`
        INSERT INTO kanban_items (
          board_id, title, body, branch_name, repository, 
          branch_type, repositories, column_id, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `, [
        boardId,
        title,
        itemBody || null,
        branch_name || null,
        repository,
        branch_type || null,
        JSON.stringify(reposArray),
        column_id,
        column_id
      ]);

      if (!insertResult || insertResult.rows.length === 0) {
        throw new Error('Failed to create kanban item');
      }

      return NextResponse.json({ item: insertResult.rows[0] });
    }
    
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

      // Get or create kanban board
      let { data: board } = await supabase
        .from('kanban_boards')
        .select('id')
        .eq('project_id', id)
        .single();

      if (!board) {
        const { data: newBoard, error: createError } = await supabase
          .from('kanban_boards')
          .insert({ project_id: id })
          .select()
          .single();
        
        if (createError || !newBoard) {
          return NextResponse.json(
            { error: 'Failed to create kanban board' },
            { status: 500 }
          );
        }
        board = newBoard;
      }

      if (!board) {
        return NextResponse.json(
          { error: 'Failed to get or create kanban board' },
          { status: 500 }
        );
      }

      const reposArray = repositories || [repository];
      const { data: item, error } = await supabase
        .from('kanban_items')
        .insert({
          board_id: board.id,
          title,
          body: itemBody || null,
          branch_name: branch_name || null,
          repository,
          branch_type: branch_type || null,
          repositories: reposArray,
          column_id,
          status: column_id,
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

    return NextResponse.json({ item });
  } catch (error: unknown) {
    console.error('Error in POST /api/projects/[id]/kanban-items:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { itemId, column_id, status } = body;

    if (!itemId || !column_id) {
      return NextResponse.json(
        { error: 'Missing required fields: itemId, column_id' },
        { status: 400 }
      );
    }

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (isUsingNeon) {
      await queryDatabase(`
        UPDATE kanban_items 
        SET column_id = $1, status = $2, updated_at = NOW()
        WHERE id = $3
        AND board_id IN (SELECT id FROM kanban_boards WHERE project_id = $4)
      `, [column_id, status || column_id, itemId, id]);

      return NextResponse.json({ success: true });
    } else {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { error } = await supabase
        .from('kanban_items')
        .update({
          column_id,
          status: status || column_id,
        })
        .eq('id', itemId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }
  } catch (error: unknown) {
    console.error('Error in PATCH /api/projects/[id]/kanban-items:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { itemId } = body;

    if (!itemId) {
      return NextResponse.json(
        { error: 'itemId is required' },
        { status: 400 }
      );
    }

    // Check if Neon (DATABASE_URL) is configured
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;

    let item: any;

    if (isUsingNeon) {
      // For Neon, get item first to retrieve worktree info
      try {
        const itemResult = await queryDatabase(`
          SELECT * FROM kanban_items 
          WHERE id = $1
          AND board_id IN (SELECT id FROM kanban_boards WHERE project_id = $2)
        `, [itemId, id]);

        if (!itemResult || itemResult.rows.length === 0) {
          return NextResponse.json(
            { error: 'Kanban item not found' },
            { status: 404 }
          );
        }

        item = itemResult.rows[0];
      } catch (error: unknown) {
        console.error('Error fetching kanban item in Neon:', error);
        return NextResponse.json(
          { error: 'Failed to fetch kanban item' },
          { status: 500 }
        );
      }
    } else {
      // Supabase path
      const supabase = await createClient();

      // Get authenticated user
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }

      // Get item first to retrieve worktree info
      const { data: itemData, error: itemError } = await supabase
        .from('kanban_items')
        .select('*, kanban_boards!inner(project_id)')
        .eq('id', itemId)
        .single();

      if (itemError || !itemData) {
        return NextResponse.json(
          { error: 'Kanban item not found' },
          { status: 404 }
        );
      }

      item = itemData;
    }

    // Delete associated worktrees and remote branches
    if (item.branch_name && item.branch_type && (item.repositories || item.repository)) {
      try {
        // Parse repositories (could be string or array)
        let repositories: string[] = [];
        if (typeof item.repositories === 'string') {
          try {
            repositories = JSON.parse(item.repositories);
          } catch {
            repositories = [item.repositories];
          }
        } else if (Array.isArray(item.repositories)) {
          repositories = item.repositories;
        } else if (item.repository) {
          // Fallback to single repository field
          repositories = [item.repository];
        }

        // Extract branch name - remove type prefix if present
        let branchName = item.branch_name;
        const branchType = item.branch_type;
        
        // If branch_name starts with the type, remove it
        if (branchType && branchName.startsWith(`${branchType}-`)) {
          branchName = branchName.substring(branchType.length + 1);
        }

        // Get GitHub token
        const token = getGitHubToken();

        // Delete remote branches for each repository
        const remoteBranchDeletionResults = [];
        if (token && repositories.length > 0) {
          for (const repoFullName of repositories) {
            try {
              // Extract full branch name (repo-type-name format)
              const repoName = repoFullName.split('/').pop() || repoFullName.split('/')[1] || '';
              const fullBranchName = branchType && repoName 
                ? `${repoName}-${branchType}-${branchName}`
                : branchName;

              // Update status: remote_git: pending
              await updateBranchStatus(itemId, repoFullName, 'remote_git', 'pending');

              // Delete remote branch
              const result = await deleteRemoteBranch(repoFullName, fullBranchName, token);

              if (result.success) {
                // Update status: remote_git: success
                await updateBranchStatus(itemId, repoFullName, 'remote_git', 'success');
                remoteBranchDeletionResults.push({
                  repository: repoFullName,
                  success: true,
                });
              } else {
                // Update status: remote_git: failed
                await updateBranchStatus(itemId, repoFullName, 'remote_git', 'failed', result.error);
                remoteBranchDeletionResults.push({
                  repository: repoFullName,
                  success: false,
                  error: result.error || 'Failed to delete remote branch',
                });
                console.warn(`Failed to delete remote branch for ${repoFullName}:`, result.error);
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              await updateBranchStatus(itemId, repoFullName, 'remote_git', 'failed', errorMessage);
              remoteBranchDeletionResults.push({
                repository: repoFullName,
                success: false,
                error: errorMessage,
              });
              console.warn(`Error deleting remote branch for ${repoFullName}:`, errorMessage);
            }
          }
        } else if (!token) {
          console.warn('GITHUB_TOKEN not found. Skipping remote branch deletion.');
        }

        // Delete local worktrees
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
          (request.headers.get('host') ? `http://${request.headers.get('host')}` : 'http://localhost:3000');

        const worktreeDeletionResults = [];
        for (const repoFullName of repositories) {
          try {
            // Extract repo name from full name (owner/repo-name)
            const repoName = repoFullName.split('/').pop() || repoFullName;

            // Construct worktree path using TREE_LOCATION if available
            const treeLocation = process.env.TREE_LOCATION || process.env.WORKTREE_ROOT;
            let worktreePath: string | undefined;
            
            if (treeLocation) {
              // Construct the expected worktree path
              const fullBranchName = branchType && repoName 
                ? `${repoName}-${branchType}-${branchName}`
                : branchName;
              worktreePath = `${treeLocation}/${repoName}/${fullBranchName}`;
            }

            const worktreeResponse = await fetch(`${baseUrl}/api/worktrees`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                repo: repoName,
                type: branchType,
                name: branchName,
                path: worktreePath,
              }),
            });

            if (!worktreeResponse.ok) {
              const errorData = await worktreeResponse.json().catch(() => ({}));
              console.warn(`Failed to delete worktree for ${repoName}:`, errorData.error || 'Unknown error');
              worktreeDeletionResults.push({
                repository: repoFullName,
                success: false,
                error: errorData.error || 'Failed to delete worktree',
              });
            } else {
              worktreeDeletionResults.push({
                repository: repoFullName,
                success: true,
              });
            }
          } catch (error: unknown) {
            console.error(`Error deleting worktree for ${repoFullName}:`, error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            worktreeDeletionResults.push({
              repository: repoFullName,
              success: false,
              error: errorMessage,
            });
          }
        }

        // Log deletion results (but don't fail if some fail)
        console.log('Remote branch deletion results:', remoteBranchDeletionResults);
        console.log('Worktree deletion results:', worktreeDeletionResults);
      } catch (error: unknown) {
        console.error('Error deleting worktrees and remote branches:', error);
        // Continue with item deletion even if deletion fails
      }
    }

    // Delete the kanban item
    if (isUsingNeon) {
      try {
        await queryDatabase(`
          DELETE FROM kanban_items 
          WHERE id = $1
          AND board_id IN (SELECT id FROM kanban_boards WHERE project_id = $2)
        `, [itemId, id]);

        return NextResponse.json({ success: true });
      } catch (error: unknown) {
        console.error('Error deleting kanban item in Neon:', error);
        return NextResponse.json(
          { error: 'Failed to delete kanban item' },
          { status: 500 }
        );
      }
    } else {
      // Supabase path
      const supabase = await createClient();

      const { error: deleteError } = await supabase
        .from('kanban_items')
        .delete()
        .eq('id', itemId);

      if (deleteError) {
        console.error('Error deleting kanban item:', deleteError);
        return NextResponse.json(
          { error: 'Failed to delete kanban item' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true });
    }
  } catch (error: unknown) {
    console.error('Error in DELETE /api/projects/[id]/kanban-items:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
