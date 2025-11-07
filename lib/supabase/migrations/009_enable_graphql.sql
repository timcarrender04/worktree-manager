-- Enable GraphQL support for Supabase
-- This enables the pg_graphql extension which provides auto-generated GraphQL API
-- GraphQL endpoint will be available at: http://localhost:8002/graphql/v1

-- Enable pg_graphql extension
CREATE EXTENSION IF NOT EXISTS pg_graphql;

-- Grant usage to required roles
GRANT USAGE ON SCHEMA graphql TO anon, authenticated, service_role;

-- Grant execute on graphql functions
GRANT EXECUTE ON FUNCTION graphql.resolve TO anon, authenticated, service_role;

-- Note: PostgREST v12+ supports GraphQL via pg_graphql
-- GraphQL queries will be available through PostgREST at /rest/v1/graphql/v1
-- Or through Kong at http://localhost:8002/graphql/v1



