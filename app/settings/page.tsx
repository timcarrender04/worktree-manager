'use client';

import { useState, useEffect } from 'react';
import { EnvVarTable } from '../components/Settings/EnvVarTable';
import { BulkImport } from '../components/Settings/BulkImport';
import { ServiceToggle } from '../components/Settings/ServiceToggle';

interface EnvVar {
  key: string;
  value: string;
}

// Service configurations
const SUPABASE_CONFIGS = [
  { key: 'NEXT_PUBLIC_SUPABASE_URL', label: 'Supabase URL', placeholder: 'https://xxxxx.supabase.co', type: 'text' as const },
  { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', label: 'Supabase Anon Key', placeholder: 'your-anon-key', type: 'password' as const },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Service Role Key', placeholder: 'your-service-role-key', type: 'password' as const },
];

const AWS_CONFIGS = [
  { key: 'AWS_ACCESS_KEY_ID', label: 'Access Key ID', placeholder: 'your-access-key-id', type: 'text' as const },
  { key: 'AWS_SECRET_ACCESS_KEY', label: 'Secret Access Key', placeholder: 'your-secret-key', type: 'password' as const },
  { key: 'AWS_REGION', label: 'Region', placeholder: 'us-east-1', type: 'text' as const },
  { key: 'AWS_S3_BUCKET', label: 'S3 Bucket (optional)', placeholder: 'your-bucket-name', type: 'text' as const },
];

const NEON_CONFIGS = [
  { key: 'DATABASE_URL', label: 'Database URL', placeholder: 'postgresql://user:pass@host/db', type: 'password' as const },
  { key: 'PGHOST', label: 'Host', placeholder: 'ep-xxxxx.us-east-1.aws.neon.tech', type: 'text' as const },
  { key: 'PGDATABASE', label: 'Database', placeholder: 'neondb', type: 'text' as const },
  { key: 'PGUSER', label: 'User', placeholder: 'neondb_owner', type: 'text' as const },
  { key: 'PGPASSWORD', label: 'Password', placeholder: 'your-password', type: 'password' as const },
];

