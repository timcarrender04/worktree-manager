import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateTaskFromVoice } from '@/lib/ai/task-generator';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      projectId,
      transcript,
      branchType,
      repositories, // Array of { repository_full_name, baseBranch }
    } = body;

    // Validate required fields
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    if (!transcript || !transcript.trim()) {
      return NextResponse.json(
        { error: 'Voice transcript is required' },
        { status: 400 }
      );
    }

    if (!branchType || !['feat', 'bugs', 'fixes', 'qaqc'].includes(branchType)) {
      return NextResponse.json(
        { error: 'Valid branch type (feat, bugs, fixes, qaqc) is required' },
        { status: 400 }
      );
    }

    if (!repositories || !Array.isArray(repositories) || repositories.length === 0) {
      return NextResponse.json(
        { error: 'At least one repository is required' },
        { status: 400 }
      );
    }

    // Supabase path (with auth)
    const supabase = await createClient();

    // Verify project exists
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, github_account_id')
      .eq('id', projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      );
    }

    // Step 1: Generate task from voice input using AI (Ollama)
    let task;
    try {
      task = await generateTaskFromVoice(
        transcript.trim(),
        branchType as 'feat' | 'bugs' | 'fixes' | 'qaqc'
      );
    } catch (error: any) {
      console.error('Error generating task:', error);
      return NextResponse.json(
        { error: `Failed to generate task: ${error.message}. Please ensure Ollama server is running at ${process.env.OLLAMA_SERVER || process.env.OLLAMA_BASE_URL || 'http://192.168.1.223:11434'}` },
        { status: 500 }
      );
    }

    // Step 2: Get project's GitHub account ID (already fetched above)
    const githubAccountId = project.github_account_id || undefined;

    // Step 3: Create worktrees for all repositories
    const worktreeResults = [];
    const worktreeErrors = [];
    
    for (const repo of repositories) {
      try {
        // Extract repo name from full name (owner/repo)
        const repoName = repo.repository_full_name.split('/').pop() || repo.repository_full_name;
        
        // Call worktree API to create worktree
        // Use internal API route - construct URL from request
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
          (request.headers.get('host') ? `http://${request.headers.get('host')}` : 'http://localhost:3000');
        
        const worktreeBody: any = {
          repos: [repoName],
          type: branchType,
          name: task.branchName.replace(`${branchType}-`, ''), // Remove prefix as worktree API adds it
          baseBranches: { [repoName]: repo.baseBranch || 'dev' },
        };
        
        // Add github_account_id if available
        if (githubAccountId) {
          worktreeBody.github_account_id = githubAccountId;
        }
        
        const worktreeResponse = await fetch(`${baseUrl}/api/worktrees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(worktreeBody),
        });

        const worktreeData = await worktreeResponse.json();
        
        if (!worktreeResponse.ok) {
          worktreeErrors.push({
            repository: repo.repository_full_name,
            error: worktreeData.error || 'Failed to create worktree',
          });
        } else {
          worktreeResults.push({
            repository: repo.repository_full_name,
            worktree: worktreeData.worktrees?.[0] || null,
          });
        }
      } catch (error: any) {
        worktreeErrors.push({
          repository: repo.repository_full_name,
          error: error.message || 'Failed to create worktree',
        });
      }
    }

    // Step 4: Create kanban item
    let kanbanItem;
    try {
      // Get or create kanban board
      let { data: board, error: boardError } = await supabase
        .from('kanban_boards')
        .select('id')
        .eq('project_id', projectId)
        .maybeSingle();

      if (boardError || !board) {
        const { data: newBoard, error: createError } = await supabase
          .from('kanban_boards')
          .insert({ project_id: projectId })
          .select('id')
          .single();

        if (createError || !newBoard) {
          throw new Error('Failed to create kanban board');
        }
        board = newBoard;
      }

      // Create kanban item
      const { data: item, error: insertError } = await supabase
        .from('kanban_items')
        .insert({
          board_id: board.id,
          title: task.title,
          body: task.description,
          branch_name: task.branchName,
          repositories: repositories.map((r: any) => r.repository_full_name),
          branch_type: branchType,
          repository: repositories[0].repository_full_name, // Legacy field
          column_id: 'backlog',
          status: 'backlog',
        })
        .select()
        .single();

      if (insertError) {
        throw new Error(`Failed to create kanban item: ${insertError.message}`);
      }

      kanbanItem = item;
    } catch (error: any) {
      console.error('Error creating kanban item:', error);
      return NextResponse.json(
        {
          error: `Failed to create kanban item: ${error.message}`,
          task,
          worktrees: worktreeResults,
          worktreeErrors,
        },
        { status: 500 }
      );
    }

    // Return combined result
    return NextResponse.json({
      task,
      kanbanItem,
      worktrees: worktreeResults,
      worktreeErrors: worktreeErrors.length > 0 ? worktreeErrors : undefined,
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error in POST /api/tasks/create-with-ai:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
