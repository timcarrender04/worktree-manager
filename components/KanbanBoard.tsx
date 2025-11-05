'use client';

import { useState, useEffect, useRef } from 'react';

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

interface KanbanBoardProps {
  boardId: string;
  projectId: string;
  onItemMoved?: () => void;
}

interface Column {
  id: string;
  title: string;
  color: string;
  description: string;
}

const DEFAULT_COLUMNS: Column[] = [
  {
    id: 'backlog',
    title: 'Backlog',
    color: 'green',
    description: 'This item hasn\'t been started',
  },
  {
    id: 'ready',
    title: 'Ready',
    color: 'blue',
    description: 'This is ready to be picked up',
  },
  {
    id: 'in_progress',
    title: 'In progress',
    color: 'orange',
    description: 'This is actively being worked on',
  },
  {
    id: 'in_review',
    title: 'In review',
    color: 'purple',
    description: 'This item is in review',
  },
  {
    id: 'done',
    title: 'Done',
    color: 'red',
    description: 'This has been completed',
  },
];

const COLOR_STYLES: Record<string, { border: string; bg: string }> = {
  green: { border: 'border-green-500', bg: 'bg-green-50' },
  blue: { border: 'border-blue-500', bg: 'bg-blue-50' },
  orange: { border: 'border-orange-500', bg: 'bg-orange-50' },
  purple: { border: 'border-purple-500', bg: 'bg-purple-50' },
  red: { border: 'border-red-500', bg: 'bg-red-50' },
  gray: { border: 'border-gray-500', bg: 'bg-gray-50' },
  yellow: { border: 'border-yellow-500', bg: 'bg-yellow-50' },
  pink: { border: 'border-pink-500', bg: 'bg-pink-50' },
  indigo: { border: 'border-indigo-500', bg: 'bg-indigo-50' },
};

const COLOR_OPTIONS = ['green', 'blue', 'orange', 'purple', 'red', 'gray', 'yellow', 'pink', 'indigo'];

