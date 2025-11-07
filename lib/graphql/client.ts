/**
 * GraphQL client for Supabase
 * Uses pg_graphql extension to query database via GraphQL
 */

interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
}

/**
 * Execute a GraphQL query against Supabase
 * @param query - GraphQL query string
 * @param variables - Optional variables for the query
 * @param token - Optional auth token (defaults to anon key)
 */
export async function graphqlQuery<T = any>(
  query: string,
  variables?: Record<string, any>,
  token?: string
): Promise<GraphQLResponse<T>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const authToken = token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  }

  // GraphQL endpoint
  const graphqlUrl = `${supabaseUrl}/graphql/v1`;

  try {
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    return result;
  } catch (error: any) {
    console.error('GraphQL query error:', error);
    throw error;
  }
}

/**
 * Get all GitHub accounts via GraphQL
 */
export async function getGitHubAccountsGraphQL(userId?: string) {
  const query = userId
    ? `
      query($userId: String!) {
        githubAccountsCollection(filter: { userId: { eq: $userId } }) {
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
    : `
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
    `;

  const variables = userId ? { userId } : undefined;

  return graphqlQuery(query, variables);
}

/**
 * Get specific GitHub account by ID via GraphQL
 */
export async function getGitHubAccountByIdGraphQL(accountId: string) {
  const query = `
    query($id: UUID!) {
      githubAccountsCollection(filter: { id: { eq: $id } }) {
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
  `;

  return graphqlQuery(query, { id: accountId });
}



