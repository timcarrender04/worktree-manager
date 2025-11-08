# Git Working Tree Manager

A Next.js web application for managing Git working trees across multiple repositories. Perfect for parallel development workflows with multiple AI agents or team members.

## Features

- 🎯 **Interactive UI**: Clean, modern interface for creating and managing working trees
- 📦 **Multi-Repository Support**: Manage working trees for frontend, backend, and viewer repositories
- 🌿 **Branch Management**: Automatically creates branches from dev and organizes them by type (feat, bugs, fixes)
- 🐳 **Dockerized**: Easy deployment in any environment with Docker
- ⚡ **Real-time Status**: View all existing working trees at a glance

## Quick Start

### Container Deployment (Recommended)

The application is designed to run inside a Docker container with all Git operations mounted from the host. The steps below walk through a clean installation on any Linux host or container platform (Docker Desktop, Colima, Kubernetes, etc.).

1. **Install prerequisites**
   - Docker Engine 24+ (or a compatible runtime such as containerd)
   - Docker Compose V2 (`docker compose` CLI)
   - Git 2.40+

2. **Pick a host workspace root**
   - Choose a directory on the host where all repositories and worktrees will live, for example `/srv/worktree-manager`.
   - Within that directory create the following nested structure:
     ```bash
     sudo mkdir -p /srv/worktree-manager/repos/<your-username>/Tree
     sudo chown -R $USER:$USER /srv/worktree-manager
     ```
     The `<your-username>` segment keeps every developer isolated while sharing a single repo cache.

3. **Clone the application**
   ```bash
   git clone https://github.com/<org-or-user>/worktree-manager.git /srv/worktree-manager/app
   cd /srv/worktree-manager/app
   ```

4. **Prepare environment configuration**
   ```bash
   cp .env.example .env
   nano .env  # populate the variables listed below
   ```

   At minimum set `GITHUB_TOKEN` and the `WORKTREE_ROOT` family of variables so the container knows where the repositories live.

5. **Map host directories to the container**
   Update `docker-compose.yml` (or override via `docker compose -f docker-compose.yml -f docker-compose.override.yml up`) so that:
   - `${HOST_REPO_ROOT}` points to `/srv/worktree-manager/repos`
   - `${WORKTREE_ROOT}` points to `/srv/worktree-manager/repos/<your-username>/Tree`
   - The `volumes` section mounts `${HOST_REPO_ROOT}` to `/repos` inside the container

   Example override file:
   ```yaml
   services:
     worktree-manager:
       environment:
         HOST_REPO_ROOT: /srv/worktree-manager/repos
         WORKTREE_ROOT: /repos/<your-username>/Tree
       volumes:
         - /srv/worktree-manager/repos:/repos:rw
   ```

6. **Start the stack**
   ```bash
   docker compose up -d
   ```

7. **Access the UI**
   - Open http://localhost:3021 (or the port you exposed) to confirm the deployment.
   - The first load may take a few seconds while Git repositories are scanned.

