'use client';

import { useState, useEffect } from 'react';
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface KanbanItem {
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

interface RoadmapViewProps {
  projectId: string;
}

export function RoadmapView({ projectId }: RoadmapViewProps) {
  const [items, setItems] = useState<KanbanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(new Date());

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

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1 });
  const weeks = Array.from({ length: 4 }, (_, i) => addWeeks(weekStart, i));

  const getItemsForWeek = (weekStart: Date, weekEnd: Date) => {
    return items.filter((item) => {
      const itemDate = new Date(item.created_at);
      return itemDate >= weekStart && itemDate <= weekEnd;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading roadmap...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Roadmap</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium min-w-[200px] text-center">
            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeek(new Date())}
          >
            Today
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {weeks.map((weekStart, index) => {
            const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });
            const weekItems = getItemsForWeek(weekStart, weekEnd);
            
            return (
              <Card key={index} className="p-4 min-w-[300px]">
                <div className="mb-4">
                  <h3 className="font-semibold text-sm">
                    {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d')}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {weekItems.length} {weekItems.length === 1 ? 'item' : 'items'}
                  </p>
                </div>
                <div className="space-y-2">
                  {weekItems.map((item) => (
                    <div
                      key={item.id}
                      className="p-2 border rounded text-sm hover:bg-muted cursor-pointer"
                    >
                      <div className="font-medium line-clamp-1">{item.title}</div>
                      <div className="flex gap-1 mt-1">
                        {item.branch_type && (
                          <Badge variant="outline" className="text-xs">
                            {item.branch_type}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                  {weekItems.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-4">
                      No items
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

