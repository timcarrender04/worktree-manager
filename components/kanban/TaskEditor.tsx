'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { KanbanItem } from './KanbanCard';

interface TaskEditorProps {
  item: KanbanItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (itemId: string, updates: Partial<KanbanItem>) => Promise<void>;
  availableRepositories?: string[];
}

export function TaskEditor({
  item,
  open,
  onOpenChange,
  onSave,
  availableRepositories = [],
}: TaskEditorProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [branchName, setBranchName] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setTitle(item.title || '');
      setBody(item.body || '');
      setBranchName(item.branch_name || '');
      const repos = Array.isArray(item.repositories)
        ? item.repositories
        : (item.repositories ? JSON.parse(item.repositories as any) : []);
      setSelectedRepos(repos);
    }
  }, [item]);

  const handleSave = async () => {
    if (!item) return;

    setSaving(true);
    try {
      await onSave(item.id, {
        title,
        body,
        branch_name: branchName,
        repositories: selectedRepos,
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving task:', error);
      alert('Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const toggleRepo = (repo: string) => {
    setSelectedRepos((prev) =>
      prev.includes(repo)
        ? prev.filter((r) => r !== repo)
        : [...prev, repo]
    );
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>
            Update task details. Changes are saved automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Description</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Task description"
              rows={6}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="branch">Branch Name</Label>
            <Input
              id="branch"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="branch-name"
            />
          </div>

          {availableRepositories.length > 0 && (
            <div className="space-y-2">
              <Label>Repositories</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px]">
                {availableRepositories.map((repo) => (
                  <Badge
                    key={repo}
                    variant={selectedRepos.includes(repo) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleRepo(repo)}
                  >
                    {repo}
                    {selectedRepos.includes(repo) && (
                      <X className="h-3 w-3 ml-1" />
                    )}
                  </Badge>
                ))}
                {selectedRepos.length === 0 && availableRepositories.length === 0 && (
                  <span className="text-sm text-muted-foreground">
                    No repositories available
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !title.trim()}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

