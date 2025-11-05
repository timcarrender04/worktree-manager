import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Helper to query database (for Neon)
async function queryDatabase(text: string, params?: unknown[]) {
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;
  
  if (isUsingNeon) {
    const { query } = await import('@/lib/db/client');
    return query(text, params);
  }
  
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id, itemId } = await params;
    const body = await request.json();
    const { 
      column_id, 
      status, 
      title, 
      body: itemBody, 
      branch_name, 
      repositories 
    } = body;

    // Build update query dynamically based on provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (column_id !== undefined) {
      updates.push(`column_id = $${paramIndex++}`);
      values.push(column_id);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    } else if (column_id !== undefined) {
      // If column_id is set but status is not, use column_id as status
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
    if (repositories !== undefined) {
      updates.push(`repositories = $${paramIndex++}`);
      values.push(Array.isArray(repositories) ? JSON.stringify(repositories) : repositories);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);

    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (isUsingNeon) {
      // Add itemId and projectId to values for WHERE clause
      const itemIdParam = paramIndex;
      const projectIdParam = paramIndex + 1;
      values.push(itemId, id);
      
      const updateQuery = `
        UPDATE kanban_items 
        SET ${updates.join(', ')}
        WHERE id = $${itemIdParam}
        AND board_id IN (SELECT id FROM kanban_boards WHERE project_id = $${projectIdParam})
      `;
      
      await queryDatabase(updateQuery, values);

      // Fetch updated item
      const itemResult = await queryDatabase(`
        SELECT * FROM kanban_items 
        WHERE id = $1
        AND board_id IN (SELECT id FROM kanban_boards WHERE project_id = $2)
      `, [itemId, id]);

      if (!itemResult || itemResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Item not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ item: itemResult.rows[0], success: true });
    } else {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const updateData: any = {};
      if (column_id !== undefined) updateData.column_id = column_id;
      if (status !== undefined) updateData.status = status;
      else if (column_id !== undefined) updateData.status = column_id;
      if (title !== undefined) updateData.title = title;
      if (itemBody !== undefined) updateData.body = itemBody;
      if (branch_name !== undefined) updateData.branch_name = branch_name;
      if (repositories !== undefined) {
        updateData.repositories = Array.isArray(repositories) ? repositories : JSON.parse(repositories);
      }

      const { data: item, error } = await supabase
        .from('kanban_items')
        .update(updateData)
        .eq('id', itemId)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ item, success: true });
    }
  } catch (error: unknown) {
    console.error('Error in PATCH /api/projects/[id]/kanban-items/[itemId]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

