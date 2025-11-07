'use client';

import { useState, useEffect, useRef } from 'react';

interface EnvVar {
  key: string;
  value: string;
}

interface OsSettingsProps {
  envVars: EnvVar[];
  onUpdate: (index: number, key: string, value: string) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
  onSave: () => void;
  saving: boolean;
}

type Platform = 'linux' | 'windows' | 'mac' | 'unknown';

const DEFAULT_LINUX_REPO_ROOT = process.env.NEXT_PUBLIC_LINUX_REPO_ROOT ?? process.env.NEXT_PUBLIC_DEFAULT_REPO_ROOT ?? '/home/ert/projects/backend/repo-hub/repos';
const DEFAULT_LINUX_HOST_REPO_ROOT = process.env.NEXT_PUBLIC_LINUX_HOST_REPO_ROOT ?? process.env.NEXT_PUBLIC_DEFAULT_HOST_REPO_ROOT ?? DEFAULT_LINUX_REPO_ROOT;
const DEFAULT_LINUX_WORKTREE_ROOT = process.env.NEXT_PUBLIC_LINUX_WORKTREE_ROOT ?? process.env.NEXT_PUBLIC_DEFAULT_WORKTREE_ROOT ?? `${DEFAULT_LINUX_REPO_ROOT}/Tree`;

const DEFAULT_WINDOWS_REPO_ROOT = process.env.NEXT_PUBLIC_WINDOWS_REPO_ROOT ?? 'C:\\repos';
const DEFAULT_WINDOWS_HOST_REPO_ROOT = process.env.NEXT_PUBLIC_WINDOWS_HOST_REPO_ROOT ?? DEFAULT_WINDOWS_REPO_ROOT;
const DEFAULT_WINDOWS_WORKTREE_ROOT = process.env.NEXT_PUBLIC_WINDOWS_WORKTREE_ROOT ?? `${DEFAULT_WINDOWS_REPO_ROOT}\\Tree`;

const DEFAULT_MAC_REPO_ROOT = process.env.NEXT_PUBLIC_MAC_REPO_ROOT ?? process.env.NEXT_PUBLIC_DEFAULT_MAC_REPO_ROOT ?? DEFAULT_LINUX_REPO_ROOT.replace('/home/', '/Users/');
const DEFAULT_MAC_HOST_REPO_ROOT = process.env.NEXT_PUBLIC_MAC_HOST_REPO_ROOT ?? DEFAULT_MAC_REPO_ROOT;
const DEFAULT_MAC_WORKTREE_ROOT = process.env.NEXT_PUBLIC_MAC_WORKTREE_ROOT ?? `${DEFAULT_MAC_REPO_ROOT}/Tree`;

// OS-specific default paths
const OS_DEFAULT_PATHS: Record<Platform, { REPO_ROOT: string; HOST_REPO_ROOT: string; WORKTREE_ROOT: string }> = {
  linux: {
    REPO_ROOT: DEFAULT_LINUX_REPO_ROOT,
    HOST_REPO_ROOT: DEFAULT_LINUX_HOST_REPO_ROOT,
    WORKTREE_ROOT: DEFAULT_LINUX_WORKTREE_ROOT,
  },
  windows: {
    REPO_ROOT: DEFAULT_WINDOWS_REPO_ROOT,
    HOST_REPO_ROOT: DEFAULT_WINDOWS_HOST_REPO_ROOT,
    WORKTREE_ROOT: DEFAULT_WINDOWS_WORKTREE_ROOT,
  },
  mac: {
    REPO_ROOT: DEFAULT_MAC_REPO_ROOT,
    HOST_REPO_ROOT: DEFAULT_MAC_HOST_REPO_ROOT,
    WORKTREE_ROOT: DEFAULT_MAC_WORKTREE_ROOT,
  },
  unknown: {
    REPO_ROOT: DEFAULT_LINUX_REPO_ROOT,
    HOST_REPO_ROOT: DEFAULT_LINUX_HOST_REPO_ROOT,
    WORKTREE_ROOT: DEFAULT_LINUX_WORKTREE_ROOT,
  },
};

// OS-specific environment variable keys
const OS_ENV_KEYS = ['REPO_ROOT', 'HOST_REPO_ROOT', 'WORKTREE_ROOT'];

// Detect platform from user agent
function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'unknown';
  
  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();
  
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }
  if (platform.includes('mac') || userAgent.includes('macintosh') || userAgent.includes('mac os')) {
    return 'mac';
  }
  if (platform.includes('linux') || userAgent.includes('linux') || userAgent.includes('x11')) {
    return 'linux';
  }
  
  return 'unknown';
}

