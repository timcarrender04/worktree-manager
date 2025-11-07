'use client';

import { useState, useEffect } from 'react';

interface GitHubAccount {
  id: string;
  account_name: string;
  github_username: string | null;
  created_at: string;
  from_tokens_table?: boolean;
  is_invalid?: boolean;
}

export function GitHubAccountsManager() {
  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/github-accounts');
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to fetch GitHub accounts');
      }
      const data = await response.json();
      setAccounts(data.accounts || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading GitHub accounts...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-gray-800">GitHub Accounts</h2>
        <p className="text-sm text-gray-600 mt-1">
          GitHub accounts are managed in Project Tim. Make updates in Project Tim (Settings → GitHub Tokens & Accounts),
          then refresh this page to sync.
        </p>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Error:</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-6">
          <p className="text-gray-700 mb-2">
            No GitHub accounts are available yet. Add an account in Project Tim to get started.
          </p>
          <p className="text-sm text-gray-600">
            Once an account has been connected in Project Tim, it will appear here automatically.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-md shadow-sm">
          {accounts.map((account) => (
            <li key={account.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg font-medium text-gray-900">{account.account_name}</span>
                    {account.from_tokens_table && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        From Tokens
                      </span>
                    )}
                    {account.is_invalid && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        Invalid Token
                      </span>
                    )}
                  </div>
                  {account.github_username && !account.is_invalid && (
                    <p className="text-sm text-gray-500">GitHub: @{account.github_username}</p>
                  )}
                  <p className="text-xs text-gray-400">
                    Added: {new Date(account.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-md p-4 text-sm text-blue-800">
        Tip: If accounts were just updated in Project Tim, refresh your browser to pull the latest list.
      </div>
    </div>
  );
}

