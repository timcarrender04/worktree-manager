import { S3Client, CreateBucketCommand, HeadBucketCommand, DeleteBucketCommand, PutBucketPolicyCommand, type BucketLocationConstraint } from '@aws-sdk/client-s3'
import type { AWSCredentials } from '@/lib/credentials/helpers'

/**
 * Create an S3 bucket
 * @param bucketName - Name of the bucket to create
 * @param region - AWS region (default: us-east-1)
 * @param credentials - AWS credentials
 * @returns True if bucket was created successfully, false otherwise
 */
export async function createS3Bucket(
  bucketName: string,
  region: string,
  credentials: AWSCredentials
): Promise<{ success: boolean; error?: string }> {
  try {
    const s3Client = new S3Client({
      region: region || credentials.region || 'us-east-1',
      credentials: {
        accessKeyId: credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
      },
    })

    // Check if bucket already exists
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }))
      return { success: true } // Bucket already exists
    } catch (error: any) {
      // If error is 404, bucket doesn't exist and we can create it
      if (error.name !== 'NotFound' && error.$metadata?.httpStatusCode !== 404) {
        throw error
      }
    }

    // Create the bucket
    const createCommand = new CreateBucketCommand({
      Bucket: bucketName,
      // For regions other than us-east-1, specify LocationConstraint
      ...(region && region !== 'us-east-1' && {
        CreateBucketConfiguration: {
          LocationConstraint: region as BucketLocationConstraint,
        },
      }),
    })

    await s3Client.send(createCommand)

    // Set a basic bucket policy to make it private (optional)
    try {
      const bucketPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AddPerm',
            Effect: 'Allow',
            Principal: {
              AWS: '*',
            },
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${bucketName}/*`,
          },
        ],
      }

      await s3Client.send(
        new PutBucketPolicyCommand({
          Bucket: bucketName,
          Policy: JSON.stringify(bucketPolicy),
        })
      )
    } catch (policyError) {
      // Bucket policy is optional, log but don't fail
      console.warn('Failed to set bucket policy:', policyError)
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error creating S3 bucket:', error)
    return {
      success: false,
      error: error.message || 'Failed to create S3 bucket',
    }
  }
}

/**
 * Check if an S3 bucket exists
 * @param bucketName - Name of the bucket to check
 * @param credentials - AWS credentials
 * @returns True if bucket exists, false otherwise
 */
export async function bucketExists(
  bucketName: string,
  credentials: AWSCredentials
): Promise<boolean> {
  try {
    const s3Client = new S3Client({
      region: credentials.region || 'us-east-1',
      credentials: {
        accessKeyId: credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
      },
    })

    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }))
    return true
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false
    }
    // Re-throw other errors
    throw error
  }
}

/**
 * Delete an S3 bucket
 * @param bucketName - Name of the bucket to delete
 * @param credentials - AWS credentials
 * @returns True if bucket was deleted successfully, false otherwise
 */
export async function deleteS3Bucket(
  bucketName: string,
  credentials: AWSCredentials
): Promise<{ success: boolean; error?: string }> {
  try {
    const s3Client = new S3Client({
      region: credentials.region || 'us-east-1',
      credentials: {
        accessKeyId: credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
      },
    })

    // Note: Bucket must be empty before deletion
    // This function doesn't delete objects - caller should handle that
    await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }))

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting S3 bucket:', error)
    return {
      success: false,
      error: error.message || 'Failed to delete S3 bucket',
    }
  }
}

