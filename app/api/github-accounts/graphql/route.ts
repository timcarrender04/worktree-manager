import { NextResponse } from 'next/server';
import { graphqlQuery } from '@/lib/graphql/client';

/**
 * GraphQL endpoint proxy for GitHub accounts
 * Allows testing GraphQL queries for GitHub accounts
 * 
 * Usage:
 *   curl -X POST http://localhost:3000/api/github-accounts/graphql \
 *     -H "Content-Type: application/json" \
 *     -d '{"query": "{ githubAccountsCollection { edges { node { id accountName githubUsername } } } }"}'
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { query, variables } = body;

    if (!query) {
      return NextResponse.json(
        { error: 'GraphQL query is required' },
        { status: 400 }
      );
    }

    // Execute GraphQL query
    const result = await graphqlQuery(query, variables);

    if (result.errors) {
      return NextResponse.json(
        { data: result.data, errors: result.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GraphQL endpoint error:', error);
    return NextResponse.json(
      { error: error.message || 'GraphQL query failed' },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint with example queries
 */
export async function GET() {
  const examples = {
    message: 'Use POST to execute GraphQL queries',
    examples: {
      getAllAccounts: {
        method: 'POST',
        url: '/api/github-accounts/graphql',
        body: {
          query: `
            query {
              githubAccountsCollection {
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
          `
        }
      },
      getAccountById: {
        method: 'POST',
        url: '/api/github-accounts/graphql',
        body: {
          query: `
            query($id: UUID!) {
              githubAccountsCollection(filter: { id: { eq: $id } }) {
                edges {
                  node {
                    id
                    accountName
                    githubUsername
                  }
                }
              }
            }
          `,
          variables: {
            id: "23610fb1-8875-4762-aee9-960130ec26f1"
          }
        }
      },
      getAccountsByUser: {
        method: 'POST',
        url: '/api/github-accounts/graphql',
        body: {
          query: `
            query($userId: String!) {
              githubAccountsCollection(filter: { userId: { eq: $userId } }) {
                edges {
                  node {
                    id
                    accountName
                    githubUsername
                  }
                }
              }
            }
          `,
          variables: {
            userId: "user-uuid-here"
          }
        }
      }
    },
    curlExamples: {
      getAll: `curl -X POST http://localhost:3333/api/github-accounts/graphql \\
  -H "Content-Type: application/json" \\
  -d '{"query": "{ githubAccountsCollection { edges { node { id accountName githubUsername } } } }"}'`,
      getById: `curl -X POST http://localhost:3333/api/github-accounts/graphql \\
  -H "Content-Type: application/json" \\
  -d '{"query": "query($id: UUID!) { githubAccountsCollection(filter: { id: { eq: $id } }) { edges { node { id accountName } } } }", "variables": {"id": "23610fb1-8875-4762-aee9-960130ec26f1"}}'`
    }
  };

  return NextResponse.json(examples);
}



