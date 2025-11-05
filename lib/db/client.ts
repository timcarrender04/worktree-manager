import { Pool, PoolClient } from 'pg'

let pool: Pool | null = null

function getDatabaseUrl(): string {
  // Use DATABASE_URL from environment, or construct from individual variables
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }

  // Fallback to constructing from individual variables
  const host = process.env.PGHOST || process.env.POSTGRES_HOST
  const port = process.env.PGPORT || process.env.POSTGRES_PORT || '5432'
  const database = process.env.PGDATABASE || process.env.POSTGRES_DATABASE
  const user = process.env.PGUSER || process.env.POSTGRES_USER
  const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD

  if (!host || !database || !user || !password) {
    throw new Error(
      'Database connection configuration missing. Please set DATABASE_URL or individual database variables.'
    )
  }

  return `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=require`
}

export function getPool(): Pool {
  if (!pool) {
    let connectionString = getDatabaseUrl()
    
    // Remove channel_binding parameter if present (pg library doesn't support it)
    // Neon connection strings may include it, but we handle SSL via the ssl config option
    connectionString = connectionString.replace(/[&?]channel_binding=[^&]*/gi, '')
    
    // Detect if connecting to Neon (check for neon.tech or ep- in connection string)
    const isNeon = connectionString.includes('neon.tech') || connectionString.includes('ep-')
    
    // Neon and Vercel require SSL connections
    // For Neon, we need SSL even in development
    const sslConfig = isNeon || process.env.NODE_ENV === 'production' || process.env.VERCEL
      ? { rejectUnauthorized: false }
      : false
    
    pool = new Pool({
      connectionString,
      ssl: sslConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
    
    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected database pool error', err)
    })
  }
  return pool
}

export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<{ rows: T[]; rowCount: number }> {
  const pool = getPool()
  const start = Date.now()
  try {
    const res = await pool.query(text, params)
    const duration = Date.now() - start
    
    if (process.env.NODE_ENV === 'development' || duration > 1000) {
      console.log('Executed query', { text: text.substring(0, 50), duration, rows: res.rowCount ?? 0 })
    }
    
    return {
      rows: res.rows,
      rowCount: res.rowCount ?? 0
    }
  } catch (error) {
    console.error('Database query error', { 
      text: text.substring(0, 100), 
      error: error instanceof Error ? error.message : error 
    })
    throw error
  }
}

export async function getClient(): Promise<PoolClient> {
  const pool = getPool()
  return pool.connect()
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
