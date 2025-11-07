import { createClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'
import { getUserAWSCredentials, getUserGitHubAccount } from '@/lib/credentials/helpers'
import * as awsS3 from './aws-s3'
import * as supabaseStorage from './supabase-storage'

export interface BucketInfo {
  bucket_name: string
  bucket_type: 's3' | 'supabase'
  region?: string
  is_public: boolean
}

/**
 * Sanitize a string to be a valid bucket name
 * Bucket names must be lowercase, alphanumeric with hyphens, 3-63 characters
 */
function sanitizeBucketName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-') // Replace invalid chars with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
    .substring(0, 63) // Limit to 63 characters
}

/**
 * Generate a unique bucket name for an account
 * Format: {user-id-short}-{account-name-sanitized}-worktrees
 */
function generateBucketName(userId: string, accountName: string, accountId: string): string {
  // Use first 8 chars of account ID for uniqueness
  const accountIdShort = accountId.substring(0, 8).replace(/-/g, '')
  const sanitizedAccountName = sanitizeBucketName(accountName)
  
  // Combine: accountId + accountName + worktrees
  const bucketName = `${accountIdShort}-${sanitizedAccountName}-worktrees`
  
  // Ensure it's within AWS limits (3-63 chars)
  if (bucketName.length < 3) {
    return `${accountIdShort}-worktrees`
  }
  if (bucketName.length > 63) {
    // Truncate account name if needed
    const maxAccountNameLength = 63 - accountIdShort.length - 11 // -11 for "-worktrees"
    const truncatedName = sanitizedAccountName.substring(0, maxAccountNameLength)
    return `${accountIdShort}-${truncatedName}-worktrees`
  }
  
  return bucketName
}

/**
 * Determine bucket type based on available credentials
 * Prefers AWS S3 if credentials are available, falls back to Supabase Storage
 */
async function determineBucketType(userId: string): Promise<'s3' | 'supabase'> {
  // Check if user has AWS credentials
  const awsCredentials = await getUserAWSCredentials(userId)
  if (awsCredentials) {
    return 's3'
  }
  
  // Fall back to Supabase Storage
  return 'supabase'
}

/**
 * Create a bucket for a GitHub account
 * @param accountId - GitHub account ID
 * @param accountName - GitHub account name
 * @param userId - User ID who owns the account
 * @returns Bucket info or error
 */
export async function createBucketForAccount(
  accountId: string,
  accountName: string,
  userId: string
): Promise<{ success: boolean; bucket?: BucketInfo; error?: string }> {
  try {
    // Determine bucket type
    const bucketType = await determineBucketType(userId)
    
    // Generate bucket name
    const bucketName = generateBucketName(userId, accountName, accountId)
    
    let createResult: { success: boolean; error?: string }
    let region: string | undefined

    if (bucketType === 's3') {
      // Get AWS credentials
      const awsCredentials = await getUserAWSCredentials(userId)
      if (!awsCredentials) {
        // Fall back to Supabase if no AWS credentials
        return await createBucketForAccount(accountId, accountName, userId)
      }

      region = awsCredentials.region || 'us-east-1'
      createResult = await awsS3.createS3Bucket(bucketName, region, awsCredentials)
    } else {
      // Use Supabase Storage
      createResult = await supabaseStorage.createSupabaseBucket(bucketName, false)
    }

    if (!createResult.success) {
      return {
        success: false,
        error: createResult.error || 'Failed to create bucket',
      }
    }

    // Store bucket info in database
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      // Update github_accounts table with bucket_name
      await query(
        `UPDATE github_accounts SET bucket_name = $1 WHERE id = $2`,
        [bucketName, accountId]
      )

      // Insert or update account_buckets table
      await query(
        `INSERT INTO account_buckets (github_account_id, bucket_name, bucket_type, region, is_public)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (github_account_id) 
         DO UPDATE SET bucket_name = $2, bucket_type = $3, region = $4, is_public = $5, updated_at = NOW()`,
        [accountId, bucketName, bucketType, region || null, false]
      )
    } else {
      // Use Supabase
      const supabase = await createClient()

      // Update github_accounts table with bucket_name
      await supabase
        .from('github_accounts')
        .update({ bucket_name: bucketName })
        .eq('id', accountId)

      // Insert or update account_buckets table
      await supabase
        .from('account_buckets')
        .upsert({
          github_account_id: accountId,
          bucket_name: bucketName,
          bucket_type: bucketType,
          region: region || null,
          is_public: false,
        }, {
          onConflict: 'github_account_id',
        })
    }

    const bucketInfo: BucketInfo = {
      bucket_name: bucketName,
      bucket_type: bucketType,
      region,
      is_public: false,
    }

    return { success: true, bucket: bucketInfo }
  } catch (error: any) {
    console.error('Error creating bucket for account:', error)
    return {
      success: false,
      error: error.message || 'Failed to create bucket',
    }
  }
}

