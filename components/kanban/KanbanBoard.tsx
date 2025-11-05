'use client';

import { useState, useEffect } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard, KanbanItem } from './KanbanCard';
import { TaskEditor } from './TaskEditor';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

interface Column {
  id: string;
  title: string;
  color?: string;
  description?: string;
}

interface KanbanBoardProps {
  boardId: string;
  projectId: string;
  onItemMoved?: () => void;
}

const DEFAULT_COLUMNS: Column[] = [
  {
    id: 'backlog',
    title: 'Backlog',
    description: 'This item hasn\'t been started',
  },
  {
    id: 'ready',
    title: 'Ready',
    description: 'This is ready to be picked up',
  },
  {
    id: 'in_progress',
    title: 'In progress',
    description: 'This is actively being worked on',
  },
  {
    id: 'in_review',
    title: 'In review',
    description: 'This item is in review',
  },
  {
    id: 'done',
    title: 'Done',
    description: 'This has been completed',
  },
];

export function KanbanBoard({ boardId, projectId, onItemMoved }: KanbanBoardProps) {
  const [items, setItems] = useState<KanbanItem[]>([]);
  const [columns, setColumns] = useState<Column[]>(DEFAULT_COLUMNS);
  const [loading, setLoading] = useState(true);
  const [activeItem, setActiveItem] = useState<KanbanItem | null>(null);
  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [editingItem, setEditingItem] = useState<KanbanItem | null>(null);
  const [availableRepos, setAvailableRepos] = useState<string[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    loadItems();
    loadColumns();
    loadRepositories();
  }, [projectId]);

  const loadRepositories = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (response.ok) {
        const data = await response.json();
        const repos = data.project?.repositories?.map((r: any) => r.repository_full_name) || [];
        setAvailableRepos(repos);
      }
    } catch (error) {
      console.error('Error loading repositories:', error);
    }
  };

  const loadItems = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/kanban-items`);
      if (!response.ok) throw new Error('Failed to load items');
      const data = await response.json();
      setItems(data.items || []);
    } catch (error) {
      console.error('Error loading kanban items:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadColumns = async () => {
    // TODO: Load columns from database when migration is complete
    // For now, use localStorage as fallback
    const saved = localStorage.getItem(`kanban-columns-${projectId}`);
    if (saved) {
      try {
        setColumns(JSON.parse(saved));
      } catch {
        setColumns(DEFAULT_COLUMNS);
      }
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    
    if (active.data.current?.type === 'item') {
      const item = active.data.current.item as KanbanItem;
      setActiveItem(item);
    } else if (active.data.current?.type === 'column') {
      const column = active.data.current.column as Column;
      setActiveColumn(column);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const isActiveItem = active.data.current?.type === 'item';
    const isOverColumn = over.data.current?.type === 'column';

    if (!isActiveItem || !isOverColumn) return;

    setItems((items) => {
      const activeIndex = items.findIndex((i) => i.id === activeId);
      const overColumnId = overId as string;

      if (items[activeIndex].column_id !== overColumnId) {
        return items.map((item, index) =>
          index === activeIndex
            ? { ...item, column_id: overColumnId, status: overColumnId }
            : item
        );
      }

      return items;
    });
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    
    setActiveItem(null);
    setActiveColumn(null);

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const isActiveItem = active.data.current?.type === 'item';
    const isOverItem = over.data.current?.type === 'item';
    const isOverColumn = over.data.current?.type === 'column';

    if (isActiveItem && isOverItem) {
      // Reordering within same column
      const activeIndex = items.findIndex((i) => i.id === activeId);
      const overIndex = items.findIndex((i) => i.id === overId);
      const activeItem = items[activeIndex];

      if (activeItem.column_id === items[overIndex].column_id) {
        const newItems = arrayMove(items, activeIndex, overIndex);
        setItems(newItems);
        return;
      }
    }

    if (isActiveItem && isOverColumn) {
      // Moving to different column
      const activeIndex = items.findIndex((i) => i.id === activeId);
      const newColumnId = overId as string;

      const updatedItems = items.map((item, index) =>
        index === activeIndex
          ? { ...item, column_id: newColumnId, status: newColumnId }
          : item
      );

      setItems(updatedItems);

      // Update in database
      try {
        const response = await fetch(
          `/api/projects/${projectId}/kanban-items/${activeId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              column_id: newColumnId,
              status: newColumnId,
            }),
          }
        );

        if (!response.ok) {
          // Revert on error
          setItems(items);
          throw new Error('Failed to update item');
        }

        if (onItemMoved) {
          onItemMoved();
        }
      } catch (error) {
        console.error('Error updating item:', error);
        setItems(items);
      }
    }
  };

  const getItemsByColumn = (columnId: string) => {
    return items.filter((item) => item.column_id === columnId);
  };

  const handleEditItem = (item: KanbanItem) => {
    setEditingItem(item);
  };

  const handleSaveItem = async (itemId: string, updates: Partial<KanbanItem>) => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/kanban-items/${itemId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update item');
      }

      const data = await response.json();
      
      // Update local state
      setItems((prev) =>
        prev.map((item) => (item.id === itemId ? { ...item, ...data.item } : item))
      );

      if (onItemMoved) {
        onItemMoved();
      }
    } catch (error) {
      console.error('Error saving item:', error);
      throw error;
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      const response = await fetch(`/api/projects/${projectId}/kanban-items`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId }),
      });

      if (!response.ok) throw new Error('Failed to delete item');

      setItems(items.filter((item) => item.id !== itemId));
      if (onItemMoved) {
        onItemMoved();
      }
    } catch (error) {
      console.error('Error deleting item:', error);
      alert('Failed to delete item');
    }
  };

  const columnIds = columns.map((col) => col.id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading board...</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            {columns.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                items={getItemsByColumn(column.id)}
                onEditItem={handleEditItem}
                onDeleteItem={handleDeleteItem}
              />
            ))}
          </SortableContext>
        </div>

        <DragOverlay>
          {activeItem && (
            <div className="opacity-50">
              <KanbanCard
                item={activeItem}
                onEdit={handleEditItem}
                onDelete={handleDeleteItem}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <TaskEditor
        item={editingItem}
        open={!!editingItem}
        onOpenChange={(open) => !open && setEditingItem(null)}
        onSave={handleSaveItem}
        availableRepositories={availableRepos}
      />
    </div>
  );
}

