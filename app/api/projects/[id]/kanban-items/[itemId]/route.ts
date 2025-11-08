import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/auth/helpers';
import { query } from '@/lib/db/client';
import { getSessionUser } from '@/lib/auth/session';

function isLocalSupabaseUrl(url?: string | null) {
  if (!url) return false;
  return url.includes('localhost') || url.includes('127.0.0.1') || url.includes(':8002');
}

function parseRepositoriesPayload(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      console.warn('Unable to parse repositories payload - keeping original string value');
      return value;
    }
  }

  return value;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params;
    const payload = await request.json();
    const {
      column_id,
      status,
      title,
      body: itemBody,
      branch_name,
      branch_type,
      repositories,
    } = payload;

    const hasUpdatableField = [
      column_id,
      status,
      title,
      itemBody,
      branch_name,
      branch_type,
      repositories,
    ].some((value) => value !== undefined);

    if (!hasUpdatableField) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const sessionUser = await getSessionUser();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const isUsingNeon = !!process.env.DATABASE_URL && !isLocalSupabaseUrl(supabaseUrl);

    let adminStatus = false;
    if (isUsingNeon) {
      try {
        const roleResult = await query<{ is_super_admin: boolean }>(
          'SELECT is_super_admin FROM user_roles WHERE user_id = $1 LIMIT 1',
          [sessionUser.id]
        );
        adminStatus = roleResult.rows.length > 0 && roleResult.rows[0].is_super_admin === true;
      } catch (error) {
        console.warn('Could not check super admin status via PostgreSQL:', error);
      }
    } else {
      try {
        adminStatus = await isSuperAdmin(sessionUser.id);
      } catch (error) {
        console.warn('Could not check super admin status via Supabase:', error);
      }
    }

    let serviceClient: ReturnType<typeof createServiceRoleClient> | null = null;
    const getServiceClient = () => {
      if (!serviceClient) {
        serviceClient = createServiceRoleClient();
      }
      return serviceClient;
    };

    if (!adminStatus) {
      if (isUsingNeon) {
        try {
          const projectResult = await query<{ owner_id: string }>(
            'SELECT owner_id FROM projects WHERE id = $1 LIMIT 1',
            [id]
          );

          if (projectResult.rows.length === 0) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
          }

          const isOwner = projectResult.rows[0].owner_id === sessionUser.id;

          if (!isOwner) {
            const memberResult = await query<{ id: string }>(
              'SELECT id FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1',
              [id, sessionUser.id]
            );

            if (memberResult.rows.length === 0) {
              return NextResponse.json({ error: 'Access denied' }, { status: 403 });
            }
          }
        } catch (error) {
          console.error('Error verifying project access:', error);
          return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 });
        }
      } else {
        try {
          const supabase = getServiceClient();

          const { data: project, error: projectError } = await supabase
            .from('projects')
            .select('owner_id')
            .eq('id', id)
            .maybeSingle();

          if (projectError) {
            console.error('Error fetching project for access check:', projectError);
            return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 });
          }

          if (!project) {
            return NextResponse.json({ error: 'Project not found' }, { status: 404 });
          }

          const isOwner = project.owner_id === sessionUser.id;

          if (!isOwner) {
            const { data: member, error: memberError } = await supabase
              .from('project_members')
              .select('id')
              .eq('project_id', id)
              .eq('user_id', sessionUser.id)
              .maybeSingle();

            if (memberError) {
              console.error('Error checking project membership:', memberError);
              return NextResponse.json({ error: 'Failed to verify access' }, { status: 500 });
            }

            if (!member) {
              return NextResponse.json({ error: 'Access denied' }, { status: 403 });
            }
          }
        } catch (error) {
          console.error('Failed to initialize Supabase service role client:', error);
          return NextResponse.json(
            { error: 'Supabase service role client is not configured' },
            { status: 500 }
          );
        }
      }
    }

    if (isUsingNeon) {
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIndex = 1;

      if (column_id !== undefined) {
        updates.push(`column_id = $${paramIndex++}`);
        values.push(column_id);
      }
      if (status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(status);
      } else if (column_id !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(column_id);
      }
      if (title !== undefined) {
        updates.push(`title = $${paramIndex++}`);
        values.push(title);
      }
      if (itemBody !== undefined) {
        updates.push(`body = $${paramIndex++}`);
        values.push(itemBody);
      }
      if (branch_name !== undefined) {
        updates.push(`branch_name = $${paramIndex++}`);
        values.push(branch_name);
      }
      if (branch_type !== undefined) {
        updates.push(`branch_type = $${paramIndex++}`);
        values.push(branch_type);
      }
      if (repositories !== undefined) {
        updates.push(`repositories = $${paramIndex++}`);
        values.push(Array.isArray(repositories) ? JSON.stringify(repositories) : repositories);
      }

      updates.push('updated_at = NOW()');

      const itemIdParam = paramIndex++;
      const projectIdParam = paramIndex++;

      values.push(itemId, id);

      const updateQuery = `
        UPDATE kanban_items
        SET ${updates.join(', ')}
        WHERE id = $${itemIdParam}
          AND board_id IN (SELECT id FROM kanban_boards WHERE project_id = $${projectIdParam})
        RETURNING *
      `;

      const updateResult = await query<any>(updateQuery, values);

      if (updateResult.rows.length === 0) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }

      const updatedItem = updateResult.rows[0];

      if (updatedItem && typeof updatedItem.repositories === 'string') {
        try {
          updatedItem.repositories = JSON.parse(updatedItem.repositories);
        } catch {
          // leave as string if parsing fails
        }
      }

      return NextResponse.json({ item: updatedItem, success: true });
    }

    let supabaseClient;
    try {
      supabaseClient = getServiceClient();
    } catch (error) {
      console.error('Failed to initialize Supabase service role client for update:', error);
      return NextResponse.json(
        { error: 'Supabase service role client is not configured' },
        { status: 500 }
      );
    }

    const existingItemResult = await supabaseClient
      .from('kanban_items')
      .select('id, board_id, kanban_boards!inner(project_id)')
      .eq('id', itemId)
      .maybeSingle();

    if (existingItemResult.error) {
      console.error('Error fetching kanban item for update:', existingItemResult.error);
      return NextResponse.json({ error: 'Failed to load kanban item' }, { status: 500 });
    }

    const existingItem = existingItemResult.data as any;

    if (!existingItem) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const boardProjectId = existingItem?.kanban_boards?.project_id;

    if (!boardProjectId) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (boardProjectId !== id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (column_id !== undefined) {
      updateData.column_id = column_id;
    }
    if (status !== undefined) {
      updateData.status = status;
    } else if (column_id !== undefined) {
      updateData.status = column_id;
    }
    if (title !== undefined) {
      updateData.title = title;
    }
    if (itemBody !== undefined) {
      updateData.body = itemBody;
    }
    if (branch_name !== undefined) {
      updateData.branch_name = branch_name;
    }
    if (branch_type !== undefined) {
      updateData.branch_type = branch_type;
    }
    if (repositories !== undefined) {
      updateData.repositories = parseRepositoriesPayload(repositories);
    }

    const updatedItemResult = await supabaseClient
      .from('kanban_items')
      .update(updateData)
      .eq('id', itemId)
      .eq('board_id', existingItem.board_id)
      .select('*')
      .single();

    if (updatedItemResult.error) {
      console.error('Error updating kanban item:', updatedItemResult.error);
      return NextResponse.json({ error: updatedItemResult.error.message }, { status: 500 });
    }

    const updatedItem = updatedItemResult.data as Record<string, any>;

    if (updatedItem && typeof updatedItem.repositories === 'string') {
      try {
        updatedItem.repositories = JSON.parse(updatedItem.repositories);
      } catch {
        // leave as string if parsing fails
      }
    }

    return NextResponse.json({ item: updatedItem, success: true });
  } catch (error: unknown) {
    console.error('Error in PATCH /api/projects/[id]/kanban-items/[itemId]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