export function KanbanBoard({ boardId, projectId, onItemMoved }: KanbanBoardProps) {
  const [items, setItems] = useState<KanbanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [draggedOverColumn, setDraggedOverColumn] = useState<string | null>(null);
  const [columns, setColumns] = useState<Column[]>(() => {
    const saved = localStorage.getItem(`kanban-columns-${projectId}`);
    return saved ? JSON.parse(saved) : DEFAULT_COLUMNS;
  });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showAddColumnModal, setShowAddColumnModal] = useState(false);
  const [showColumnSettings, setShowColumnSettings] = useState<string | null>(null);
  const [editingColumn, setEditingColumn] = useState<Column | null>(null);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [newColumnColor, setNewColumnColor] = useState('gray');
  const [newColumnDescription, setNewColumnDescription] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadItems();
  }, [projectId]);

  useEffect(() => {
    // Save columns to localStorage
    localStorage.setItem(`kanban-columns-${projectId}`, JSON.stringify(columns));
  }, [columns, projectId]);

  useEffect(() => {
    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenDropdown(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const moveItem = async (itemId: string, targetColumnId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item || item.column_id === targetColumnId) {
      setOpenDropdown(null);
      return;
    }

    // Optimistic update
    const updatedItems = items.map((i) =>
      i.id === itemId ? { ...i, column_id: targetColumnId, status: targetColumnId } : i
    );
    setItems(updatedItems);

    try {
      const response = await fetch(`/api/projects/${projectId}/kanban-items`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId,
          columnId: targetColumnId,
          status: targetColumnId,
        }),
      });

      if (!response.ok) {
        // Revert on error
        setItems(items);
        throw new Error('Failed to update item');
      }

      if (onItemMoved) {
        onItemMoved();
      }
    } catch (error) {
      console.error('Error moving item:', error);
      // Revert on error
      setItems(items);
    } finally {
      setOpenDropdown(null);
    }
  };

  const handleDragStart = (e: React.DragEvent, itemId: string) => {
    setDraggedItem(itemId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDraggedOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDraggedOverColumn(null);
  };

  const handleDrop = async (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    setDraggedOverColumn(null);

    if (!draggedItem) return;

    await moveItem(draggedItem, targetColumnId);
    setDraggedItem(null);
  };

  const getItemsForColumn = (columnId: string) => {
    return items.filter((item) => item.column_id === columnId);
  };

  const addColumn = () => {
    if (!newColumnTitle.trim()) return;

    const newColumn: Column = {
      id: `column-${Date.now()}`,
      title: newColumnTitle.trim(),
      color: newColumnColor,
      description: newColumnDescription.trim() || '',
    };

    setColumns([...columns, newColumn]);
    setNewColumnTitle('');
    setNewColumnColor('gray');
    setNewColumnDescription('');
    setShowAddColumnModal(false);
  };

  const updateColumn = (columnId: string, updates: Partial<Column>) => {
    setColumns(columns.map(col => col.id === columnId ? { ...col, ...updates } : col));
    setShowColumnSettings(null);
    setEditingColumn(null);
  };

  const deleteColumn = (columnId: string) => {
    if (confirm('Are you sure you want to delete this column? Items in this column will be moved to the first column.')) {
      // Move items to first column
      const firstColumnId = columns[0]?.id;
      if (firstColumnId) {
        items.forEach(item => {
          if (item.column_id === columnId) {
            moveItem(item.id, firstColumnId);
          }
        });
      }
      setColumns(columns.filter(col => col.id !== columnId));
      setShowColumnSettings(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading board...</div>
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <div className="flex gap-4 min-w-max p-2">
        {columns.map((column) => {
          const columnItems = getItemsForColumn(column.id);
          const itemCount = columnItems.length;
          const isDraggedOver = draggedOverColumn === column.id;
          const colorStyle = COLOR_STYLES[column.color] || COLOR_STYLES.gray;

          return (
            <div
              key={column.id}
              className={`flex-shrink-0 w-80 ${isDraggedOver ? 'bg-gray-50' : ''}`}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                {/* Column Header */}
                <div className="p-4 border-b border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3 h-3 rounded-full border-2 ${colorStyle.border} ${colorStyle.bg}`}
                      />
                      <h3 className="font-semibold text-sm text-gray-900">{column.title}</h3>
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {itemCount}
                      </span>
                    </div>
                    <div className="relative" ref={showColumnSettings === column.id ? dropdownRef : null}>
                      <button
                        onClick={() => setShowColumnSettings(showColumnSettings === column.id ? null : column.id)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                          <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                        </svg>
                      </button>
                      {showColumnSettings === column.id && (
                        <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10 border border-gray-200">
                          <button
                            onClick={() => {
                              setEditingColumn(column);
                              setNewColumnTitle(column.title);
                              setNewColumnColor(column.color);
                              setNewColumnDescription(column.description);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          >
                            Edit column
                          </button>
                          <button
                            onClick={() => deleteColumn(column.id)}
                            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                          >
                            Delete column
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {column.description && (
                    <p className="text-xs text-gray-500">{column.description}</p>
                  )}
                </div>

                {/* Column Items */}
                <div className="p-2 min-h-[200px] max-h-[600px] overflow-y-auto">
                  <div className="space-y-2">
                    {columnItems.map((item) => (
                      <div
                        key={item.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, item.id)}
                        className="bg-white border border-gray-200 rounded p-3 cursor-move hover:shadow-md transition-shadow relative group"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-medium text-gray-900 mb-1 line-clamp-2">
                              {item.title}
                            </h4>
                            {item.body && (
                              <p className="text-xs text-gray-500 line-clamp-2 mb-2">
                                {item.body}
                              </p>
                            )}
                            <div className="flex flex-wrap gap-1 mt-2">
                              {item.branch_name && (
                                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                                  {item.branch_name}
                                </span>
                              )}
                              {item.branch_type && (
                                <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                                  {item.branch_type}
                                </span>
                              )}
                            </div>
                            {item.repositories && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {(() => {
                                  const repos = Array.isArray(item.repositories)
                                    ? item.repositories
                                    : typeof item.repositories === 'string'
                                    ? JSON.parse(item.repositories)
                                    : [];
                                  return (
                                    <>
                                      {repos.slice(0, 2).map((repo: string, idx: number) => (
                                        <span
                                          key={idx}
                                          className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded"
                                        >
                                          {repo.split('/').pop()}
                                        </span>
                                      ))}
                                      {repos.length > 2 && (
                                        <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded">
                                          +{repos.length - 2}
                                        </span>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </div>
                          <div className="relative" ref={openDropdown === item.id ? dropdownRef : null}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenDropdown(openDropdown === item.id ? null : item.id);
                              }}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-gray-600"
                            >
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                              </svg>
                            </button>
                            {openDropdown === item.id && (
                              <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg z-10 border border-gray-200">
                                <div className="py-1">
                                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Move to</div>
                                  {columns
                                    .filter(col => col.id !== item.column_id)
                                    .map((col) => (
                                      <button
                                        key={col.id}
                                        onClick={() => moveItem(item.id, col.id)}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                                      >
                                        <div className={`w-2 h-2 rounded-full ${COLOR_STYLES[col.color]?.bg || 'bg-gray-500'}`} />
                                        {col.title}
                                      </button>
                                    ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Add Column Button */}
        <div className="flex-shrink-0 w-12 flex items-center justify-center">
          <button
            onClick={() => setShowAddColumnModal(true)}
            className="w-10 h-10 rounded-lg border-2 border-dashed border-gray-300 hover:border-gray-400 text-gray-400 hover:text-gray-600 flex items-center justify-center"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Add Column Modal */}
      {showAddColumnModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">Add New Column</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Column Title</label>
                <input
                  type="text"
                  value={newColumnTitle}
                  onChange={(e) => setNewColumnTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Enter column title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                <div className="flex gap-2">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewColumnColor(color)}
                      className={`w-8 h-8 rounded-full border-2 ${
                        COLOR_STYLES[color].border
                      } ${
                        newColumnColor === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={newColumnDescription}
                  onChange={(e) => setNewColumnDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Enter description"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowAddColumnModal(false);
                    setNewColumnTitle('');
                    setNewColumnColor('gray');
                    setNewColumnDescription('');
                  }}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={addColumn}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Add Column
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Column Modal */}
      {editingColumn && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96">
            <h3 className="text-lg font-semibold mb-4">Edit Column</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Column Title</label>
                <input
                  type="text"
                  value={newColumnTitle}
                  onChange={(e) => setNewColumnTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Enter column title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
                <div className="flex gap-2">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setNewColumnColor(color)}
                      className={`w-8 h-8 rounded-full border-2 ${
                        COLOR_STYLES[color].border
                      } ${
                        newColumnColor === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={newColumnDescription}
                  onChange={(e) => setNewColumnDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Enter description"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setEditingColumn(null);
                    setNewColumnTitle('');
                    setNewColumnColor('gray');
                    setNewColumnDescription('');
                  }}
                  className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    updateColumn(editingColumn.id, {
                      title: newColumnTitle,
                      color: newColumnColor,
                      description: newColumnDescription,
                    });
                    setNewColumnTitle('');
                    setNewColumnColor('gray');
                    setNewColumnDescription('');
                  }}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
