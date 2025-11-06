'use client';

import { useState, useEffect } from 'react';

interface User {
  id: string;
  email: string | null;
  isSuperAdmin: boolean;
}

interface UserProfileSettingsProps {
  user: User | null;
}

export function UserProfileSettings({ user }: UserProfileSettingsProps) {
  const [profile, setProfile] = useState({
    email: user?.email || '',
    displayName: '',
    theme: 'system',
    notifications: true,
    emailNotifications: false,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    // Load user preferences from localStorage
    const savedDisplayName = localStorage.getItem('user_display_name') || '';
    const savedTheme = localStorage.getItem('user_theme') || 'system';
    const savedNotifications = localStorage.getItem('user_notifications') !== 'false';
    const savedEmailNotifications = localStorage.getItem('user_email_notifications') === 'true';

    setProfile({
      email: user?.email || '',
      displayName: savedDisplayName,
      theme: savedTheme as 'system' | 'light' | 'dark',
      notifications: savedNotifications,
      emailNotifications: savedEmailNotifications,
    });
  }, [user]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setMessage(null);

      // Save to localStorage (in a real app, this would be saved to the backend)
      localStorage.setItem('user_display_name', profile.displayName);
      localStorage.setItem('user_theme', profile.theme);
      localStorage.setItem('user_notifications', String(profile.notifications));
      localStorage.setItem('user_email_notifications', String(profile.emailNotifications));

      // Apply theme if changed
      if (profile.theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else if (profile.theme === 'light') {
        document.documentElement.classList.remove('dark');
      } else {
        // System theme - check system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }

      setMessage({ type: 'success', text: 'Profile settings saved successfully!' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to save profile settings' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-semibold mb-6 text-gray-800">Profile Settings</h2>

        {message && (
          <div className={`mb-6 p-4 rounded ${
            message.type === 'success' 
              ? 'bg-green-100 text-green-800 border border-green-300' 
              : 'bg-red-100 text-red-800 border border-red-300'
          }`}>
            {message.text}
          </div>
        )}

        <div className="space-y-4">
          {/* Email (Read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <input
              type="email"
              value={profile.email}
              disabled
              className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-50 text-gray-500 cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-gray-500">Email address cannot be changed</p>
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Display Name
            </label>
            <input
              type="text"
              value={profile.displayName}
              onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
              placeholder="Enter your display name"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="mt-1 text-xs text-gray-500">This name will be displayed in your projects</p>
          </div>

          {/* Theme Preference */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Theme
            </label>
            <select
              value={profile.theme}
              onChange={(e) => setProfile({ ...profile, theme: e.target.value as 'system' | 'light' | 'dark' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="system">System Default</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">Choose your preferred color theme</p>
          </div>

          {/* Notifications */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Desktop Notifications
                </label>
                <p className="text-xs text-gray-500">Receive notifications for project updates</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.notifications}
                  onChange={(e) => setProfile({ ...profile, notifications: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Email Notifications
                </label>
                <p className="text-xs text-gray-500">Receive email updates about your projects</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={profile.emailNotifications}
                  onChange={(e) => setProfile({ ...profile, emailNotifications: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : 'Save Profile Settings'}
          </button>
        </div>
      </div>

      {/* GitHub Accounts Section */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-semibold mb-4 text-gray-800">GitHub Accounts</h2>
        <p className="text-sm text-gray-600 mb-4">
          Manage your connected GitHub accounts for repository access.
        </p>
        <button
          className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
          onClick={() => {
            // Navigate to GitHub accounts management (to be implemented)
            alert('GitHub accounts management coming soon!');
          }}
        >
          Manage GitHub Accounts
        </button>
      </div>
    </div>
  );
}


