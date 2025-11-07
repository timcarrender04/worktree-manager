import { Pool } from 'pg'

const userId = 'e0afe560-1d31-4ab8-a5c1-0042a99966d3'

async function verifySuperAdmin() {
  console.log('🔍 Verifying super admin status...\n')

  // 1. worktree-manager (Supabase)
  console.log('📦 Checking worktree-manager (Supabase)...')
  const worktreePool = new Pool({
    host: 'localhost',
    port: 5433,
    database: 'repo_hub',
    user: 'postgres',
    password: 'postgres',
  })

  try {
    const result = await worktreePool.query(
      `SELECT ur.user_id, ur.is_super_admin, u.email
       FROM user_roles ur
       JOIN auth.users u ON u.id = ur.user_id
       WHERE ur.user_id = $1`,
      [userId]
    )
    
    if (result.rows.length > 0) {
      const row = result.rows[0]
      console.log(`  ✅ User: ${row.email}`)
      console.log(`  ✅ Super Admin: ${row.is_super_admin ? 'Yes' : 'No'}`)
    } else {
      console.log('  ❌ User role not found')
    }
  } catch (error: any) {
    console.error('  ❌ Error:', error.message)
  } finally {
    await worktreePool.end()
  }

  // 2. project-tim (Neon)
  console.log('\n📦 Checking project-tim (Neon)...')
  const projectTimPool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_S8RNJ3QkCpsY@ep-patient-meadow-a40e0xcs-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require',
  })

  try {
    const result = await projectTimPool.query(
      `SELECT ur.user_id, ur.is_super_admin, u.email
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
       WHERE ur.user_id = $1`,
      [userId]
    )
    
    if (result.rows.length > 0) {
      const row = result.rows[0]
      console.log(`  ✅ User: ${row.email}`)
      console.log(`  ✅ Super Admin: ${row.is_super_admin ? 'Yes' : 'No'}`)
    } else {
      console.log('  ❌ User role not found')
    }
  } catch (error: any) {
    console.error('  ❌ Error:', error.message)
  } finally {
    await projectTimPool.end()
  }
}

verifySuperAdmin().catch(console.error)

