import { NextResponse } from 'next/server';
import { createClient, createServiceRoleClient } from '@/lib/supabase/server';
import { deleteRemoteBranch, updateBranchStatus } from '@/lib/github/branch-utils';
import { getGitHubToken } from '../../../worktrees/route';
import { generateBranchNameFromTitle } from '@/lib/utils/branch-name';
import { query } from '@/lib/db/client';
import { isSuperAdmin } from '@/lib/auth/helpers';
import { cookies } from 'next/headers';

// Helper to get authenticated user from session cookie
async function getAuthenticatedUser(): Promise<{ id: string; email: string } | null> {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get('wt_session')

    if (!sessionToken) {
      return null
    }

    try {
      // Decode the session token
      const sessionData = JSON.parse(Buffer.from(sessionToken.value, 'base64').toString())
      
      // Check if token is expired
      if (sessionData.exp && Date.now() > sessionData.exp) {
        return null
      }

      return {
        id: sessionData.userId,
        email: sessionData.email,
      }
    } catch (error) {
      // Invalid token
      return null
    }
  } catch (error) {
    return null
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    // Get authenticated user from cookie session
    const user = await getAuthenticatedUser()
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check if we should use Neon or Supabase (same logic as project route)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const isLocalSupabase = supabaseUrl?.includes('localhost') || supabaseUrl?.includes('127.0.0.1') || supabaseUrl?.includes(':8002')
    const isUsingNeon = !!process.env.DATABASE_URL && !isLocalSupabase

    // Check if user is super admin
    let adminStatus = false
    if (isUsingNeon) {
      // For Neon, query directly using PostgreSQL
      try {
        const roleResult = await query<{ is_super_admin: boolean }>(
          'SELECT is_super_admin FROM user_roles WHERE user_id = $1 LIMIT 1',
          [user.id]
        )
        adminStatus = roleResult.rows.length > 0 && roleResult.rows[0].is_super_admin === true
      } catch (error) {
        console.warn('Could not check super admin status via PostgreSQL:', error)
      }
    } else {
      // For Supabase, use isSuperAdmin helper
      try {
        adminStatus = await isSuperAdmin(user.id)
      } catch (error) {
        console.warn('Could not check super admin status:', error)
      }
    }

    // Determine which client to use
    let clientToUse = await createClient()
    
    // If admin, use service role client to bypass RLS
    if (adminStatus) {
      try {
        clientToUse = createServiceRoleClient()
      } catch (error) {
        console.warn('Could not create service role client, using regular client:', error)
      }
    } else {
      // If not admin, verify user is project owner or member
      if (isUsingNeon) {
        try {
          const projectResult = await query<{ owner_id: string }>(
            'SELECT owner_id FROM projects WHERE id = $1 LIMIT 1',
            [id]
          )
          
          if (projectResult.rows.length === 0) {
            return NextResponse.json(
              { error: 'Project not found' },
              { status: 404 }
            )
          }

          const isOwner = projectResult.rows[0].owner_id === user.id
          
          if (!isOwner) {
            // Check if user is a member
            const memberResult = await query<{ id: string }>(
              'SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1',
              [id, user.id]
            )
            
            if (memberResult.rows.length === 0) {
              return NextResponse.json(
                { error: 'Access denied' },
                { status: 403 }
              )
            }
          }
        } catch (error) {
          console.error('Error checking project access:', error)
          return NextResponse.json(
            { error: 'Failed to verify access' },
            { status: 500 }
          )
        }
      } else {
        // For Supabase, check project access
        const supabase = await createClient()
        const { data: project, error: projectError } = await supabase
          .from('projects')
          .select('owner_id')
          .eq('id', id)
          .single()

        if (projectError || !project) {
          return NextResponse.json(
            { error: 'Project not found' },
            { status: 404 }
          )
        }

        const isOwner = project.owner_id === user.id
        
        if (!isOwner) {
          // Check if user is a member
          const { data: member } = await supabase
            .from('project_members')
            .select('id')
            .eq('project_id', id)
            .eq('user_id', user.id)
            .maybeSingle()

          if (!member) {
            return NextResponse.json(
              { error: 'Access denied' },
              { status: 403 }
            )
          }
        }
      }
    }
    
    // Get kanban board for project
    const { data: board } = await clientToUse
      .from('kanban_boards')
      .select('id')
      .eq('project_id', id)
      .maybeSingle();

    if (!board) {
      return NextResponse.json({ items: [] });
    }

    // Get kanban items
    const { data: items } = await clientToUse
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

    // Get or create kanban board - use local Supabase connection directly
    let board: { id: string } | null = null;
    
    try {
      // Use local Supabase connection (bypass cached pool that might be pointing to Neon)
      const { Pool } = await import('pg');
      const localPool = new Pool({
        host: 'localhost',
        port: 5433,
        database: 'repo_hub',
        user: 'postgres',
        password: 'postgres',
        connectionTimeoutMillis: 3000,
      });

      try {
        // Check if board exists
        const boardResult = await localPool.query(
          'SELECT id FROM kanban_boards WHERE project_id = $1',
          [id]
        );

        if (boardResult.rows.length > 0) {
          board = { id: boardResult.rows[0].id };
        } else {
          // Create board
          const newBoardResult = await localPool.query(
            'INSERT INTO kanban_boards (id, project_id) VALUES (gen_random_uuid(), $1) RETURNING id',
            [id]
          );
          board = { id: newBoardResult.rows[0].id };
        }
      } finally {
        await localPool.end();
      }
    } catch (pgError: any) {
      console.error('Error with local database connection for kanban board:', pgError);
      const errorMessage = pgError?.message || pgError?.toString() || 'Unknown error';
      const errorCode = pgError?.code;
      console.error('Error details:', { message: errorMessage, code: errorCode });
      return NextResponse.json(
        { error: 'Failed to get or create kanban board', details: errorMessage, code: errorCode },
        { status: 500 }
      );
    }

    if (!board) {
      console.error('Failed to get or create kanban board for project:', id);
      return NextResponse.json(
        { error: 'Failed to get or create kanban board', details: 'Check server logs' },
        { status: 500 }
      );
    }

    // Generate branch name if branch_type is provided but branch_name is not
    let finalBranchName = branch_name;
    if (branch_type && !finalBranchName) {
      // For testing: generate branch name from title
      // In production, this would use AI
      finalBranchName = generateBranchNameFromTitle(title, branch_type as 'feat' | 'bugs' | 'fixes' | 'qaqc');
    }

    const reposArray = repositories || [repository];
    
    // Create kanban item - use local Supabase connection
    let item: any;
    
    try {
      const { Pool } = await import('pg');
      const localPool = new Pool({
        host: 'localhost',
        port: 5433,
        database: 'repo_hub',
        user: 'postgres',
        password: 'postgres',
        connectionTimeoutMillis: 3000,
      });

      try {
        const itemResult = await localPool.query(
          `INSERT INTO kanban_items (
            board_id, title, body, branch_name, repository,
            branch_type, repositories, column_id, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *`,
          [
            board.id,
            title,
            itemBody || null,
            finalBranchName || null,
            repository,
            branch_type || null,
            JSON.stringify(reposArray),
            column_id,
            column_id,
          ]
        );

        item = itemResult.rows[0];
        
        // Parse JSONB fields
        if (item.repositories && typeof item.repositories === 'string') {
          item.repositories = JSON.parse(item.repositories);
        }
      } finally {
        await localPool.end();
      }
    } catch (pgError: any) {
      console.error('Error with local database connection for kanban item:', pgError);
      const errorMessage = pgError?.message || pgError?.toString() || 'Unknown error';
      const errorCode = pgError?.code;
      
      // Don't fallback to Supabase if it's a timeout - return error instead
      if (errorCode === 'ETIMEDOUT' || errorMessage.includes('timeout')) {
        return NextResponse.json(
          { error: 'Database connection timeout. Please check database is running.', details: errorMessage },
          { status: 500 }
        );
      }
      
      // For other errors, try Supabase fallback
      try {
        const supabase = createServiceRoleClient();
        const { data: supabaseItem, error } = await supabase
          .from('kanban_items')
          .insert({
            board_id: board.id,
            title,
            body: itemBody || null,
            branch_name: finalBranchName || null,
            repository,
            branch_type: branch_type || null,
            repositories: reposArray,
            column_id,
            status: column_id,
          })
          .select()
          .single();

        if (error) {
          return NextResponse.json({ error: error.message, details: 'Supabase fallback also failed' }, { status: 500 });
        }
        item = supabaseItem;
      } catch (supabaseError: any) {
        return NextResponse.json(
          { error: 'Failed to create kanban item', details: `Local: ${errorMessage}, Supabase: ${supabaseError.message}` },
          { status: 500 }
        );
      }
    }

    // If branch_type and branch_name are set, automatically create worktrees
    const worktreeResults: any[] = [];
    const worktreeErrors: any[] = [];

    if (branch_type && finalBranchName && reposArray.length > 0) {
      try {
        // Get project to find GitHub account - use direct PostgreSQL
        let githubAccountId: string | undefined;
        
        try {
          const { Pool } = await import('pg');
          const localPool = new Pool({
            host: 'localhost',
            port: 5433,
            database: 'repo_hub',
            user: 'postgres',
            password: 'postgres',
            connectionTimeoutMillis: 3000,
          });

          try {
            const projectResult = await localPool.query<{ github_account_id: string }>(
              'SELECT github_account_id FROM projects WHERE id = $1',
              [id]
            );

            if (projectResult.rows.length > 0 && projectResult.rows[0].github_account_id) {
              githubAccountId = projectResult.rows[0].github_account_id;
            }
          } finally {
            await localPool.end();
          }
        } catch (pgError) {
          // Fallback to Supabase
          const supabase = createServiceRoleClient();
          const { data: project } = await supabase
            .from('projects')
            .select('github_account_id')
            .eq('id', id)
            .single();
          
          githubAccountId = project?.github_account_id || undefined;
        }


        // Get base URL for internal API calls
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ||
          (request.headers.get('host') ? `http://${request.headers.get('host')}` : 'http://localhost:3333');

        // Create worktrees for each repository
        for (const repoFullName of reposArray) {
          try {
            // Extract repo name from full name (owner/repo)
            const repoName = repoFullName.split('/').pop() || repoFullName;

            // The worktree API expects the name without the branch_type prefix
            const worktreeName = finalBranchName.startsWith(`${branch_type}-`)
              ? finalBranchName.substring(`${branch_type}-`.length)
              : finalBranchName;

            const worktreeBody: any = {
              repos: [repoName],
              type: branch_type,
              name: worktreeName,
              baseBranch: 'main', // Default, could be made configurable
            };

            if (githubAccountId) {
              worktreeBody.githubAccountId = githubAccountId;
            }

            const worktreeResponse = await fetch(`${baseUrl}/api/worktrees`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(worktreeBody),
            });

            const worktreeData = await worktreeResponse.json();

            if (!worktreeResponse.ok) {
              worktreeErrors.push({
                repository: repoFullName,
                error: worktreeData.error || 'Failed to create worktree',
              });
            } else {
              worktreeResults.push({
                repository: repoFullName,
                success: true,
                worktree: worktreeData.worktrees?.[0] || worktreeData.worktree || null,
              });
            }
          } catch (error: any) {
            console.error(`Error creating worktree for ${repoFullName}:`, error);
            worktreeErrors.push({
              repository: repoFullName,
              error: error.message || 'Failed to create worktree',
            });
          }
        }
      } catch (error: any) {
        console.error('Error in worktree creation process:', error);
        // Don't fail the request - kanban item was created successfully
      }
    }

    return NextResponse.json({
      item,
      worktrees: worktreeResults.length > 0 ? worktreeResults : undefined,
      worktreeErrors: worktreeErrors.length > 0 ? worktreeErrors : undefined,
    });
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

    const supabase = await createClient();

    const { error } = await supabase
      .from('kanban_items')
      .update({
        column_id,
        status: status || column_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
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

    const supabase = await createClient();

    // Get item first to retrieve worktree info
    const { data: item, error: itemError } = await supabase
      .from('kanban_items')
      .select('*, kanban_boards!inner(project_id)')
      .eq('id', itemId)
      .single();

    if (itemError || !item) {
      return NextResponse.json(
        { error: 'Kanban item not found' },
        { status: 404 }
      );
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
  } catch (error: unknown) {
    console.error('Error in DELETE /api/projects/[id]/kanban-items:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
