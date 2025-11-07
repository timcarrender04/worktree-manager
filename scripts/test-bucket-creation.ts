#!/usr/bin/env tsx
/**
 * Test script to create buckets for existing GitHub accounts
 * This bypasses API authentication and directly uses the service functions
 */

import { createBucketForAccount, getBucketForAccount } from '../lib/buckets/service'
import { query } from '../lib/db/client'

async function testBucketCreation() {
  console.log('=========================================')
  console.log('Testing Bucket Creation for GitHub Accounts')
  console.log('=========================================\n')

  try {
    // Get all GitHub accounts from database
    console.log('1. Fetching GitHub accounts from database...')
    const accountsResult = await query(
      `SELECT id, account_name, github_username, user_id 
       FROM github_accounts 
       ORDER BY created_at DESC 
       LIMIT 10`
    )

    if (accountsResult.rows.length === 0) {
      console.log('❌ No GitHub accounts found in database')
      return
    }

    console.log(`✓ Found ${accountsResult.rows.length} account(s)\n`)

    // Test creating buckets for each account
    for (const account of accountsResult.rows) {
      const accountId = account.id
      const accountName = account.account_name
      const userId = account.user_id

      console.log(`2. Testing bucket creation for account: ${accountName} (${accountId})`)
      console.log('----------------------------------------')

      // Check if bucket already exists
      const existingBucket = await getBucketForAccount(accountId)
      if (existingBucket) {
        console.log(`✓ Bucket already exists:`)
        console.log(`  - Bucket Name: ${existingBucket.bucket_name}`)
        console.log(`  - Bucket Type: ${existingBucket.bucket_type}`)
        if (existingBucket.region) {
          console.log(`  - Region: ${existingBucket.region}`)
        }
        console.log('')
        continue
      }

      // Create bucket
      console.log('Creating bucket...')
      const result = await createBucketForAccount(accountId, accountName, userId)

      if (result.success && result.bucket) {
        console.log(`✅ Bucket created successfully!`)
        console.log(`   - Bucket Name: ${result.bucket.bucket_name}`)
        console.log(`   - Bucket Type: ${result.bucket.bucket_type}`)
        if (result.bucket.region) {
          console.log(`   - Region: ${result.bucket.region}`)
        }
      } else {
        console.log(`❌ Failed to create bucket: ${result.error || 'Unknown error'}`)
      }
      console.log('')
    }

    // Verify buckets in database
    console.log('3. Verifying buckets in database...')
    console.log('----------------------------------------')
    const bucketsResult = await query(
      `SELECT 
        ab.github_account_id,
        ab.bucket_name,
        ab.bucket_type,
        ab.region,
        ga.account_name
       FROM account_buckets ab
       JOIN github_accounts ga ON ab.github_account_id = ga.id
       ORDER BY ab.created_at DESC`
    )

    if (bucketsResult.rows.length === 0) {
      console.log('⚠️  No buckets found in account_buckets table')
    } else {
      console.log(`✓ Found ${bucketsResult.rows.length} bucket(s):`)
      bucketsResult.rows.forEach((row: any) => {
        console.log(`   - ${row.account_name}: ${row.bucket_name} (${row.bucket_type})`)
      })
    }

    console.log('\n=========================================')
    console.log('Test Complete')
    console.log('=========================================')
  } catch (error: any) {
    console.error('❌ Error during test:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

// Run the test
testBucketCreation()
  .then(() => {
    console.log('\n✅ Test completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  })



