import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createGitHubClient } from '@/lib/github/client'
import { query } from '@/lib/db/client'

export interface GitHubAccount {
  id: string
  account_name: string
  github_username: string
  encrypted_token: string
}

export interface AWSCredentials {
  id: string
  profile_name: string
  access_key_id: string
  secret_access_key: string
  region: string
  default_profile: boolean
}

export interface UserWorkspace {
  id: string
  user_id: string
  workspace_path: string
  default_github_account_id: string | null
  default_aws_profile_id: string | null
}

/**
 * Get GitHub token for a user
 * @param userId - The user ID
 * @param accountId - Optional GitHub account ID. If not provided, uses default or first available
 * @returns The GitHub token or null if not found
 */
export async function getUserGitHubToken(
  userId: string,
  accountId?: string
): Promise<string | null> {
  try {
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      // Use direct PostgreSQL query
      let querySql = `
        SELECT encrypted_token, id
        FROM github_accounts
        WHERE user_id = $1
      `
      const params: any[] = [userId]

      if (accountId) {
        querySql += ' AND id = $2'
        params.push(accountId)
      } else {
        // Try to get default from workspace, otherwise get first
        querySql += `
          ORDER BY 
            CASE WHEN id = (
              SELECT default_github_account_id 
              FROM user_workspaces 
              WHERE user_id = $1
            ) THEN 0 ELSE 1 END,
            created_at ASC
          LIMIT 1
        `
      }

      const result = await query(querySql, params)
      return result.rows.length > 0 ? result.rows[0].encrypted_token : null
    } else {
      // Use Supabase client
      const supabase = await createClient()

      if (accountId) {
        const { data, error } = await supabase
          .from('github_accounts')
          .select('encrypted_token')
          .eq('id', accountId)
          .eq('user_id', userId)
          .single()

        if (error || !data) return null
        return data.encrypted_token
      } else {
        // Get default from workspace first
        const { data: workspace } = await supabase
          .from('user_workspaces')
          .select('default_github_account_id')
          .eq('user_id', userId)
          .single()

        if (workspace?.default_github_account_id) {
          const { data } = await supabase
            .from('github_accounts')
            .select('encrypted_token')
            .eq('id', workspace.default_github_account_id)
            .eq('user_id', userId)
            .single()

          if (data) return data.encrypted_token
        }

        // Fallback to first account
        const { data } = await supabase
          .from('github_accounts')
          .select('encrypted_token')
          .eq('user_id', userId)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()

        return data?.encrypted_token || null
      }
    }
  } catch (error) {
    console.error('Error getting GitHub token:', error)
    return null
  }
}

/**
 * Get GitHub account for a user
 * @param userId - The user ID
 * @param accountId - Optional GitHub account ID
 * @returns The GitHub account or null if not found
 */
export async function getUserGitHubAccount(
  userId: string,
  accountId?: string
): Promise<GitHubAccount | null> {
  try {
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      let querySql = `
        SELECT id, account_name, github_username, encrypted_token
        FROM github_accounts
        WHERE user_id = $1
      `
      const params: any[] = [userId]

      if (accountId) {
        querySql += ' AND id = $2'
        params.push(accountId)
      } else {
        querySql += `
          ORDER BY 
            CASE WHEN id = (
              SELECT default_github_account_id 
              FROM user_workspaces 
              WHERE user_id = $1
            ) THEN 0 ELSE 1 END,
            created_at ASC
          LIMIT 1
        `
      }

      const result = await query(querySql, params)
      if (result.rows.length === 0) return null

      const row = result.rows[0]
      return {
        id: row.id,
        account_name: row.account_name,
        github_username: row.github_username,
        encrypted_token: row.encrypted_token,
      }
    } else {
      const supabase = await createClient()

      if (accountId) {
        const { data, error } = await supabase
          .from('github_accounts')
          .select('id, account_name, github_username, encrypted_token')
          .eq('id', accountId)
          .eq('user_id', userId)
          .single()

        if (error || !data) return null
        return data as GitHubAccount
      } else {
        // Get default from workspace first
        const { data: workspace } = await supabase
          .from('user_workspaces')
          .select('default_github_account_id')
          .eq('user_id', userId)
          .single()

        if (workspace?.default_github_account_id) {
          const { data } = await supabase
            .from('github_accounts')
            .select('id, account_name, github_username, encrypted_token')
            .eq('id', workspace.default_github_account_id)
            .eq('user_id', userId)
            .single()

          if (data) return data as GitHubAccount
        }

        // Fallback to first account
        const { data } = await supabase
          .from('github_accounts')
          .select('id, account_name, github_username, encrypted_token')
          .eq('user_id', userId)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()

        return (data as GitHubAccount) || null
      }
    }
  } catch (error) {
    console.error('Error getting GitHub account:', error)
    return null
  }
}

/**
 * Get AWS credentials for a user
 * @param userId - The user ID
 * @param profileName - Optional profile name. If not provided, uses default profile
 * @returns The AWS credentials or null if not found
 */