// Get platform icon
function getPlatformIcon(platform: Platform): string {
  switch (platform) {
    case 'linux':
      return '🐧';
    case 'windows':
      return '🪟';
    case 'mac':
      return '🍎';
    default:
      return '💻';
  }
}

// Get platform name
function getPlatformName(platform: Platform): string {
  switch (platform) {
    case 'linux':
      return 'Linux';
    case 'windows':
      return 'Windows';
    case 'mac':
      return 'macOS';
    default:
      return 'Unknown Platform';
  }
}

export function OsSettings({
  envVars,
  onUpdate,
  onDelete,
  onAdd,
  onSave,
  saving,
}: OsSettingsProps) {
  const [platform, setPlatform] = useState<Platform>('unknown');
  const [osSpecificVars, setOsSpecificVars] = useState<EnvVar[]>([]);
  const [customOsVars, setCustomOsVars] = useState<EnvVar[]>([]);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newCustomKey, setNewCustomKey] = useState('');
  const [newCustomValue, setNewCustomValue] = useState('');
  const pendingAddRef = useRef<{ key: string; value: string } | null>(null);

  useEffect(() => {
    // Detect platform on mount
    const detectedPlatform = detectPlatform();
    setPlatform(detectedPlatform);
  }, []);

  useEffect(() => {
    // Separate OS-specific env vars from custom OS vars
    const osVars: EnvVar[] = [];
    const customVars: EnvVar[] = [];
    
    envVars.forEach((envVar) => {
      if (OS_ENV_KEYS.includes(envVar.key)) {
        osVars.push(envVar);
      } else if (envVar.key.startsWith('OS_') || envVar.key.includes('_PATH')) {
        // Consider path-related vars as potentially OS-specific
        customVars.push(envVar);
      }
    });
    
    setOsSpecificVars(osVars);
    setCustomOsVars(customVars);
    
    // Handle pending additions
    if (pendingAddRef.current) {
      const { key, value } = pendingAddRef.current;
      // Find the first empty env var (newly added) or the last one
      const emptyIndex = envVars.findIndex(v => v.key === '' && v.value === '');
      if (emptyIndex >= 0) {
        onUpdate(emptyIndex, key, value);
        pendingAddRef.current = null;
      } else if (envVars.length > 0) {
        // Try the last one (might be the one we just added)
        const lastIndex = envVars.length - 1;
        if (envVars[lastIndex].key === '' || envVars[lastIndex].value === '') {
          onUpdate(lastIndex, key, value);
          pendingAddRef.current = null;
        }
      }
    }
  }, [envVars, onUpdate]);

  // Get current value for an OS env key
  const getOsEnvValue = (key: string): string => {
    const envVar = envVars.find((v) => v.key === key);
    if (envVar) return envVar.value;
    
    // Return default based on platform
    const defaults = OS_DEFAULT_PATHS[platform];
    return defaults[key as keyof typeof defaults] || '';
  };

  // Handle OS env var update
  const handleOsEnvUpdate = (key: string, value: string) => {
    const index = envVars.findIndex((v) => v.key === key);
    if (index >= 0) {
      onUpdate(index, key, value);
    } else {
      // Add new if not found - store pending addition and trigger add
      pendingAddRef.current = { key, value };
      onAdd();
    }
  };

  // Handle adding custom OS env var
  const handleAddCustomVar = () => {
    if (!newCustomKey.trim()) return;
    
    const key = `OS_${platform.toUpperCase()}_${newCustomKey.trim().toUpperCase()}`;
    const index = envVars.findIndex((v) => v.key === key);
    
    if (index >= 0) {
      // Update existing
      onUpdate(index, key, newCustomValue);
    } else {
      // Add new - store pending addition and trigger add
      pendingAddRef.current = { key, value: newCustomValue };
      onAdd();
    }
    
    setNewCustomKey('');
    setNewCustomValue('');
    setShowAddCustom(false);
  };

  // Get default value for a key
  const getDefaultValue = (key: string): string => {
    const defaults = OS_DEFAULT_PATHS[platform];
    return defaults[key as keyof typeof defaults] || '';
  };

  // Apply defaults for OS-specific paths
  const applyDefaults = () => {
    const defaults = OS_DEFAULT_PATHS[platform];
    OS_ENV_KEYS.forEach((key) => {
      const currentValue = getOsEnvValue(key);
      if (!currentValue && defaults[key as keyof typeof defaults]) {
        handleOsEnvUpdate(key, defaults[key as keyof typeof defaults]);
      }
    });
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <span className="text-3xl">{getPlatformIcon(platform)}</span>
            <div>
              <h2 className="text-2xl font-semibold text-gray-800">Operating System Settings</h2>
              <p className="text-sm text-gray-600">
                Detected Platform: <span className="font-medium">{getPlatformName(platform)}</span>
              </p>
            </div>
          </div>
          <button
            onClick={applyDefaults}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors text-sm"
          >
            Apply Defaults
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Configure paths and environment variables specific to your operating system. These settings control where
          repositories and worktrees are stored on your system.
        </p>
      </div>

      {/* OS-Specific Path Settings */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Tree Folder & Path Configuration</h3>
        <div className="space-y-4">
          {OS_ENV_KEYS.map((key) => {
            const currentValue = getOsEnvValue(key);
            const defaultValue = getDefaultValue(key);
            const index = envVars.findIndex((v) => v.key === key);
            
            return (
              <div key={key} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {key}
                  {defaultValue && (
                    <span className="ml-2 text-xs text-gray-500">
                      (Default: {defaultValue})
                    </span>
                  )}
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={currentValue}
                    onChange={(e) => handleOsEnvUpdate(key, e.target.value)}
                    placeholder={defaultValue || `Enter ${key} path`}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                  />
                  {index >= 0 && (
                    <button
                      onClick={() => onDelete(index)}
                      className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {key === 'REPO_ROOT' && 'Root directory where all repositories are stored'}
                  {key === 'HOST_REPO_ROOT' && 'Host machine path (for Docker volume mounting)'}
                  {key === 'WORKTREE_ROOT' && 'Directory where git worktrees are organized (Tree folder)'}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom OS-Specific Environment Variables */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            Custom OS-Specific Environment Variables
          </h3>
          <button
            onClick={() => setShowAddCustom(!showAddCustom)}
            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm"
          >
            {showAddCustom ? 'Cancel' : '+ Add Custom Variable'}
          </button>
        </div>

        {showAddCustom && (
          <div className="mb-4 p-4 border border-gray-300 rounded-lg bg-gray-50">
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Variable Name (without OS prefix)
                </label>
                <input
                  type="text"
                  value={newCustomKey}
                  onChange={(e) => setNewCustomKey(e.target.value)}
                  placeholder="e.g., CUSTOM_PATH"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Will be prefixed as: <code className="bg-gray-200 px-1 rounded">OS_{platform.toUpperCase()}_YOUR_KEY</code>
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Value</label>
                <input
                  type="text"
                  value={newCustomValue}
                  onChange={(e) => setNewCustomValue(e.target.value)}
                  placeholder="Enter value"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                />
              </div>
              <button
                onClick={handleAddCustomVar}
                disabled={!newCustomKey.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm"
              >
                Add Variable
              </button>
            </div>
          </div>
        )}

        {customOsVars.length > 0 ? (
          <div className="space-y-2">
            {customOsVars.map((envVar, idx) => {
              const actualIndex = envVars.findIndex((v) => v.key === envVar.key);
              return (
                <div key={idx} className="flex items-center space-x-2 p-3 border border-gray-200 rounded-lg bg-gray-50">
                  <div className="flex-1">
                    <div className="text-sm font-mono font-medium text-gray-800">{envVar.key}</div>
                    <input
                      type="text"
                      value={envVar.value}
                      onChange={(e) => onUpdate(actualIndex, envVar.key, e.target.value)}
                      className="w-full mt-1 px-2 py-1 border border-gray-300 rounded text-xs font-mono"
                      placeholder="Enter value"
                    />
                  </div>
                  <button
                    onClick={() => onDelete(actualIndex)}
                    className="px-3 py-1 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-xs"
                  >
                    Delete
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500 italic">
            No custom OS-specific environment variables. Click "Add Custom Variable" to add one.
          </p>
        )}
      </div>

      {/* Platform-Specific Notes */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="text-sm font-semibold text-blue-900 mb-2">Platform-Specific Notes</h4>
        <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
          {platform === 'linux' && (
            <>
              <li>Linux paths use forward slashes (/)</li>
              <li>Default paths assume user home directory structure</li>
              <li>Ensure directories have proper permissions for git operations</li>
            </>
          )}
          {platform === 'windows' && (
            <>
              <li>Windows paths can use backslashes (\\) or forward slashes (/)</li>
              <li>Use forward slashes for better compatibility with Docker</li>
              <li>Consider using UNC paths for network locations</li>
            </>
          )}
          {platform === 'mac' && (
            <>
              <li>macOS paths use forward slashes (/)</li>
              <li>Default paths assume user home directory structure</li>
              <li>Ensure proper permissions for git operations</li>
            </>
          )}
          <li>After changing paths, restart the application for changes to take effect</li>
        </ul>
      </div>

      {/* Save Button */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save OS Settings'}
        </button>
      </div>
    </div>
  );
}