/**
 * Get bucket info for an account
 * @param accountId - GitHub account ID
 * @returns Bucket info or null if not found
 */
export async function getBucketForAccount(
  accountId: string
): Promise<BucketInfo | null> {
  try {
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      const result = await query(
        `SELECT bucket_name, bucket_type, region, is_public
         FROM account_buckets
         WHERE github_account_id = $1`,
        [accountId]
      )

      if (result.rows.length === 0) return null

      const row = result.rows[0]
      return {
        bucket_name: row.bucket_name,
        bucket_type: row.bucket_type,
        region: row.region,
        is_public: row.is_public,
      }
    } else {
      const supabase = await createClient()

      const { data, error } = await supabase
        .from('account_buckets')
        .select('bucket_name, bucket_type, region, is_public')
        .eq('github_account_id', accountId)
        .single()

      if (error || !data) return null

      return {
        bucket_name: data.bucket_name,
        bucket_type: data.bucket_type as 's3' | 'supabase',
        region: data.region || undefined,
        is_public: data.is_public || false,
      }
    }
  } catch (error) {
    console.error('Error getting bucket for account:', error)
    return null
  }
}

/**
 * Delete a bucket for an account
 * @param accountId - GitHub account ID
 * @param userId - User ID who owns the account
 * @returns Success status
 */
export async function deleteBucketForAccount(
  accountId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const bucketInfo = await getBucketForAccount(accountId)
    if (!bucketInfo) {
      return { success: true } // Bucket doesn't exist, consider it deleted
    }

    let deleteResult: { success: boolean; error?: string }

    if (bucketInfo.bucket_type === 's3') {
      const awsCredentials = await getUserAWSCredentials(userId)
      if (!awsCredentials) {
        return {
          success: false,
          error: 'AWS credentials not found for bucket deletion',
        }
      }

      deleteResult = await awsS3.deleteS3Bucket(bucketInfo.bucket_name, awsCredentials)
    } else {
      deleteResult = await supabaseStorage.deleteSupabaseBucket(bucketInfo.bucket_name)
    }

    if (!deleteResult.success) {
      return deleteResult
    }

    // Remove bucket info from database
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    if (isUsingNeon) {
      await query(
        `DELETE FROM account_buckets WHERE github_account_id = $1`,
        [accountId]
      )
      await query(
        `UPDATE github_accounts SET bucket_name = NULL WHERE id = $1`,
        [accountId]
      )
    } else {
      const supabase = await createClient()

      await supabase
        .from('account_buckets')
        .delete()
        .eq('github_account_id', accountId)

      await supabase
        .from('github_accounts')
        .update({ bucket_name: null })
        .eq('id', accountId)
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting bucket for account:', error)
    return {
      success: false,
      error: error.message || 'Failed to delete bucket',
    }
  }
}

/**
 * Ensure a bucket exists for an account, creating it if missing
 * @param accountId - GitHub account ID
 * @param userId - User ID who owns the account
 * @returns Bucket info
 */
export async function ensureBucketExists(
  accountId: string,
  userId: string
): Promise<{ success: boolean; bucket?: BucketInfo; error?: string }> {
  try {
    // Check if bucket already exists
    const existingBucket = await getBucketForAccount(accountId)
    if (existingBucket) {
      return { success: true, bucket: existingBucket }
    }

    // Get account info
    const account = await getUserGitHubAccount(userId, accountId)
    if (!account) {
      return {
        success: false,
        error: 'GitHub account not found',
      }
    }

    // Create bucket
    return await createBucketForAccount(accountId, account.account_name, userId)
  } catch (error: any) {
    console.error('Error ensuring bucket exists:', error)
    return {
      success: false,
      error: error.message || 'Failed to ensure bucket exists',
    }
  }
}


