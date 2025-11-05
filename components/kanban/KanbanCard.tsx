'use client';

import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { GripVertical, Pencil, Trash2, Copy } from 'lucide-react';

export interface KanbanItem {
  id: string;
  title: string;
  body: string | null;
  branch_name: string | null;
  branch_type: string | null;
  repositories: string[] | null;
  column_id: string;
  status: string;
  created_at: string;
}

interface KanbanCardProps {
  item: KanbanItem;
  onEdit: (item: KanbanItem) => void;
  onDelete: (itemId: string) => void;
  onDuplicate?: (item: KanbanItem) => void;
}

export function KanbanCard({ item, onEdit, onDelete, onDuplicate }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const repositories = Array.isArray(item.repositories) 
    ? item.repositories 
    : (item.repositories ? JSON.parse(item.repositories as any) : []);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`mb-2 p-3 cursor-grab active:cursor-grabbing hover:shadow-lg hover:border-primary/50 transition-all duration-200 ${
        isDragging ? 'ring-2 ring-primary opacity-50' : ''
      }`}
      onClick={(e) => {
        // Only open editor if not clicking on the drag handle or menu
        if (!(e.target as HTMLElement).closest('[data-drag-handle]') && 
            !(e.target as HTMLElement).closest('[role="menu"]')) {
          onEdit(item);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <div
              {...attributes}
              {...listeners}
              data-drag-handle
              className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4" />
            </div>
            <h4 className="font-medium text-sm text-foreground line-clamp-2 flex-1">
              {item.title}
            </h4>
          </div>
          
          {item.body && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
              {item.body}
            </p>
          )}

          <div className="flex flex-wrap gap-1 mt-2">
            {item.branch_type && (
              <Badge variant="outline" className="text-xs">
                {item.branch_type}
              </Badge>
            )}
            {item.branch_name && (
              <Badge variant="secondary" className="text-xs font-mono">
                {item.branch_name}
              </Badge>
            )}
            {repositories.length > 0 && (
              <Badge variant="outline" className="text-xs">
                {repositories.length} {repositories.length === 1 ? 'repo' : 'repos'}
              </Badge>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="text-muted-foreground hover:text-foreground p-1 rounded"
              onClick={(e) => e.stopPropagation()}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(item)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            {onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate(item)}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onDelete(item.id)}
              className="text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}

