'use client';

import { useState } from 'react';

interface EnvVar {
  key: string;
  value: string;
}

interface EnvVarTableProps {
  envVars: EnvVar[];
  onUpdate: (index: number, key: string, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
}

export function EnvVarTable({ envVars, onUpdate, onDelete, onAdd }: EnvVarTableProps) {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());

  const toggleVisibility = (key: string) => {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const isSensitive = (key: string): boolean => {
    const sensitiveKeywords = ['password', 'secret', 'token', 'key', 'api', 'auth'];
    return sensitiveKeywords.some((keyword) => key.toLowerCase().includes(keyword));
  };

  const maskValue = (value: string): string => {
    if (value.length <= 4) return '••••';
    return '•'.repeat(Math.min(value.length, 20));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">Environment Variables</h3>
        <button
          onClick={onAdd}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm"
        >
          + Add Variable
        </button>
      </div>

      {envVars.length === 0 ? (
        <p className="text-black text-sm">No environment variables. Click "Add Variable" or import from below.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 border border-gray-300 rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Key
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Value
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {envVars.map((envVar, index) => {
                const isHidden = hiddenKeys.has(envVar.key);
                const sensitive = isSensitive(envVar.key);
                const showMasked = sensitive && isHidden;

                return (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="text"
                        value={envVar.key}
                        onChange={(e) => onUpdate(index, e.target.value, envVar.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                        placeholder="KEY_NAME"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        {showMasked ? (
                          <div className="flex-1 px-2 py-1 border border-gray-300 rounded bg-gray-50 text-sm font-mono text-gray-700">
                            {maskValue(envVar.value)}
                          </div>
                        ) : (
                          <input
                            type={sensitive ? 'password' : 'text'}
                            value={envVar.value}
                            onChange={(e) => onUpdate(index, envVar.key, e.target.value)}
                            className="flex-1 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                            placeholder="value"
                          />
                        )}
                        {sensitive && (
                          <button
                            onClick={() => toggleVisibility(envVar.key)}
                            className="px-2 py-1 text-xs text-gray-600 hover:text-gray-800"
                            type="button"
                          >
                            {isHidden ? 'Show' : 'Hide'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <button
                        onClick={() => onDelete(index)}
                        className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

