# Multiple GitHub Accounts on Vercel

## Overview

On Vercel, you can't dynamically write to `.env.local` files. The system uses:

1. **Database (Primary)** - Store multiple GitHub accounts in Supabase/Neon
2. **Environment Variables (Fallback)** - Single `GITHUB_TOKEN` for system-level access

## How Multiple Accounts Work

### Database Accounts (Recommended)

Each GitHub account stored in the database has:
- **`id`** - Unique UUID (e.g., `"23610fb1-8875-4762-aee9-960130ec26f1"`)
- **`account_name`** - Friendly name (e.g., "Personal", "Work", "Organization")
- **`github_username`** - The GitHub username
- **`user_id`** - Links account to a user

### Using Specific Account

To use a specific account, pass `github_account_id` as a query parameter:

```bash
# Get repos with specific account
curl "https://your-app.vercel.app/api/repos?github_account_id=23610fb1-8875-4762-aee9-960130ec26f1"

# Test token retrieval
curl "https://your-app.vercel.app/api/github-accounts/test-token?github_account_id=23610fb1-8875-4762-aee9-960130ec26f1"
```

### Default Account

If no `github_account_id` is provided:
1. Uses the user's **default account** (from `user_workspaces.default_github_account_id`)
2. Falls back to **first account** (oldest by `created_at`)
3. Falls back to **environment variable** `GITHUB_TOKEN`

## Environment Variables on Vercel

### Single Token (Fallback)

On Vercel, you can set:
- `GITHUB_TOKEN` - Single token for fallback/system use

**Note:** This is a fallback. For multiple accounts, use the database.

### Vercel Environment Variables

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add `GITHUB_TOKEN` for Production/Preview/Development
3. This is used as a fallback when no database accounts exist

## Testing Token Retrieval

### Local Development

```bash
# Get default token
curl http://localhost:3000/api/github-accounts/test-token

# Get specific account token
curl "http://localhost:3000/api/github-accounts/test-token?github_account_id=<account-id>"

# Get repos with default account
curl http://localhost:3000/api/repos

# Get repos with specific account
curl "http://localhost:3000/api/repos?github_account_id=<account-id>"
```

### On Vercel

```bash
# Get default token
curl https://your-app.vercel.app/api/github-accounts/test-token

# Get specific account token
curl "https://your-app.vercel.app/api/github-accounts/test-token?github_account_id=<account-id>"

# Get repos with default account
curl https://your-app.vercel.app/api/repos

# Get repos with specific account
curl "https://your-app.vercel.app/api/repos?github_account_id=<account-id>"
```

## Account Naming Convention

### Database Accounts

- **ID**: Auto-generated UUID (e.g., `23610fb1-8875-4762-aee9-960130ec26f1`)
- **Name**: User-defined friendly name (e.g., "Personal", "Work Account", "Company")
- **Username**: GitHub username (auto-detected from token)

### Example Accounts

```json
[
  {
    "id": "23610fb1-8875-4762-aee9-960130ec26f1",
    "account_name": "Personal",
    "github_username": "john-doe",
    "created_at": "2024-01-01T00:00:00Z"
  },
  {
    "id": "45620fc2-9886-5873-bff0-a701341fd37g2",
    "account_name": "Work",
    "github_username": "johndoe-work",
    "created_at": "2024-01-02T00:00:00Z"
  }
]
```

## API Endpoints

### List All Accounts

```bash
GET /api/github-accounts
```

Returns all accounts for the authenticated user (or 'dev' user in development).

### Add Account

```bash
POST /api/github-accounts
Content-Type: application/json

{
  "account_name": "Personal",
  "token": "ghp_..."
}
```

This saves to database AND updates `.env.local` (local only, not on Vercel).

### Test Token

```bash
GET /api/github-accounts/test-token?github_account_id=<optional-id>
```

Returns token source and info (useful for debugging).

## Best Practices for Vercel

1. **Use Database Accounts** - Store multiple accounts in Supabase/Neon
2. **Set Default Account** - Configure user's default in `user_workspaces`
3. **Environment Variable as Fallback** - Keep `GITHUB_TOKEN` for system-level access
4. **Use Account IDs** - Pass `github_account_id` when you need a specific account

## Example: Switching Between Accounts

```javascript
// Frontend example
const accounts = await fetch('/api/github-accounts').then(r => r.json());

// Use first account
const repos1 = await fetch('/api/repos').then(r => r.json());

// Use specific account
const repos2 = await fetch(`/api/repos?github_account_id=${accounts.accounts[1].id}`).then(r => r.json());
```



