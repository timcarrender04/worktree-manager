'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { X, Filter } from 'lucide-react';

interface FilterBarProps {
  repositories: string[];
  onSearchChange: (search: string) => void;
  onRepositoryFilter: (repos: string[]) => void;
  onBranchTypeFilter: (types: string[]) => void;
  onStatusFilter: (statuses: string[]) => void;
}

export function FilterBar({
  repositories,
  onSearchChange,
  onRepositoryFilter,
  onBranchTypeFilter,
  onStatusFilter,
}: FilterBarProps) {
  const [search, setSearch] = useState('');
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [selectedBranchTypes, setSelectedBranchTypes] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

  const branchTypes = ['feat', 'bugs', 'fixes', 'qaqc'];
  const statuses = ['backlog', 'ready', 'in_progress', 'in_review', 'done'];

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearchChange(value);
  };

  const toggleRepo = (repo: string) => {
    const newRepos = selectedRepos.includes(repo)
      ? selectedRepos.filter((r) => r !== repo)
      : [...selectedRepos, repo];
    setSelectedRepos(newRepos);
    onRepositoryFilter(newRepos);
  };

  const toggleBranchType = (type: string) => {
    const newTypes = selectedBranchTypes.includes(type)
      ? selectedBranchTypes.filter((t) => t !== type)
      : [...selectedBranchTypes, type];
    setSelectedBranchTypes(newTypes);
    onBranchTypeFilter(newTypes);
  };

  const toggleStatus = (status: string) => {
    const newStatuses = selectedStatuses.includes(status)
      ? selectedStatuses.filter((s) => s !== status)
      : [...selectedStatuses, status];
    setSelectedStatuses(newStatuses);
    onStatusFilter(newStatuses);
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedRepos([]);
    setSelectedBranchTypes([]);
    setSelectedStatuses([]);
    onSearchChange('');
    onRepositoryFilter([]);
    onBranchTypeFilter([]);
    onStatusFilter([]);
  };

  const hasActiveFilters =
    search ||
    selectedRepos.length > 0 ||
    selectedBranchTypes.length > 0 ||
    selectedStatuses.length > 0;

  const activeFilterCount =
    selectedRepos.length + selectedBranchTypes.length + selectedStatuses.length;

  return (
    <div className="space-y-3 p-4 border-b bg-white">
      <div className="flex items-center gap-4">
        <Input
          placeholder="Filter by keyword or by field..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="max-w-md"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="gap-2">
              <Filter className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="start">
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">Repositories</h4>
                <div className="flex flex-wrap gap-2">
                  {repositories.map((repo) => (
                    <Badge
                      key={repo}
                      variant={selectedRepos.includes(repo) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleRepo(repo)}
                    >
                      {repo.split('/').pop()}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Branch Type</h4>
                <div className="flex flex-wrap gap-2">
                  {branchTypes.map((type) => (
                    <Badge
                      key={type}
                      variant={selectedBranchTypes.includes(type) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleBranchType(type)}
                    >
                      {type}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Status</h4>
                <div className="flex flex-wrap gap-2">
                  {statuses.map((status) => (
                    <Badge
                      key={status}
                      variant={selectedStatuses.includes(status) ? 'default' : 'outline'}
                      className="cursor-pointer"
                      onClick={() => toggleStatus(status)}
                    >
                      {status.replace('_', ' ')}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {(selectedRepos.length > 0 ||
        selectedBranchTypes.length > 0 ||
        selectedStatuses.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {selectedRepos.map((repo) => (
            <Badge
              key={repo}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => toggleRepo(repo)}
            >
              {repo}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
          {selectedBranchTypes.map((type) => (
            <Badge
              key={type}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => toggleBranchType(type)}
            >
              {type}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
          {selectedStatuses.map((status) => (
            <Badge
              key={status}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => toggleStatus(status)}
            >
              {status.replace('_', ' ')}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

