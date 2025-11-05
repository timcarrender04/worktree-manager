'use client';

import { useState } from 'react';

interface ServiceConfig {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'password';
}

interface ServiceToggleProps {
  serviceName: string;
  serviceLabel: string;
  configs: ServiceConfig[];
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onConfigChange: (key: string, value: string) => void;
  currentValues: Record<string, string>;
}

export function ServiceToggle({
  serviceName,
  serviceLabel,
  configs,
  enabled,
  onToggle,
  onConfigChange,
  currentValues,
}: ServiceToggleProps) {
  const [isExpanded, setIsExpanded] = useState(enabled);

  const handleToggle = (checked: boolean) => {
    onToggle(checked);
    setIsExpanded(checked);
  };

  return (
    <div className="border border-gray-300 rounded-lg p-4 bg-gray-50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleToggle(e.target.checked)}
            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label className="text-sm font-medium text-gray-700 cursor-pointer">
            {serviceLabel}
          </label>
        </div>
      </div>
      
      {isExpanded && (
        <div className="space-y-3 mt-4 pl-7">
          {configs.map((config) => (
            <div key={config.key}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {config.label}
              </label>
              <input
                type={config.type || 'text'}
                value={currentValues[config.key] || ''}
                onChange={(e) => onConfigChange(config.key, e.target.value)}
                placeholder={config.placeholder}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

