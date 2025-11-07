import { NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { query } from '@/lib/db/client'
import { getUserAWSCredentials, getAuthenticatedUserId } from '@/lib/credentials/helpers'
import { createClient } from '@/lib/supabase/server'

/**
 * GET /api/buckets/[bucket_name]/files/[...path]
 * Download a specific file from a bucket
 * Path can contain slashes for nested files
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bucket_name: string; path: string[] }> }
) {
  try {
    const { bucket_name, path: pathArray } = await params
    // Join path array to handle nested paths
    const filePath = Array.isArray(pathArray) ? pathArray.join('/') : pathArray

    // Get authenticated user
    const userId = await getAuthenticatedUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find bucket by name
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
      // Verify ownership
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

    // Download file based on bucket type
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

      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket_name,
        Key: filePath,
      })

      try {
        const response = await s3Client.send(getObjectCommand)

        // Get content type
        const contentType = response.ContentType || 'application/octet-stream'
        const contentLength = response.ContentLength || 0

        // Convert stream to buffer
        const chunks: Uint8Array[] = []
        if (response.Body) {
          for await (const chunk of response.Body as any) {
            chunks.push(chunk)
          }
        }
        const buffer = Buffer.concat(chunks)

        // Return file with appropriate headers
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': contentLength.toString(),
            'Content-Disposition': `attachment; filename="${filePath.split('/').pop()}"`,
          },
        })
      } catch (s3Error: any) {
        if (s3Error.name === 'NoSuchKey' || s3Error.$metadata?.httpStatusCode === 404) {
          return NextResponse.json({ error: 'File not found' }, { status: 404 })
        }
        throw s3Error
      }
    } else {
      // Supabase Storage
      const supabase = createServiceRoleClient()

      const { data: fileData, error: downloadError } = await supabase.storage
        .from(bucket_name)
        .download(filePath)

      if (downloadError || !fileData) {
        console.error('Error downloading from Supabase Storage:', downloadError)
        return NextResponse.json(
          { error: downloadError?.message || 'File not found' },
          { status: downloadError?.statusCode === 404 ? 404 : 500 }
        )
      }

      // Get file metadata for content type
      const { data: fileInfo } = await supabase.storage
        .from(bucket_name)
        .list(filePath.split('/').slice(0, -1).join('/') || '', {
          limit: 1,
          search: filePath.split('/').pop() || '',
        })

      const contentType =
        fileInfo?.[0]?.metadata?.mimetype || 'application/octet-stream'

      // Convert blob to buffer
      const arrayBuffer = await fileData.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
          'Content-Disposition': `attachment; filename="${filePath.split('/').pop()}"`,
        },
      })
    }
  } catch (error: any) {
    console.error('Error in GET /api/buckets/[bucket_name]/files/[...path]:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

