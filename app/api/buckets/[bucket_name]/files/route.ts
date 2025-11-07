import { NextResponse } from 'next/server'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'
import { getUserAWSCredentials, getAuthenticatedUserId } from '@/lib/credentials/helpers'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/buckets/[bucket_name]/files
 * List all files in a bucket
 * Query params: prefix (optional) - filter files by path prefix
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bucket_name: string }> }
) {
  try {
    const { bucket_name } = await params
    const { searchParams } = new URL(request.url)
    const prefix = searchParams.get('prefix') || ''

    // Get authenticated user
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find bucket by name - need to search account_buckets table
    const isUsingNeon = !!process.env.DATABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL

    let bucketInfo: { bucket_name: string; bucket_type: 's3' | 'supabase'; region?: string; github_account_id: string } | null = null

    if (isUsingNeon) {
      const result = await query(
        `SELECT bucket_name, bucket_type, region, github_account_id
         FROM account_buckets
         WHERE bucket_name = $1`,
        [bucket_name]
      )

      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Bucket not found' }, { status: 404 })
      }

      const row = result.rows[0]
      // Verify the bucket belongs to a GitHub account owned by the user
      const accountResult = await query(
        `SELECT user_id FROM github_accounts WHERE id = $1`,
        [row.github_account_id]
      )

      if (accountResult.rows.length === 0 || accountResult.rows[0].user_id !== userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      bucketInfo = {
        bucket_name: row.bucket_name,
        bucket_type: row.bucket_type,
        region: row.region || undefined,
        github_account_id: row.github_account_id,
      }
    } else {
      const supabase = await createClient()
      const { data: bucketData, error: bucketError } = await supabase
        .from('account_buckets')
        .select('bucket_name, bucket_type, region, github_account_id')
        .eq('bucket_name', bucket_name)
        .single()

      if (bucketError || !bucketData) {
        return NextResponse.json({ error: 'Bucket not found' }, { status: 404 })
      }

      // Verify ownership
      const { data: accountData } = await supabase
        .from('github_accounts')
        .select('user_id')
        .eq('id', bucketData.github_account_id)
        .single()

      if (!accountData || accountData.user_id !== userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      bucketInfo = {
        bucket_name: bucketData.bucket_name,
        bucket_type: bucketData.bucket_type as 's3' | 'supabase',
        region: bucketData.region || undefined,
        github_account_id: bucketData.github_account_id,
      }
    }

    if (!bucketInfo) {
      return NextResponse.json({ error: 'Bucket not found' }, { status: 404 })
    }

    // List files based on bucket type
    if (bucketInfo.bucket_type === 's3') {
      // Get AWS credentials
      const awsCredentials = await getUserAWSCredentials(userId)
      if (!awsCredentials) {
        return NextResponse.json({ error: 'AWS credentials not found' }, { status: 500 })
      }

      const s3Client = new S3Client({
        region: bucketInfo.region || awsCredentials.region || 'us-east-1',
        credentials: {
          accessKeyId: awsCredentials.access_key_id,
          secretAccessKey: awsCredentials.secret_access_key,
        },
      })

      const listCommand = new ListObjectsV2Command({
        Bucket: bucket_name,
        Prefix: prefix,
      })

      const response = await s3Client.send(listCommand)

      const files = (response.Contents || []).map((object) => ({
        name: object.Key || '',
        size: object.Size || 0,
        lastModified: object.LastModified?.toISOString() || new Date().toISOString(),
        etag: object.ETag || '',
      }))

      return NextResponse.json({
        bucket: bucket_name,
        prefix,
        count: files.length,
        files,
      })
    } else {
      // Supabase Storage
      const supabase = createServiceRoleClient()

      const { data: files, error } = await supabase.storage
        .from(bucket_name)
        .list(prefix || '', {
          limit: 1000,
          offset: 0,
          sortBy: { column: 'name', order: 'asc' },
        })

      if (error) {
        console.error('Error listing Supabase Storage files:', error)
        return NextResponse.json(
          { error: error.message || 'Failed to list files' },
          { status: 500 }
        )
      }

      const fileList = (files || []).map((file) => ({
        name: file.name,
        size: file.metadata?.size || 0,
        lastModified: file.updated_at || file.created_at || new Date().toISOString(),
        id: file.id,
      }))

      return NextResponse.json({
        bucket: bucket_name,
        prefix,
        count: fileList.length,
        files: fileList,
      })
    }
  } catch (error: any) {
    console.error('Error in GET /api/buckets/[bucket_name]/files:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

