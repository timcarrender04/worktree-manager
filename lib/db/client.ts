import { Pool, PoolClient } from 'pg'

let pool: Pool | null = null

function getDatabaseUrl(): string {
  // For local Supabase, prefer local connection if Supabase URL is localhost
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const isLocalSupabase = supabaseUrl?.includes('localhost') || supabaseUrl?.includes('127.0.0.1') || supabaseUrl?.includes(':8002')
  
  // If using local Supabase, construct local connection string
  if (isLocalSupabase) {
    const host = process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost'
    const port = process.env.PGPORT || process.env.POSTGRES_PORT || '5433'
    const database = process.env.PGDATABASE || process.env.POSTGRES_DATABASE || 'repo_hub'
    const user = process.env.PGUSER || process.env.POSTGRES_USER || 'postgres'
    const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'postgres'
    
    return `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=disable`
  }
  
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

  // For localhost, don't require SSL
  const isLocalhost = host === 'localhost' || host === '127.0.0.1'
  const sslMode = isLocalhost ? 'disable' : 'require'
  return `postgresql://${user}:${password}@${host}:${port}/${database}?sslmode=${sslMode}`
}

export function getPool(): Pool {
  // Check if we should use local Supabase and recreate pool if needed
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const isLocalSupabase = supabaseUrl?.includes('localhost') || supabaseUrl?.includes('127.0.0.1') || supabaseUrl?.includes(':8002')
  const currentConnectionString = pool ? (pool as any).options?.connectionString : null
  const shouldUseLocal = isLocalSupabase && currentConnectionString?.includes('neon.tech')
  
  // If pool exists but we should be using local, close and recreate
  if (pool && shouldUseLocal) {
    console.log('Recreating database pool for local Supabase')
    pool.end().catch(() => {}) // Close existing pool
    pool = null
  }
  
  if (!pool) {
    let connectionString = getDatabaseUrl()
    
    // Remove channel_binding parameter if present (pg library doesn't support it)
    // Neon connection strings may include it, but we handle SSL via the ssl config option
    connectionString = connectionString.replace(/[&?]channel_binding=[^&]*/gi, '')
    
    // Detect if connecting to Neon (check for neon.tech or ep- in connection string)
    const isNeon = connectionString.includes('neon.tech') || connectionString.includes('ep-')
    
    // Neon and Vercel require SSL connections
    // For Neon, we need SSL even in development
    // Local Supabase doesn't need SSL
    const sslConfig = (isNeon && !isLocalSupabase) || process.env.NODE_ENV === 'production' || process.env.VERCEL
      ? { rejectUnauthorized: false }
      : false
    
    // Neon databases can take longer to wake up from sleep, so use longer timeout
    // Local databases should fail fast
    const connectionTimeout = isNeon && !isLocalSupabase ? 30000 : 5000
    
    pool = new Pool({
      connectionString,
      ssl: sslConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: connectionTimeout,
    })
    
    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected database pool error', {
        message: err.message,
        code: (err as any).code,
        isNeon,
        isLocalSupabase,
      })
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
    
    // Query logging removed
    
    return {
      rows: res.rows,
      rowCount: res.rowCount ?? 0
    }
  } catch (error) {
    const duration = Date.now() - start
    const errorDetails: any = {
      duration,
      error: error instanceof Error ? error.message : String(error),
    }
    
    // Add error code if available
    if (error instanceof Error && (error as any).code) {
      errorDetails.code = (error as any).code
    }
    
    // For timeout errors, provide helpful context
    if (error instanceof Error && ((error as any).code === 'ETIMEDOUT' || error.message.includes('timeout'))) {
      const connectionString = getDatabaseUrl()
      const isNeon = connectionString.includes('neon.tech') || connectionString.includes('ep-')
      errorDetails.message = `Database connection timeout after ${duration}ms`
      if (isNeon) {
        errorDetails.hint = 'Neon database may be paused. It will wake up automatically on the next connection attempt.'
      }
      errorDetails.connectionType = isNeon ? 'Neon' : 'PostgreSQL'
    }
    
    // Log query preview (first 200 chars for better debugging)
    const queryPreview = text.trim().split('\n').slice(0, 5).join('\n').substring(0, 200)
    errorDetails.queryPreview = queryPreview + (text.length > 200 ? '...' : '')
    
    // Log params if present (but limit size for security)
    if (params && params.length > 0) {
      errorDetails.paramCount = params.length
      errorDetails.params = params.slice(0, 3).map((p, i) => ({
        index: i,
        type: typeof p,
        preview: String(p).substring(0, 50)
      }))
    }
    
    console.error('Database query error', errorDetails)
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
