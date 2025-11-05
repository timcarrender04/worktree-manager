'use client';

import { useState } from 'react';

interface EnvVar {
  key: string;
  value: string;
}

interface WelcomeModalProps {
  onImport: (envVars: EnvVar[]) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

export function WelcomeModal({ onImport, onClose, saving }: WelcomeModalProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const parseEnvText = (input: string): EnvVar[] => {
    const lines = input.split('\n');
    const envVars: EnvVar[] = [];
    
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

  const handleImport = async () => {
    try {
      setError(null);
      setImporting(true);
      
      if (!text.trim()) {
        setError('Please paste your environment variables');
        setImporting(false);
        return;
      }
      
      const envVars = parseEnvText(text);
      
      if (envVars.length === 0) {
        setError('No valid environment variables found. Format: KEY=value');
        setImporting(false);
        return;
      }
      
      // Import and save the variables (onImport handles saving)
      await onImport(envVars);
      
      // Close modal after successful import
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to parse environment variables');
    } finally {
      setImporting(false);
    }
  };

  const handleSkip = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-8">
          {/* Header */}
          <div className="mb-6">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome! Let's set up your environment
            </h2>
            <p className="text-gray-600">
              Paste your existing environment variables file (like <code className="bg-gray-100 px-1 rounded">.env</code>) below. 
              We'll automatically parse and import all the variables.
            </p>
          </div>

          {/* Textarea */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Environment Variables
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`# Example format:\nNEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key\nDATABASE_URL=postgresql://user:pass@host/db\nAWS_ACCESS_KEY_ID=your-key\nAWS_SECRET_ACCESS_KEY=your-secret`}
              className="w-full px-4 py-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              rows={12}
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-2">
              Paste key=value pairs (one per line). Comments starting with # are ignored.
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-800 border border-red-300 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <button
              onClick={handleSkip}
              disabled={importing || saving}
              className="px-4 py-2 text-gray-700 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Skip for now
            </button>
            <button
              onClick={handleImport}
              disabled={importing || saving || !text.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              {importing || saving ? 'Importing & Saving...' : 'Import & Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

