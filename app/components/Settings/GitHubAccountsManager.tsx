'use client';

import { useState, useEffect } from 'react';
import { PlusIcon, TrashIcon, PencilIcon, StarIcon } from '@heroicons/react/20/solid';
import { Dialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';

interface GitHubAccount {
  id: string;
  account_name: string;
  github_username: string | null;
  created_at: string;
  from_env?: boolean; // Flag for env-based accounts
}

export function GitHubAccountsManager() {
  const [accounts, setAccounts] = useState<GitHubAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<GitHubAccount | null>(null);
  const [formState, setFormState] = useState({
    account_name: '',
    token: '',
  });

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormState((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const response = await fetch('/api/github-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_name: formState.account_name,
          token: formState.token,
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to save GitHub account');
      }

      await fetchAccounts();
      closeModal();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this GitHub account?')) return;
    
    // Don't allow deleting env-based accounts
    const account = accounts.find((acc) => acc.id === id);
    if (account?.from_env) {
      setError('Cannot delete the default account from environment variables. Remove GITHUB_TOKEN from your environment instead.');
      return;
    }

    setError(null);
    try {
      const response = await fetch('/api/github-accounts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to delete GitHub account');
      }

      await fetchAccounts();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openCreateModal = () => {
    setEditingAccount(null);
    setFormState({
      account_name: '',
      token: '',
    });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingAccount(null);
    setError(null);
    setFormState({
      account_name: '',
      token: '',
    });
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-600">Loading GitHub accounts...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800">GitHub Accounts</h2>
          <p className="text-sm text-gray-600 mt-1">
            Manage your GitHub accounts for repository access. Each account uses a Personal Access Token.
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <PlusIcon className="-ml-1 mr-2 h-5 w-5" aria-hidden="true" />
          Add New Account
        </button>
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
            No GitHub accounts configured. Add an account to start managing repositories.
          </p>
          <p className="text-sm text-gray-600">
            You can also set <code className="bg-yellow-100 px-1 rounded">GITHUB_TOKEN</code> in your environment variables for a default account.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-200 border border-gray-200 rounded-md shadow-sm">
          {accounts.map((account) => (
            <li key={account.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <span className="text-lg font-medium text-gray-900">{account.account_name}</span>
                  {account.from_env && (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      From Environment
                    </span>
                  )}
                </div>
                {account.github_username && (
                  <p className="text-sm text-gray-500">GitHub: @{account.github_username}</p>
                )}
                <p className="text-xs text-gray-400">
                  Added: {new Date(account.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center space-x-3">
                {!account.from_env && (
                  <button
                    onClick={() => handleDelete(account.id)}
                    className="text-red-600 hover:text-red-900"
                    title="Delete"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Modal for Add Account */}
      <Transition appear show={isModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={closeModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900"
                  >
                    Add GitHub Account
                  </Dialog.Title>
                  <div className="mt-4">
                    <form onSubmit={handleSave} className="space-y-4">
                      <div>
                        <label htmlFor="account_name" className="block text-sm font-medium text-gray-700">
                          Account Name
                        </label>
                        <input
                          type="text"
                          name="account_name"
                          id="account_name"
                          value={formState.account_name}
                          onChange={handleInputChange}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                          placeholder="e.g., Personal, Work, Organization"
                          required
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          A friendly name to identify this GitHub account
                        </p>
                      </div>
                      <div>
                        <label htmlFor="token" className="block text-sm font-medium text-gray-700">
                          GitHub Personal Access Token
                        </label>
                        <input
                          type="password"
                          name="token"
                          id="token"
                          value={formState.token}
                          onChange={handleInputChange}
                          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                          placeholder="ghp_..."
                          required
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          Create a token at{' '}
                          <a
                            href="https://github.com/settings/tokens"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            github.com/settings/tokens
                          </a>
                          . Required scopes: <code className="bg-gray-100 px-1 rounded">repo</code>
                        </p>
                      </div>
                      {error && (
                        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative text-sm" role="alert">
                          {error}
                        </div>
                      )}
                      <div className="mt-4 flex justify-end space-x-3">
                        <button
                          type="button"
                          className="inline-flex justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                          onClick={closeModal}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        >
                          Add Account
                        </button>
                      </div>
                    </form>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}

