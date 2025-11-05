'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KanbanCard, KanbanItem } from './KanbanCard';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Column {
  id: string;
  title: string;
  color?: string;
  description?: string;
}

interface KanbanColumnProps {
  column: Column;
  items: KanbanItem[];
  onEditItem: (item: KanbanItem) => void;
  onDeleteItem: (itemId: string) => void;
  onDuplicateItem?: (item: KanbanItem) => void;
}

export function KanbanColumn({
  column,
  items,
  onEditItem,
  onDeleteItem,
  onDuplicateItem,
}: KanbanColumnProps) {
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: {
      type: 'column',
      column,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const itemIds = items.map((item) => item.id);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`flex flex-col h-full min-w-[280px] max-w-[280px] transition-all duration-200 ${
        isDragging ? 'ring-2 ring-primary opacity-50' : ''
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="p-4 border-b cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm">{column.title}</h3>
          <Badge variant="secondary" className="text-xs">
            {items.length}
          </Badge>
        </div>
        {column.description && (
          <p className="text-xs text-muted-foreground">{column.description}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 bg-muted/30">
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {items.map((item) => (
            <KanbanCard
              key={item.id}
              item={item}
              onEdit={onEditItem}
              onDelete={onDeleteItem}
              onDuplicate={onDuplicateItem}
            />
          ))}
        </SortableContext>
        {items.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8 border-2 border-dashed rounded-md">
            Drop items here
          </div>
        )}
      </div>
    </Card>
  );
}

