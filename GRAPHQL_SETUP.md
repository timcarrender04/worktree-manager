# GraphQL Setup for Supabase

## Overview

Supabase supports GraphQL via the `pg_graphql` PostgreSQL extension. This provides an auto-generated GraphQL API that reflects your PostgreSQL schema.

## Benefits for GitHub Accounts

GraphQL makes it easier to:
- Query specific fields (no over-fetching)
- Get multiple accounts in one request
- Filter and sort accounts
- Use nested queries (e.g., accounts with their repositories)

## Setup

### 1. Enable GraphQL Extension

Run the migration:
```bash
# Connect to database
psql -h localhost -p 5433 -U postgres -d repo_hub

# Or run the migration file
psql -h localhost -p 5433 -U postgres -d repo_hub -f worktree-manager/lib/supabase/migrations/009_enable_graphql.sql
```

Or via Supabase Dashboard:
1. Go to Database → Extensions
2. Search for "pg_graphql"
3. Enable it

### 2. Access GraphQL Endpoint

**Local Development:**
```
POST http://localhost:8002/graphql/v1
```

**On Vercel (Supabase Cloud):**
```
POST https://<PROJECT_REF>.supabase.co/graphql/v1
```

## GraphQL Query Examples

### Get All GitHub Accounts

```graphql
query {
  githubAccountsCollection {
    edges {
      node {
        id
        accountName
        githubUsername
        createdAt
        userId
      }
    }
  }
}
```

### Get Specific Account by ID

```graphql
query {
  githubAccountsCollection(filter: { id: { eq: "23610fb1-8875-4762-aee9-960130ec26f1" } }) {
    edges {
      node {
        id
        accountName
        githubUsername
        createdAt
      }
    }
  }
}
```

### Get Accounts for Specific User

```graphql
query {
  githubAccountsCollection(filter: { userId: { eq: "user-uuid-here" } }) {
    edges {
      node {
        id
        accountName
        githubUsername
      }
    }
  }
}
```

### Get Accounts with Filtering and Sorting

```graphql
query {
  githubAccountsCollection(
    filter: { userId: { eq: "user-uuid-here" } }
    orderBy: { createdAt: DescNullsLast }
    first: 10
  ) {
    edges {
      node {
        id
        accountName
        githubUsername
        createdAt
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

## Testing with cURL

### Get All Accounts

```bash
curl -X POST http://localhost:8002/graphql/v1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "query": "query { githubAccountsCollection { edges { node { id accountName githubUsername createdAt } } } }"
  }'
```

### Get Specific Account

```bash
curl -X POST http://localhost:8002/graphql/v1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "query": "query($id: UUID!) { githubAccountsCollection(filter: { id: { eq: $id } }) { edges { node { id accountName githubUsername } } } }",
    "variables": { "id": "23610fb1-8875-4762-aee9-960130ec26f1" }
  }'
```

## Using in Next.js API Routes

### Example: GraphQL Client Helper

```typescript
// lib/graphql/client.ts
export async function graphqlQuery(query: string, variables?: Record<string, any>) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/graphql/v1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  
  return response.json();
}

// Usage
const result = await graphqlQuery(`
  query {
    githubAccountsCollection {
      edges {
        node {
          id
          accountName
          githubUsername
        }
      }
    }
  }
`);
```

## Multiple Accounts Naming Convention

With GraphQL, you can query accounts more flexibly:

### Query by Account Name

```graphql
query {
  githubAccountsCollection(filter: { accountName: { eq: "Personal" } }) {
    edges {
      node {
        id
        accountName
        githubUsername
      }
    }
  }
}
```

### Query Multiple Accounts by IDs

```graphql
query {
  account1: githubAccountsCollection(filter: { id: { eq: "id1" } }) {
    edges { node { id accountName } }
  }
  account2: githubAccountsCollection(filter: { id: { eq: "id2" } }) {
    edges { node { id accountName } }
  }
}
```

## GraphiQL Interface

Supabase provides a built-in GraphiQL IDE:
- **Local**: Not available in local setup (use Postman/Insomnia)
- **Cloud**: Go to Supabase Dashboard → API Docs → GraphQL → GraphiQL

## Advantages Over REST

1. **Single Request**: Get multiple accounts with specific fields
2. **Type Safety**: GraphQL schema matches your database
3. **Flexible Queries**: Filter, sort, paginate in one query
4. **No Over-fetching**: Only get the fields you need
5. **Relationships**: Can query related data (e.g., accounts with projects)

## Migration

To enable GraphQL, run:
```bash
psql -h localhost -p 5433 -U postgres -d repo_hub -f worktree-manager/lib/supabase/migrations/009_enable_graphql.sql
```

Or restart your Docker containers (the migration runs automatically on first startup).


