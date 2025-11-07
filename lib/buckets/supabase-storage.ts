import { createServiceRoleClient } from '@/lib/supabase/server'

/**
 * Create a Supabase Storage bucket
 * @param bucketName - Name of the bucket to create
 * @param isPublic - Whether the bucket should be public (default: false)
 * @returns True if bucket was created successfully, false otherwise
 */
export async function createSupabaseBucket(
  bucketName: string,
  isPublic: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServiceRoleClient()

    // Check if bucket already exists
    const { data: existingBuckets, error: listError } = await supabase.storage.listBuckets()

    if (listError) {
      console.error('Error listing buckets:', listError)
      return {
        success: false,
        error: listError.message || 'Failed to list buckets',
      }
    }

    const bucketExists = existingBuckets?.some((bucket) => bucket.name === bucketName)
    if (bucketExists) {
      return { success: true } // Bucket already exists
    }

    // Create the bucket
    const { data, error } = await supabase.storage.createBucket(bucketName, {
      public: isPublic,
      fileSizeLimit: 52428800, // 50MB default
      allowedMimeTypes: null, // Allow all mime types
    })

    if (error) {
      console.error('Error creating Supabase bucket:', error)
      return {
        success: false,
        error: error.message || 'Failed to create Supabase bucket',
      }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error creating Supabase bucket:', error)
    return {
      success: false,
      error: error.message || 'Failed to create Supabase bucket',
    }
  }
}

/**
 * Check if a Supabase Storage bucket exists
 * @param bucketName - Name of the bucket to check
 * @returns True if bucket exists, false otherwise
 */
export async function bucketExists(bucketName: string): Promise<boolean> {
  try {
    const supabase = createServiceRoleClient()

    const { data: buckets, error } = await supabase.storage.listBuckets()

    if (error) {
      console.error('Error listing buckets:', error)
      return false
    }

    return buckets?.some((bucket) => bucket.name === bucketName) || false
  } catch (error) {
    console.error('Error checking bucket existence:', error)
    return false
  }
}

/**
 * Delete a Supabase Storage bucket
 * @param bucketName - Name of the bucket to delete
 * @returns True if bucket was deleted successfully, false otherwise
 */
export async function deleteSupabaseBucket(
  bucketName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServiceRoleClient()

    // Note: Bucket must be empty before deletion
    // This function doesn't delete objects - caller should handle that
    const { error } = await supabase.storage.deleteBucket(bucketName)

    if (error) {
      console.error('Error deleting Supabase bucket:', error)
      return {
        success: false,
        error: error.message || 'Failed to delete Supabase bucket',
      }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error deleting Supabase bucket:', error)
    return {
      success: false,
      error: error.message || 'Failed to delete Supabase bucket',
    }
  }
}



