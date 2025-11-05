'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KanbanItem } from '@/components/kanban/KanbanCard';

interface MyItemsTabProps {
  projectId: string;
}

export function MyItemsTab({ projectId }: MyItemsTabProps) {
  const [items, setItems] = useState<KanbanItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadItems();
  }, [projectId]);

  const loadItems = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/kanban-items`);
      if (!response.ok) throw new Error('Failed to load items');
      const data = await response.json();
      setItems(data.items || []);
    } catch (error) {
      console.error('Error loading items:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading my items...</div>;
  }

  // For now, show all items. In the future, this could filter by assignee
  // TODO: Add assignee filtering when user system is implemented
  const myItems = items;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold mb-2">My Items</h2>
        <p className="text-sm text-muted-foreground">
          Tasks assigned to you ({myItems.length} items)
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {myItems.map((item) => (
          <Card key={item.id} className="p-4">
            <h3 className="font-medium mb-2">{item.title}</h3>
            {item.body && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                {item.body}
              </p>
            )}
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline">{item.status}</Badge>
              {item.branch_type && (
                <Badge variant="secondary">{item.branch_type}</Badge>
              )}
            </div>
          </Card>
        ))}
        {myItems.length === 0 && (
          <div className="col-span-full text-center text-muted-foreground py-8">
            No items assigned to you
          </div>
        )}
      </div>
    </div>
  );
}