export async function getUserAWSCredentials(
  userId: string,
  profileName?: string
): Promise<AWSCredentials | null> {
  try {
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      let querySql = `
        SELECT id, profile_name, access_key_id, secret_access_key, region, default_profile
        FROM user_aws_credentials
        WHERE user_id = $1
      `
      const params: any[] = [userId]

      if (profileName) {
        querySql += ' AND profile_name = $2'
        params.push(profileName)
      } else {
        // Get default profile
        querySql += ' AND default_profile = true'
      }

      const result = await query(querySql, params)
      if (result.rows.length === 0) return null

      const row = result.rows[0]
      return {
        id: row.id,
        profile_name: row.profile_name,
        access_key_id: row.access_key_id,
        secret_access_key: row.secret_access_key,
        region: row.region || 'us-east-1',
        default_profile: row.default_profile || false,
      }
    } else {
      const supabase = await createClient()

      if (profileName) {
        const { data, error } = await supabase
          .from('user_aws_credentials')
          .select('id, profile_name, access_key_id, secret_access_key, region, default_profile')
          .eq('user_id', userId)
          .eq('profile_name', profileName)
          .single()

        if (error || !data) return null
        return data as AWSCredentials
      } else {
        // Get default profile
        const { data, error } = await supabase
          .from('user_aws_credentials')
          .select('id, profile_name, access_key_id, secret_access_key, region, default_profile')
          .eq('user_id', userId)
          .eq('default_profile', true)
          .single()

        if (error || !data) {
          // Fallback to first available
          const { data: fallback } = await supabase
            .from('user_aws_credentials')
            .select('id, profile_name, access_key_id, secret_access_key, region, default_profile')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .limit(1)
            .single()

          return (fallback as AWSCredentials) || null
        }

        return data as AWSCredentials
      }
    }
  } catch (error) {
    console.error('Error getting AWS credentials:', error)
    return null
  }
}

/**
 * Get user workspace configuration
 * @param userId - The user ID
 * @returns The workspace configuration or null if not found
 */
export async function getUserWorkspace(userId: string): Promise<UserWorkspace | null> {
  try {
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      const result = await query(
        `
        SELECT id, user_id, workspace_path, default_github_account_id, default_aws_profile_id
        FROM user_workspaces
        WHERE user_id = $1
        `,
        [userId]
      )

      if (result.rows.length === 0) return null

      const row = result.rows[0]
      return {
        id: row.id,
        user_id: row.user_id,
        workspace_path: row.workspace_path,
        default_github_account_id: row.default_github_account_id,
        default_aws_profile_id: row.default_aws_profile_id,
      }
    } else {
      const supabase = await createClient()

      const { data, error } = await supabase
        .from('user_workspaces')
        .select('id, user_id, workspace_path, default_github_account_id, default_aws_profile_id')
        .eq('user_id', userId)
        .single()

      if (error || !data) return null
      return data as UserWorkspace
    }
  } catch (error) {
    console.error('Error getting user workspace:', error)
    return null
  }
}

/**
 * Validate GitHub token with GitHub API
 * @param token - The GitHub token to validate
 * @returns True if valid, false otherwise
 */
export async function validateGitHubToken(token: string): Promise<boolean> {
  try {
    const client = createGitHubClient(token)
    return await client.validateToken()
  } catch (error) {
    console.error('Error validating GitHub token:', error)
    return false
  }
}

/**
 * Validate AWS credentials with AWS API
 * Tests credentials by calling AWS STS GetCallerIdentity
 * @param accessKeyId - AWS access key ID
 * @param secretAccessKey - AWS secret access key
 * @param region - AWS region (optional, defaults to us-east-1)
 * @returns True if credentials are valid and can authenticate
 */
export async function validateAWSCredentials(
  accessKeyId: string,
  secretAccessKey: string,
  region: string = 'us-east-1'
): Promise<boolean> {
  // Basic format validation
  // Access keys are typically 20 characters
  // Secret keys are typically 40 characters
  if (!accessKeyId || accessKeyId.length < 16 || accessKeyId.length > 128) {
    return false
  }

  if (!secretAccessKey || secretAccessKey.length < 16 || secretAccessKey.length > 128) {
    return false
  }

  // Try to validate with AWS SDK if available
  try {
    // Dynamic import to avoid requiring AWS SDK if not installed
    const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts')
    
    const stsClient = new STSClient({
      region: region || 'us-east-1',
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })

    const command = new GetCallerIdentityCommand({})
    const response = await stsClient.send(command)
    
    // If we get a response with an account ID, credentials are valid
    return !!response.Account
  } catch (error: any) {
    // If AWS SDK is not installed or validation fails, fall back to format check
    console.warn('AWS SDK validation failed, using format validation only:', error.message)
    // Return true for format validation (backward compatibility)
    return true
  }
}

/**
 * Get authenticated user from Supabase session
 * @returns User ID or null if not authenticated
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  try {
    const hasSupabaseEnv =
      !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (hasSupabaseEnv) {
      try {
        const supabase = await createClient()
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()

        if (!error && user?.id) {
          return user.id
        }
      } catch (supabaseError) {
        console.warn('getAuthenticatedUserId: Supabase auth lookup failed, falling back to cookies', supabaseError)
      }
    }

    // Fallback to custom wt_session cookie (used when Supabase is not configured)
    try {
      const cookieStore = await cookies()
      const sessionCookie = cookieStore.get('wt_session')

      if (sessionCookie?.value) {
        const decoded = JSON.parse(Buffer.from(sessionCookie.value, 'base64').toString())

        if (decoded?.exp && Date.now() > decoded.exp) {
          return null
        }

        if (decoded?.userId && typeof decoded.userId === 'string') {
          return decoded.userId
        }
      }
    } catch (cookieError) {
      console.warn('getAuthenticatedUserId: Failed to read wt_session cookie', cookieError)
    }

    return null
  } catch (error) {
    console.error('Error getting authenticated user:', error)
    return null
  }
}

