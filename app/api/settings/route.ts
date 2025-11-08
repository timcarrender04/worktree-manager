import { NextResponse } from 'next/server';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SETTINGS_FILE = join(process.cwd(), '.settings.json');

export async function GET() {
  try {
    // Return current environment variables (sanitized)
    const settings = {
      githubToken: process.env.GITHUB_TOKEN || '',
      githubOrg: process.env.GITHUB_ORG || '',
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      databaseUrl: process.env.DATABASE_URL ? '***' : '', // Don't expose full URL
      postgresHost: process.env.PGHOST || process.env.POSTGRES_HOST || '',
      postgresPort: process.env.PGPORT || process.env.POSTGRES_PORT || '5432',
      postgresDatabase: process.env.PGDATABASE || process.env.POSTGRES_DATABASE || '',
      postgresUser: process.env.PGUSER || process.env.POSTGRES_USER || '',
      postgresPassword: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD ? '***' : '',
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ? '***' : '',
      awsRegion: process.env.AWS_REGION || '',
      repoRoot: process.env.REPO_ROOT || '',
      hostRepoRoot: process.env.HOST_REPO_ROOT || '',
      worktreeRoot: process.env.WORKTREE_ROOT || process.env.TREE_LOCATION || '',
      ollamaUrl: process.env.OLLAMA_URL || 'https://ollama.timcarrender.me/',
      vercelToken: process.env.VERCEL_TOKEN || '',
      vercelOrgId: process.env.VERCEL_ORG_ID || '',
      vercelProjectId: process.env.VERCEL_PROJECT_ID || '',
    };

    // Also try to load from settings file if it exists
    if (existsSync(SETTINGS_FILE)) {
      try {
        const fileSettings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
        // Merge with env vars (env vars take precedence)
        Object.keys(fileSettings).forEach((key) => {
          if (!settings[key as keyof typeof settings]) {
            settings[key as keyof typeof settings] = fileSettings[key];
          }
        });
      } catch (error) {
        console.error('Failed to read settings file:', error);
      }
    }

    return NextResponse.json(settings);
  } catch (error: any) {
    console.error('Error loading settings:', error);
    return NextResponse.json(
      { error: 'Failed to load settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Save settings to file (for reference, but note: env vars take precedence)
    writeFileSync(SETTINGS_FILE, JSON.stringify(body, null, 2), 'utf-8');

    // Generate .env.local content
    const envContent = [
      '# Generated from Settings UI',
      '# Note: Restart the server after making changes',
      '',
      '# GitHub',
      body.githubToken && `GITHUB_TOKEN=${body.githubToken}`,
      body.githubOrg && `GITHUB_ORG=${body.githubOrg}`,
      '',
      '# Supabase',
      body.supabaseUrl && `NEXT_PUBLIC_SUPABASE_URL=${body.supabaseUrl}`,
      body.supabaseAnonKey && `NEXT_PUBLIC_SUPABASE_ANON_KEY=${body.supabaseAnonKey}`,
      body.supabaseServiceRoleKey && `SUPABASE_SERVICE_ROLE_KEY=${body.supabaseServiceRoleKey}`,
      '',
      '# Neon/PostgreSQL',
      body.databaseUrl && `DATABASE_URL=${body.databaseUrl}`,
      body.postgresHost && `PGHOST=${body.postgresHost}`,
      body.postgresPort && `PGPORT=${body.postgresPort}`,
      body.postgresDatabase && `PGDATABASE=${body.postgresDatabase}`,
      body.postgresUser && `PGUSER=${body.postgresUser}`,
      body.postgresPassword && `PGPASSWORD=${body.postgresPassword}`,
      '',
      '# AWS',
      body.awsAccessKeyId && `AWS_ACCESS_KEY_ID=${body.awsAccessKeyId}`,
      body.awsSecretAccessKey && `AWS_SECRET_ACCESS_KEY=${body.awsSecretAccessKey}`,
      body.awsRegion && `AWS_REGION=${body.awsRegion}`,
      '',
      '# Repository Paths',
      body.repoRoot && `REPO_ROOT=${body.repoRoot}`,
      body.hostRepoRoot && `HOST_REPO_ROOT=${body.hostRepoRoot}`,
      body.worktreeRoot && `WORKTREE_ROOT=${body.worktreeRoot}`,
      '',
      '# AI (Ollama)',
      body.ollamaUrl && `OLLAMA_URL=${body.ollamaUrl}`,
      '',
      '# Vercel (Optional)',
      body.vercelToken && `VERCEL_TOKEN=${body.vercelToken}`,
      body.vercelOrgId && `VERCEL_ORG_ID=${body.vercelOrgId}`,
      body.vercelProjectId && `VERCEL_PROJECT_ID=${body.vercelProjectId}`,
    ]
      .filter(Boolean)
      .join('\n');

    // Write to .env.local
    const envFile = join(process.cwd(), '.env.local');
    writeFileSync(envFile, envContent, 'utf-8');

    return NextResponse.json({ 
      success: true, 
      message: 'Settings saved. Please restart the server for changes to take effect.',
      note: 'Settings have been written to .env.local. You must restart the Next.js server for environment variable changes to take effect.'
    });
  } catch (error: any) {
    console.error('Error saving settings:', error);
    return NextResponse.json(
      { error: 'Failed to save settings', details: error.message },
      { status: 500 }
    );
  }
}