### Development Mode

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env and fill in your values
   nano .env  # or use your preferred editor
   ```

3. **Run development server**:
   ```bash
   npm run dev
   ```

## Configuration

### Environment Variables

All environment-specific configuration is managed through a `.env` file. A template file `.env.example` is provided with all available options documented.

#### Required Variables

- `GITHUB_TOKEN`: GitHub personal access token for cloning/fetching repositories
  - Create one at: https://github.com/settings/tokens
  - Required permissions: `repo` (for private repos), `read:org` (for org repos)

#### Optional Variables

**GitHub Configuration:**
- `GITHUB_ORG`: GitHub organization or username (default: `timcarrender04`)

**Repository Paths:**
- `REPO_HUB_ROOT`: Base directory that contains all repositories (default: `../repos`)
- `REPO_ROOT`: Root directory where repositories are located (default: `/repos`)
- `HOST_REPO_ROOT`: Host path for repositories, used for path translation (default: same as `REPO_ROOT`)
- `WORKTREE_ROOT`: Root directory for worktrees (default: `{REPO_ROOT}/Tree`)

When using the shared repo-hub deployment located at `/home/ert/projects/backend/repo-hub`, point these variables to the shared storage and include a user-specific segment so each Worktree Manager operates in its own sandbox:

```env
REPO_HUB_ROOT=/home/ert/projects/backend/repo-hub/repos
REPO_ROOT=/home/ert/projects/backend/repo-hub/repos
HOST_REPO_ROOT=/home/ert/projects/backend/repo-hub/repos
WORKTREE_ROOT=/home/ert/projects/backend/repo-hub/repos/hds-175/Tree
```

Create the per-user directory ahead of time (for example `mkdir -p /home/ert/projects/backend/repo-hub/repos/hds-175/Tree`) so worktrees do not overlap across accounts. Replace `hds-175` with each user's identifier if you are onboarding multiple accounts.

**Repository Names** (only override if using different repo names):
- `FRONTEND_REPO`: Frontend repository name (default: `sideline-frontend`)
- `BACKEND_REPO`: Backend repository name (default: `sideline-backend`)
- `VIEWER_REPO`: Viewer repository name (default: `ohif-viewer`)

**Repository Keys** (only override if using different keys):
- `FRONTEND_KEY`: Frontend repository key (default: `frontend`)
- `BACKEND_KEY`: Backend repository key (default: `backend`)
- `VIEWER_KEY`: Viewer repository key (default: `viewer`)

**Supabase Configuration** (if using Supabase features):
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anonymous/public key
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (for admin operations)

**AI Provider Configuration:**
- `OLLAMA_SERVER`: Base URL for the Ollama server (default: `https://ollama.timcarrender.me`)
- `OLLAMA_BASE_URL`: Alternate key for the same value; the application checks both variables.
  - The default endpoint hosts the shared Ollama instance documented at https://ollama.timcarrender.me. Override these values if you operate a private Ollama deployment.

**Docker Configuration:**
- `USER_ID`: Linux user ID for Docker container, should match host user ID (default: `1020`)
  - Check your user ID with: `id -u`
- `GROUP_ID`: Linux group ID for Docker container, should match host group ID (default: `1020`)
  - Check your group ID with: `id -g`

**AWS Configuration** (optional - if using AWS services):
- `AWS_ACCESS_KEY_ID`: AWS access key
- `AWS_SECRET_ACCESS_KEY`: AWS secret key
- `AWS_REGION`: AWS region (e.g., `us-east-1`, `us-west-2`)

**Varus Hill Configuration** (optional - if using Varus Hill service):
- `VARUS_HILL_TOKEN`: Varus Hill service token

#### Alternative GitHub Token Locations

If `GITHUB_TOKEN` is not set in the environment, the application will automatically look for token files in these locations:
- `{REPO_ROOT}/../.github-token`
- `{REPO_ROOT}/../token`
- `{REPO_ROOT}/../GITHUB_TOKEN`
- `{REPO_ROOT}/.github-token`
- `{REPO_ROOT}/token`
- `{REPO_ROOT}/GITHUB_TOKEN`

#### Environment File Setup

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in your values:
   ```bash
   nano .env  # or use your preferred editor
   ```

3. For Docker Compose: The `docker-compose.yml` automatically loads variables from `.env`. Restart the container after making changes:
   ```bash
   docker-compose restart
   ```

4. For Development: Next.js automatically loads `.env` files. Restart the dev server after making changes:
   ```bash
   # Stop with Ctrl+C
   npm run dev
   ```

### Repository Configuration

The app is pre-configured for:
- `sideline-frontend` (frontend)
- `ohif-viewer` (viewer)
- `sideline-backend` (backend)

