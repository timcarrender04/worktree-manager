import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

async function setupSuperAdmin() {
  const email = 'tim.carrender@gmail.com'
  const password = 'Jayson09!!'
  
  console.log('🔐 Setting up super admin user...')
  console.log(`Email: ${email}`)
  
  // Use direct PostgreSQL connection for scripts
  const pool = new Pool({
    host: 'localhost',
    port: 5433,
    database: 'repo_hub',
    user: 'postgres',
    password: 'postgres',
  })
  
  const hashedPassword = await hashPassword(password)
  
  // Check if user exists
  const userResult = await pool.query(
    'SELECT id, email FROM users WHERE email = $1',
    [email.toLowerCase()]
  )
  
  if (userResult.rows.length > 0) {
    // Update password and ensure super admin role
    console.log('📝 Updating existing user...')
    const userId = userResult.rows[0].id
    
    await pool.query(
      'UPDATE users SET password = $1 WHERE id = $2',
      [hashedPassword, userId]
    )
    
    // Ensure super admin role exists
    const roleResult = await pool.query(
      'SELECT id FROM user_roles WHERE user_id = $1',
      [userId]
    )
    
    if (roleResult.rows.length === 0) {
      await pool.query(
        'INSERT INTO user_roles (user_id, is_super_admin) VALUES ($1, $2)',
        [userId, true]
      )
      console.log('✅ Super admin role created')
    } else {
      await pool.query(
        'UPDATE user_roles SET is_super_admin = $1 WHERE user_id = $2',
        [true, userId]
      )
      console.log('✅ Super admin role updated')
    }
    
    console.log('✅ User updated successfully')
  } else {
    // Create new user
    console.log('➕ Creating new user...')
    
    const newUserResult = await pool.query(
      `INSERT INTO users (email, password, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [email.toLowerCase(), hashedPassword, 'Tim Carrender']
    )
    
    const userId = newUserResult.rows[0].id
    
    // Create super admin role
    await pool.query(
      'INSERT INTO user_roles (user_id, is_super_admin) VALUES ($1, $2)',
      [userId, true]
    )
    
    console.log('✅ User and super admin role created successfully')
  }
  
  await pool.end()
  
  console.log('')
  console.log('✅ Super admin setup complete!')
  console.log(`   Email: ${email}`)
  console.log(`   Password: ${password}`)
  console.log('')
}

setupSuperAdmin().catch(console.error)

