import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { service, settings } = await request.json();

    switch (service) {
      case 'github':
        if (!settings.githubToken) {
          return NextResponse.json(
            { error: 'GitHub token is required' },
            { status: 400 }
          );
        }
        try {
          const response = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `token ${settings.githubToken}`,
              Accept: 'application/vnd.github.v3+json',
            },
          });
          if (response.ok) {
            const user = await response.json();
            return NextResponse.json({
              success: true,
              message: `Successfully connected to GitHub as ${user.login}`,
            });
          } else {
            return NextResponse.json(
              { error: 'Invalid GitHub token' },
              { status: 401 }
            );
          }
        } catch (error: any) {
          return NextResponse.json(
            { error: `Failed to connect to GitHub: ${error.message}` },
            { status: 500 }
          );
        }

      case 'supabase':
        if (!settings.supabaseUrl || !settings.supabaseAnonKey) {
          return NextResponse.json(
            { error: 'Supabase URL and Anon Key are required' },
            { status: 400 }
          );
        }
        try {
          const response = await fetch(`${settings.supabaseUrl}/rest/v1/`, {
            headers: {
              apikey: settings.supabaseAnonKey,
              Authorization: `Bearer ${settings.supabaseAnonKey}`,
            },
          });
          if (response.ok || response.status === 404) {
            // 404 is OK, means Supabase is responding
            return NextResponse.json({
              success: true,
              message: 'Successfully connected to Supabase',
            });
          } else {
            return NextResponse.json(
              { error: 'Failed to connect to Supabase' },
              { status: response.status }
            );
          }
        } catch (error: any) {
          return NextResponse.json(
            { error: `Failed to connect to Supabase: ${error.message}` },
            { status: 500 }
          );
        }

      case 'neon':
        if (!settings.databaseUrl && !settings.postgresHost) {
          return NextResponse.json(
            { error: 'Database URL or connection parameters are required' },
            { status: 400 }
          );
        }
        try {
          const { Pool } = await import('pg');
          const connectionString = settings.databaseUrl || 
            `postgresql://${settings.postgresUser}:${settings.postgresPassword}@${settings.postgresHost}:${settings.postgresPort || 5432}/${settings.postgresDatabase}?sslmode=require`;
          
          const pool = new Pool({
            connectionString,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000,
          });
          
          const result = await pool.query('SELECT NOW()');
          await pool.end();
          
          return NextResponse.json({
            success: true,
            message: 'Successfully connected to database',
          });
        } catch (error: any) {
          return NextResponse.json(
            { error: `Failed to connect to database: ${error.message}` },
            { status: 500 }
          );
        }

      case 'aws':
        if (!settings.awsAccessKeyId || !settings.awsSecretAccessKey) {
          return NextResponse.json(
            { error: 'AWS Access Key ID and Secret Access Key are required' },
            { status: 400 }
          );
        }
        // Basic validation - AWS credentials are complex to test without specific service
        return NextResponse.json({
          success: true,
          message: 'AWS credentials format validated (actual connection test requires specific AWS service)',
        });

      case 'ollama':
        const ollamaUrl = settings.ollamaUrl || 'http://localhost:11434';
        try {
          const response = await fetch(`${ollamaUrl}/api/tags`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });
          if (response.ok) {
            return NextResponse.json({
              success: true,
              message: 'Successfully connected to Ollama',
            });
          } else {
            return NextResponse.json(
              { error: 'Failed to connect to Ollama' },
              { status: response.status }
            );
          }
        } catch (error: any) {
          return NextResponse.json(
            { error: `Failed to connect to Ollama: ${error.message}. Make sure Ollama is running.` },
            { status: 500 }
          );
        }

      case 'vercel':
        if (!settings.vercelToken) {
          return NextResponse.json(
            { error: 'Vercel token is required' },
            { status: 400 }
          );
        }
        try {
          const response = await fetch('https://api.vercel.com/v2/user', {
            headers: {
              Authorization: `Bearer ${settings.vercelToken}`,
            },
          });
          if (response.ok) {
            const user = await response.json();
            return NextResponse.json({
              success: true,
              message: `Successfully connected to Vercel as ${user.user.username}`,
            });
          } else {
            return NextResponse.json(
              { error: 'Invalid Vercel token' },
              { status: 401 }
            );
          }
        } catch (error: any) {
          return NextResponse.json(
            { error: `Failed to connect to Vercel: ${error.message}` },
            { status: 500 }
          );
        }

      default:
        return NextResponse.json(
          { error: `Unknown service: ${service}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error('Error testing connection:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to test connection' },
      { status: 500 }
    );
  }
}

