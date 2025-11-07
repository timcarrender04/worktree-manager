import { Pool } from 'pg'

const userId = 'e0afe560-1d31-4ab8-a5c1-0042a99966d3'
const email = 'tim.carrender@outlook.com'

async function makeSuperAdmin() {
  console.log('🔐 Making user super admin in both apps...')
  console.log(`User ID: ${userId}`)
  console.log(`Email: ${email}\n`)

  // 1. worktree-manager (Supabase - localhost:5433)
  console.log('📦 Setting up super admin in worktree-manager (Supabase)...')
  const worktreePool = new Pool({
    host: 'localhost',
    port: 5433,
    database: 'repo_hub',
    user: 'postgres',
    password: 'postgres',
  })

  try {
    // Check if user exists in auth.users
    const userCheck = await worktreePool.query(
      'SELECT id FROM auth.users WHERE id = $1',
      [userId]
    )

    if (userCheck.rows.length === 0) {
      console.log('⚠️  User not found in auth.users, creating...')
      // Create user in auth.users
      await worktreePool.query(
        `INSERT INTO auth.users (id, email, email_confirmed_at, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [userId, email]
      )
    }

    // Insert or update user_roles (id will be auto-generated)
    await worktreePool.query(
      `INSERT INTO user_roles (id, user_id, is_super_admin, created_at, updated_at)
       VALUES (uuid_generate_v4(), $1, true, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET is_super_admin = true, updated_at = NOW()`,
      [userId]
    )
    console.log('✅ Super admin role set in worktree-manager\n')
  } catch (error: any) {
    console.error('❌ Error in worktree-manager:', error.message)
    console.error(error)
  } finally {
    await worktreePool.end()
  }

  // 2. project-tim (Neon database)
  console.log('📦 Setting up super admin in project-tim (Neon)...')
  
  // Get DATABASE_URL from project-tim .env
  const projectTimEnv = process.env.DATABASE_URL || 
    'postgresql://neondb_owner:npg_S8RNJ3QkCpsY@ep-patient-meadow-a40e0xcs-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require'
  
  const projectTimPool = new Pool({
    connectionString: projectTimEnv,
  })

  try {
    // Check if user exists
    const userCheck = await projectTimPool.query(
      'SELECT id FROM users WHERE id = $1',
      [userId]
    )

    if (userCheck.rows.length === 0) {
      console.log('⚠️  User not found in users table, creating...')
      // Create user
      await projectTimPool.query(
        `INSERT INTO users (id, email, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [userId, email]
      )
    }

    // Insert or update user_roles
    await projectTimPool.query(
      `INSERT INTO user_roles (user_id, is_super_admin, created_at, updated_at)
       VALUES ($1, true, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET is_super_admin = true, updated_at = NOW()`,
      [userId]
    )
    console.log('✅ Super admin role set in project-tim\n')
  } catch (error: any) {
    console.error('❌ Error in project-tim:', error.message)
    console.error(error)
  } finally {
    await projectTimPool.end()
  }

  console.log('✅ Super admin setup complete!')
}

makeSuperAdmin().catch(console.error)

