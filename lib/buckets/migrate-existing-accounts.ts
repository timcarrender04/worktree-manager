import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'
import { createBucketForAccount } from './service'

export interface MigrationResult {
  accountId: string
  accountName: string
  success: boolean
  bucketName?: string
  error?: string
}

/**
 * Migrate all existing GitHub accounts to have buckets
 * @param userId - Optional user ID to migrate buckets for specific user only
 * @returns Array of migration results
 */
export async function migrateExistingAccounts(
  userId?: string
): Promise<MigrationResult[]> {
  const results: MigrationResult[] = []
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

  try {
    let accounts: Array<{ id: string; user_id: string; account_name: string; bucket_name: string | null }> = []

    if (isUsingNeon) {
      // Get all accounts from Neon database
      let querySql = `
        SELECT id, user_id, account_name, bucket_name
        FROM github_accounts
      `
      const params: any[] = []

      if (userId) {
        querySql += ' WHERE user_id = $1'
        params.push(userId)
      }

      const result = await query(querySql, params)
      accounts = result.rows
    } else {
      // Get all accounts from Supabase
      const supabase = await createClient()

      let query = supabase
        .from('github_accounts')
        .select('id, user_id, account_name, bucket_name')

      if (userId) {
        query = query.eq('user_id', userId)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error fetching accounts:', error)
        return results
      }

      accounts = data || []
    }

    // Process each account
    for (const account of accounts) {
      // Skip if bucket already exists
      if (account.bucket_name) {
        results.push({
          accountId: account.id,
          accountName: account.account_name,
          success: true,
          bucketName: account.bucket_name,
          error: 'Bucket already exists',
        })
        continue
      }

      // Create bucket for account
      try {
        const bucketResult = await createBucketForAccount(
          account.id,
          account.account_name,
          account.user_id
        )

        if (bucketResult.success && bucketResult.bucket) {
          results.push({
            accountId: account.id,
            accountName: account.account_name,
            success: true,
            bucketName: bucketResult.bucket.bucket_name,
          })
        } else {
          results.push({
            accountId: account.id,
            accountName: account.account_name,
            success: false,
            error: bucketResult.error || 'Failed to create bucket',
          })
        }
      } catch (error: any) {
        results.push({
          accountId: account.id,
          accountName: account.account_name,
          success: false,
          error: error.message || 'Unknown error',
        })
      }
    }

    return results
  } catch (error: any) {
    console.error('Error migrating existing accounts:', error)
    return results
  }
}

/**
 * Get migration statistics
 */
export async function getMigrationStats(userId?: string): Promise<{
  total: number
  withBuckets: number
  withoutBuckets: number
}> {
  const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

  try {
    if (isUsingNeon) {
      let querySql = `
        SELECT 
          COUNT(*) as total,
          COUNT(bucket_name) as with_buckets
        FROM github_accounts
      `
      const params: any[] = []

      if (userId) {
        querySql += ' WHERE user_id = $1'
        params.push(userId)
      }

      const result = await query(querySql, params)
      const row = result.rows[0]

      return {
        total: parseInt(row.total) || 0,
        withBuckets: parseInt(row.with_buckets) || 0,
        withoutBuckets: (parseInt(row.total) || 0) - (parseInt(row.with_buckets) || 0),
      }
    } else {
      const supabase = await createClient()

      let query = supabase
        .from('github_accounts')
        .select('id, bucket_name', { count: 'exact' })

      if (userId) {
        query = query.eq('user_id', userId)
      }

      const { data, count, error } = await query

      if (error) {
        console.error('Error getting migration stats:', error)
        return { total: 0, withBuckets: 0, withoutBuckets: 0 }
      }

      const withBuckets = data?.filter((account) => account.bucket_name).length || 0
      const total = count || 0

      return {
        total,
        withBuckets,
        withoutBuckets: total - withBuckets,
      }
    }
  } catch (error: any) {
    console.error('Error getting migration stats:', error)
    return { total: 0, withBuckets: 0, withoutBuckets: 0 }
  }
}


