'use client';

import { useState, useEffect } from 'react';

interface AWSCredential {
  id: string;
  profile_name: string;
  region: string;
  default_profile: boolean;
  created_at: string;
  updated_at: string;
}

interface AWSCredentialsManagerProps {
  onUpdate?: () => void;
}

export function AWSCredentialsManager({ onUpdate }: AWSCredentialsManagerProps) {
  const [credentials, setCredentials] = useState<AWSCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    profile_name: '',
    access_key_id: '',
    secret_access_key: '',
    region: 'us-east-1',
    default_profile: false,
  });

  useEffect(() => {
    fetchCredentials();
  }, []);

  const fetchCredentials = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/aws-credentials');
      if (!response.ok) {
        throw new Error('Failed to fetch AWS credentials');
      }
      const data = await response.json();
      setCredentials(data.credentials || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load AWS credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError(null);
      const url = editingId
        ? `/api/aws-credentials/${editingId}`
        : '/api/aws-credentials';
      const method = editingId ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save credential');
      }

      // Reset form
      setFormData({
        profile_name: '',
        access_key_id: '',
        secret_access_key: '',
        region: 'us-east-1',
        default_profile: false,
      });
      setShowAddForm(false);
      setEditingId(null);
      await fetchCredentials();
      onUpdate?.();
    } catch (err: any) {
      setError(err.message || 'Failed to save credential');
    }
  };

  const handleEdit = (credential: AWSCredential) => {
    setFormData({
      profile_name: credential.profile_name,
      access_key_id: '', // Don't show actual key for security
      secret_access_key: '', // Don't show actual secret for security
      region: credential.region,
      default_profile: credential.default_profile,
    });
    setEditingId(credential.id);
    setShowAddForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this AWS credential profile?')) {
      return;
    }

    try {
      setError(null);
      const response = await fetch(`/api/aws-credentials/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete credential');
      }

      await fetchCredentials();
      onUpdate?.();
    } catch (err: any) {
      setError(err.message || 'Failed to delete credential');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      setError(null);
      const response = await fetch(`/api/aws-credentials/${id}/default`, {
        method: 'PATCH',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to set default profile');
      }

      await fetchCredentials();
      onUpdate?.();
    } catch (err: any) {
      setError(err.message || 'Failed to set default profile');
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-600">Loading AWS credentials...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">AWS Credentials</h3>
          <p className="text-sm text-gray-600 mt-1">
            Manage your AWS credential profiles. These are stored securely in Supabase.
          </p>
        </div>
        <button
          onClick={() => {
            setShowAddForm(true);
            setEditingId(null);
            setFormData({
              profile_name: '',
              access_key_id: '',
              secret_access_key: '',
              region: 'us-east-1',
              default_profile: false,
            });
          }}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm"
        >
          + Add Profile
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {showAddForm && (
        <div className="bg-gray-50 border border-gray-300 rounded-lg p-4">
          <h4 className="text-md font-semibold text-gray-800 mb-3">
            {editingId ? 'Edit AWS Credential' : 'Add AWS Credential'}
          </h4>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Profile Name *
              </label>
              <input
                type="text"
                required
                value={formData.profile_name}
                onChange={(e) => setFormData({ ...formData, profile_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="default, production, staging"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Access Key ID *
              </label>
              <input
                type="text"
                required
                value={formData.access_key_id}
                onChange={(e) => setFormData({ ...formData, access_key_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                placeholder="AKIA..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Secret Access Key *
              </label>
              <input
                type="password"
                required
                value={formData.secret_access_key}
                onChange={(e) => setFormData({ ...formData, secret_access_key: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm font-mono"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Region
              </label>
              <input
                type="text"
                value={formData.region}
                onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                placeholder="us-east-1"
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="default_profile"
                checked={formData.default_profile}
                onChange={(e) => setFormData({ ...formData, default_profile: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="default_profile" className="ml-2 block text-sm text-gray-700">
                Set as default profile
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
              >
                {editingId ? 'Update' : 'Add'} Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingId(null);
                  setFormData({
                    profile_name: '',
                    access_key_id: '',
                    secret_access_key: '',
                    region: 'us-east-1',
                    default_profile: false,
                  });
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {credentials.length === 0 && !showAddForm ? (
        <p className="text-sm text-gray-600">
          No AWS credentials configured. Click "Add Profile" to get started.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 border border-gray-300 rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Profile Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Region
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Default
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {credentials.map((credential) => (
                <tr key={credential.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {credential.profile_name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                    {credential.region}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    {credential.default_profile ? (
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                        Default
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSetDefault(credential.id)}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Set as default
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEdit(credential)}
                        className="text-blue-600 hover:text-blue-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(credential.id)}
                        className="text-red-600 hover:text-red-900"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