export default function SettingsPage() {
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'services'>('general');

  // Service toggles state
  const [supabaseEnabled, setSupabaseEnabled] = useState(false);
  const [awsEnabled, setAwsEnabled] = useState(false);
  const [neonEnabled, setNeonEnabled] = useState(false);

  // Load environment variables on mount
  useEffect(() => {
    loadEnvVars();
  }, []);

  // Check which services are enabled based on existing env vars
  useEffect(() => {
    const keys = new Set(envVars.map(v => v.key));
    setSupabaseEnabled(
      keys.has('NEXT_PUBLIC_SUPABASE_URL') ||
      keys.has('NEXT_PUBLIC_SUPABASE_ANON_KEY') ||
      keys.has('SUPABASE_SERVICE_ROLE_KEY')
    );
    setAwsEnabled(
      keys.has('AWS_ACCESS_KEY_ID') ||
      keys.has('AWS_SECRET_ACCESS_KEY') ||
      keys.has('AWS_REGION')
    );
    setNeonEnabled(
      keys.has('DATABASE_URL') ||
      keys.has('PGHOST') ||
      keys.has('PGDATABASE') ||
      keys.has('PGUSER') ||
      keys.has('PGPASSWORD')
    );
  }, [envVars]);

  const loadEnvVars = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/settings/env');
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load environment variables');
      }
      
      setEnvVars(data.envVars || []);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to load environment variables' });
    } finally {
      setLoading(false);
    }
  };

  const saveEnvVars = async (varsToSave: EnvVar[]) => {
    try {
      setSaving(true);
      setMessage(null);
      
      const response = await fetch('/api/settings/env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envVars: varsToSave }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save environment variables');
      }
      
      setMessage({ type: 'success', text: 'Environment variables saved successfully! Restart the application to apply changes.' });
      setEnvVars(varsToSave);
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to save environment variables' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = (index: number, key: string, value: string) => {
    const updated = [...envVars];
    updated[index] = { key, value };
    setEnvVars(updated);
  };

  const handleDelete = (index: number) => {
    const updated = envVars.filter((_, i) => i !== index);
    setEnvVars(updated);
  };

  const handleAdd = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleBulkImport = (importedVars: EnvVar[]) => {
    // Merge with existing, preferring imported values for duplicates
    const existingMap = new Map(envVars.map(v => [v.key, v.value]));
    importedVars.forEach(v => existingMap.set(v.key, v.value));
    
    const merged = Array.from(existingMap.entries()).map(([key, value]) => ({ key, value }));
    setEnvVars(merged);
    setMessage({ type: 'success', text: `Imported ${importedVars.length} environment variable(s)` });
  };

  const handleServiceToggle = (service: 'supabase' | 'aws' | 'neon', enabled: boolean) => {
    if (service === 'supabase') {
      setSupabaseEnabled(enabled);
      if (enabled) {
        // Add service configs if they don't exist
        const keys = new Set(envVars.map(v => v.key));
        const toAdd: EnvVar[] = [];
        SUPABASE_CONFIGS.forEach(config => {
          if (!keys.has(config.key)) {
            toAdd.push({ key: config.key, value: '' });
          }
        });
        if (toAdd.length > 0) {
          setEnvVars([...envVars, ...toAdd]);
        }
      } else {
        // Remove service configs
        setEnvVars(envVars.filter(v => !SUPABASE_CONFIGS.some(c => c.key === v.key)));
      }
    } else if (service === 'aws') {
      setAwsEnabled(enabled);
      if (enabled) {
        const keys = new Set(envVars.map(v => v.key));
        const toAdd: EnvVar[] = [];
        AWS_CONFIGS.forEach(config => {
          if (!keys.has(config.key)) {
            toAdd.push({ key: config.key, value: '' });
          }
        });
        if (toAdd.length > 0) {
          setEnvVars([...envVars, ...toAdd]);
        }
      } else {
        setEnvVars(envVars.filter(v => !AWS_CONFIGS.some(c => c.key === v.key)));
      }
    } else if (service === 'neon') {
      setNeonEnabled(enabled);
      if (enabled) {
        const keys = new Set(envVars.map(v => v.key));
        const toAdd: EnvVar[] = [];
        NEON_CONFIGS.forEach(config => {
          if (!keys.has(config.key)) {
            toAdd.push({ key: config.key, value: '' });
          }
        });
        if (toAdd.length > 0) {
          setEnvVars([...envVars, ...toAdd]);
        }
      } else {
        setEnvVars(envVars.filter(v => !NEON_CONFIGS.some(c => c.key === v.key)));
      }
    }
  };

  const handleServiceConfigChange = (key: string, value: string) => {
    const index = envVars.findIndex(v => v.key === key);
    if (index >= 0) {
      handleUpdate(index, key, value);
    } else {
      // Add new if not found
      setEnvVars([...envVars, { key, value }]);
    }
  };

  const getServiceValues = (configs: typeof SUPABASE_CONFIGS): Record<string, string> => {
    const values: Record<string, string> = {};
    configs.forEach(config => {
      const envVar = envVars.find(v => v.key === config.key);
      values[config.key] = envVar?.value || '';
    });
    return values;
  };

  const handleSave = () => {
    // Filter out empty keys
    const validVars = envVars.filter(v => v.key.trim() !== '');
    saveEnvVars(validVars);
  };

  const handleExport = () => {
    const content = envVars
      .filter(v => v.key.trim() !== '')
      .map(v => `${v.key}=${v.value}`)
      .join('\n');
    
    navigator.clipboard.writeText(content);
    setMessage({ type: 'success', text: 'Environment variables copied to clipboard!' });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <h1 className="text-4xl font-bold mb-8 text-gray-900">Settings</h1>

        {message && (
          <div className={`mb-6 p-4 rounded ${
            message.type === 'success' 
              ? 'bg-green-100 text-green-800 border border-green-300' 
              : 'bg-red-100 text-red-800 border border-red-300'
          }`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('general')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'general'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              General
            </button>
            <button
              onClick={() => setActiveTab('services')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'services'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Service Configs
            </button>
          </nav>
        </div>

        {/* General Tab */}
        {activeTab === 'general' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-semibold mb-4 text-gray-800">Environment Variables</h2>
              
              <EnvVarTable
                envVars={envVars}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onAdd={handleAdd}
              />

              <div className="mt-6 flex space-x-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={handleExport}
                  className="px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
                >
                  Export to Clipboard
                </button>
                <button
                  onClick={loadEnvVars}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Reload
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-semibold mb-4 text-gray-800">Bulk Import</h2>
              <BulkImport onImport={handleBulkImport} />
            </div>
          </div>
        )}

        {/* Services Tab */}
        {activeTab === 'services' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-semibold mb-6 text-gray-800">Service Configuration</h2>
              
              <div className="space-y-4">
                <ServiceToggle
                  serviceName="supabase"
                  serviceLabel="Supabase"
                  configs={SUPABASE_CONFIGS}
                  enabled={supabaseEnabled}
                  onToggle={(enabled) => handleServiceToggle('supabase', enabled)}
                  onConfigChange={handleServiceConfigChange}
                  currentValues={getServiceValues(SUPABASE_CONFIGS)}
                />

                <ServiceToggle
                  serviceName="aws"
                  serviceLabel="AWS"
                  configs={AWS_CONFIGS}
                  enabled={awsEnabled}
                  onToggle={(enabled) => handleServiceToggle('aws', enabled)}
                  onConfigChange={handleServiceConfigChange}
                  currentValues={getServiceValues(AWS_CONFIGS)}
                />

                <ServiceToggle
                  serviceName="neon"
                  serviceLabel="Neon"
                  configs={NEON_CONFIGS}
                  enabled={neonEnabled}
                  onToggle={(enabled) => handleServiceToggle('neon', enabled)}
                  onConfigChange={handleServiceConfigChange}
                  currentValues={getServiceValues(NEON_CONFIGS)}
                />
              </div>

              <div className="mt-6 flex space-x-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={loadEnvVars}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors"
                >
                  Reload
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