To modify repositories, use environment variables (`FRONTEND_REPO`, `BACKEND_REPO`, `VIEWER_REPO`) in your `.env` file, or edit the default values in `app/api/worktrees/route.ts`.

## Docker Volume Mounting

The docker-compose.yml mounts the parent directory (`../`) to `/repos` so the container can access all repositories. You can customize this by:

1. Mounting specific repositories:
   ```yaml
   volumes:
     - ../sideline-frontend:/repos/sideline-frontend:rw
     - ../ohif-viewer:/repos/ohif-viewer:rw
     - ../sideline-backend:/repos/sideline-backend:rw
   ```

2. Or mounting from a different location:
   ```yaml
   services:
     worktree-manager:
       environment:
         - HOST_REPO_ROOT=/home/ert/projects/backend/repo-hub/repos
         - WORKTREE_ROOT=/repos/hds-175/Tree
       volumes:
         - ${HOST_REPO_ROOT}:/repos:rw
   ```

  For per-user isolation, create a subdirectory under the shared repo-hub storage (for example `repos/hds-175`) and point `WORKTREE_ROOT` at that directory. When running inside Docker, set `WORKTREE_ROOT=/repos/hds-175/Tree`; when running directly on the host, use `WORKTREE_ROOT=${HOST_REPO_ROOT}/hds-175/Tree`.

## Usage

### Creating Working Trees

1. **Select Repository**: Choose which repository you want to create a working tree for (multiple selection supported)
2. **Choose Branch Type**: Select from "New Feature", "Bug Fix", or "Fix"
3. **Enter Branch Name**: Provide a descriptive name (e.g., `login-button`, `auth-fix`)
4. **Create**: Click "Create Working Tree" to generate the isolated working tree

The working tree will be created in the format: `{repoName}-{type}-{name}/`

## API Endpoints

### Worktrees
- `GET /api/repos` - List all configured repositories
- `GET /api/worktrees` - List all existing working trees
- `POST /api/worktrees` - Create a new working tree
  ```json
  {
    "repos": ["frontend", "backend"],
    "type": "feat",
    "name": "login-button"
  }
  ```
- `DELETE /api/worktrees` - Delete a working tree

## Troubleshooting

### Permission Issues

If you encounter permission errors, ensure the Docker container has write access to the mounted volumes:

```bash
# Fix permissions (adjust user/group as needed)
sudo chown -R $USER:$USER /path/to/repos
```

### GitHub Token Issues

Make sure your GitHub token has the necessary permissions:

**For Classic Personal Access Tokens:**
- `repo` scope (for private repositories and cloning)
- `read:org` scope (if repositories are in an organization)

**For Fine-Grained Personal Access Tokens:**
- Repository access: Select the repositories you want to manage
- Repository permissions: `Contents` (read), `Metadata` (read)

### Repository Not Found

If repositories don't appear:
1. Ensure they exist in the `REPO_ROOT` directory
2. Check that they are valid Git repositories (have a `.git` directory)
3. Verify the repository names match the configuration

## Development

### Project Structure

```
worktree-manager/
├── app/
│   ├── api/
│   │   ├── repos/
│   │   │   └── route.ts           # Repository listing API
│   │   └── worktrees/
│   │       └── route.ts           # Working tree management API
│   ├── components/
│   │   └── Sidebar.tsx            # Navigation sidebar
│   ├── layout.tsx                 # Root layout with sidebar
│   └── page.tsx                   # Main worktrees UI
├── dev/
│   └── workspaces/                # VS Code workspace configurations
├── docs/
│   ├── examples/                  # Sample filesystem layouts and reference data
│   └── ...                        # Operational guides and runbooks
├── scripts/                       # Automation scripts (TS + bash)
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## Supporting Resources

- `docs/`: Collected runbooks, example filesystem layouts, and environment-specific guides.
- `dev/workspaces/`: Shared VS Code workspace files grouped away from the project root.
- `scripts/`: Automation utilities for local development, testing, and operations.

## License

MIT
