'use client';

import React from 'react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { RoadmapView } from '@/components/roadmap/RoadmapView';
import { InsightsView } from '@/components/insights/InsightsView';
import { TeamItemsTab } from '@/components/projects/TeamItemsTab';
import { MyItemsTab } from '@/components/projects/MyItemsTab';

interface Project {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  github_account_id: string | null;
  github_account: { id: string; account_name: string; github_username: string | null } | null;
  members: Array<{
    id: string;
    user_id: string;
    role: string;
    email: string | null;
    created_at: string;
  }>;
  repositories: Array<{
    id: string;
    repository_full_name: string;
    github_account_id: string;
    github_account: { id: string; account_name: string; github_username: string | null };
    created_at: string;
  }>;
  created_at: string;
  updated_at: string;
}

type Tab = 'backlog' | 'roadmap' | 'insights' | 'team-items' | 'my-items' | 'repositories' | 'members' | 'overview';

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params);
  return <ProjectDetailContent projectId={id} />;
}

function ProjectDetailContent({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('backlog');

  useEffect(() => {
    fetchProjectDetails();
  }, [projectId]);

  const fetchProjectDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/projects/${projectId}`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch project details (${response.status})`);
      }
      const data = await response.json();
      if (!data.project) {
        throw new Error('Project data not found in response');
      }
      setProject(data.project);
      // Set boardId directly to projectId since the component uses it as identifier
      setBoardId(projectId);
    } catch (error: any) {
      setError(error.message || 'Failed to load project details');
      setProject(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading project details...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="max-w-2xl mx-auto px-4">
          <div className="text-xl text-red-600 mb-4">
            {error || 'Project not found or access denied.'}
          </div>
          <Link href="/projects" className="text-blue-600 hover:text-blue-800 underline">
            ← Back to Projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4">
        <div className="mb-6">
          <Link href="/projects" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
            ← Back to Projects
          </Link>
          <h1 className="text-4xl font-bold text-gray-900">{project.name}</h1>
          {project.description && (
            <p className="mt-2 text-sm text-gray-600">{project.description}</p>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4">
            <div className="text-sm text-red-800">{error}</div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-md">
          <div className="border-b border-gray-200">
            <nav className="flex -mb-px overflow-x-auto">
              <button
                onClick={() => setActiveTab('backlog')}
                className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                  activeTab === 'backlog'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Backlog
              </button>
              <button
                onClick={() => setActiveTab('roadmap')}
                className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                  activeTab === 'roadmap'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Roadmap
              </button>
              <button
                onClick={() => setActiveTab('insights')}
                className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                  activeTab === 'insights'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Insights
              </button>
              <button
                onClick={() => setActiveTab('team-items')}
                className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                  activeTab === 'team-items'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Team Items
              </button>
              <button
                onClick={() => setActiveTab('my-items')}
                className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                  activeTab === 'my-items'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                My Items
              </button>
              <button
                onClick={() => setActiveTab('repositories')}
                className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                  activeTab === 'repositories'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Repositories ({project.repositories.length})
              </button>
              <button
                onClick={() => setActiveTab('members')}
                className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                  activeTab === 'members'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Members ({project.members.length})
              </button>
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-6 py-4 text-sm font-medium border-b-2 whitespace-nowrap ${
                  activeTab === 'overview'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Overview
              </button>
            </nav>
          </div>

          <div className="p-6">
            {activeTab === 'backlog' && boardId && (
              <KanbanBoard
                boardId={boardId}
                projectId={projectId}
                onItemMoved={fetchProjectDetails}
              />
            )}
            {activeTab === 'roadmap' && (
              <RoadmapView projectId={projectId} />
            )}
            {activeTab === 'insights' && (
              <InsightsView projectId={projectId} />
            )}
            {activeTab === 'team-items' && (
              <TeamItemsTab projectId={projectId} />
            )}
            {activeTab === 'my-items' && (
              <MyItemsTab projectId={projectId} />
            )}
            {activeTab === 'repositories' && (
              <RepositoriesTab repositories={project.repositories} />
            )}
            {activeTab === 'members' && (
              <MembersTab members={project.members} />
            )}
            {activeTab === 'overview' && (
              <OverviewTab project={project} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ project }: { project: Project }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700">Project ID</label>
        <p className="mt-1 text-sm text-gray-500 font-mono">{project.id}</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Description</label>
        <p className="mt-1 text-sm text-gray-500">{project.description || 'No description provided'}</p>
      </div>
      {project.github_account && (
        <div>
          <label className="block text-sm font-medium text-gray-700">GitHub Account</label>
          <p className="mt-1 text-sm text-gray-500">
            {project.github_account.account_name}
            {project.github_account.github_username && ` (@${project.github_account.github_username})`}
          </p>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700">Created</label>
        <p className="mt-1 text-sm text-gray-500">
          {new Date(project.created_at).toLocaleString()}
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Last Updated</label>
        <p className="mt-1 text-sm text-gray-500">
          {new Date(project.updated_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

function RepositoriesTab({ repositories }: { repositories: Project['repositories'] }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Repositories</h2>
      {repositories.length === 0 ? (
        <p className="text-gray-500">No repositories added yet.</p>
      ) : (
        <div className="space-y-2">
          {repositories.map((repo) => (
            <div
              key={repo.id}
              className="flex items-center justify-between p-4 border border-gray-200 rounded-md"
            >
              <div>
                <a
                  href={`https://github.com/${repo.repository_full_name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-blue-600 hover:underline"
                >
                  {repo.repository_full_name}
                </a>
                {repo.github_account && (
                  <div className="text-sm text-gray-500 mt-1">
                    Account: {repo.github_account.account_name}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MembersTab({ members }: { members: Project['members'] }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Members</h2>
      {members.length === 0 ? (
        <p className="text-gray-500">No members yet.</p>
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-4 border border-gray-200 rounded-md"
            >
              <div>
                <div className="font-medium text-gray-900">
                  {member.email || member.user_id}
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  Role: {member.role}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
