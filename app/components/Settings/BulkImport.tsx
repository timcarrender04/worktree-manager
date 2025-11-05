'use client';

import { useState } from 'react';

interface BulkImportProps {
  onImport: (envVars: Array<{ key: string; value: string }>) => void;
}

export function BulkImport({ onImport }: BulkImportProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parseEnvText = (input: string): Array<{ key: string; value: string }> => {
    const lines = input.split('\n');
    const envVars: Array<{ key: string; value: string }> = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      
      // Parse key=value format
      const match = trimmed.match(/^([^=#]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        // Validate key
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
          throw new Error(`Invalid key name: ${key}. Keys must start with a letter or underscore and contain only alphanumeric characters and underscores.`);
        }
        
        envVars.push({ key, value });
      }
    }
    
    return envVars;
  };

  const handleImport = () => {
    try {
      setError(null);
      if (!text.trim()) {
        setError('Please paste environment variables');
        return;
      }
      
      const envVars = parseEnvText(text);
      
      if (envVars.length === 0) {
        setError('No valid environment variables found. Format: KEY=value');
        return;
      }
      
      onImport(envVars);
      setText('');
    } catch (err: any) {
      setError(err.message || 'Failed to parse environment variables');
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Paste Environment Variables
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="KEY1=value1&#10;KEY2=value2&#10;KEY3=value3"
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
          rows={6}
        />
        <p className="text-xs text-gray-500 mt-1">
          Paste key=value pairs (one per line). Comments starting with # are ignored.
        </p>
      </div>
      
      {error && (
        <div className="p-3 bg-red-100 text-red-800 border border-red-300 rounded-md text-sm">
          {error}
        </div>
      )}
      
      <button
        onClick={handleImport}
        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
      >
        Import Variables
      </button>
    </div>
  );
}

