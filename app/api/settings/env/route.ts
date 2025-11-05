import { NextResponse } from 'next/server';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

// Get the .env file path - use workspace root or project root
function getEnvFilePath(): string {
  // Try to use ENV_FILE_PATH if set, otherwise default to .env in project root
  const envPath = process.env.ENV_FILE_PATH;
  if (envPath) {
    return path.resolve(envPath);
  }
  
  // Default to .env in the project root (worktree-manager directory)
  return path.resolve(process.cwd(), '.env');
}

// Get the .env.local file path
function getEnvLocalFilePath(): string {
  // Try to use ENV_LOCAL_FILE_PATH if set, otherwise default to .env.local in project root
  const envLocalPath = process.env.ENV_LOCAL_FILE_PATH;
  if (envLocalPath) {
    return path.resolve(envLocalPath);
  }
  
  // Default to .env.local in the project root (worktree-manager directory)
  return path.resolve(process.cwd(), '.env.local');
}

// Parse .env file content into key-value pairs
function parseEnvFile(content: string): Array<{ key: string; value: string; comment?: string }> {
  const lines = content.split('\n');
  const envVars: Array<{ key: string; value: string; comment?: string }> = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Skip empty lines
    if (!line) continue;
    
    // Handle comments
    if (line.startsWith('#')) {
      // Store comment with next env var if applicable
      continue;
    }
    
    // Parse key=value
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      envVars.push({ key, value });
    }
  }
  
  return envVars;
}

// Serialize env vars back to .env file format
function serializeEnvFile(envVars: Array<{ key: string; value: string }>): string {
  const lines: string[] = [];
  
  for (const { key, value } of envVars) {
    // Validate key name (alphanumeric + underscores)
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      continue; // Skip invalid keys
    }
    
    // Escape value if needed (contains spaces, special chars, etc.)
    let escapedValue = value;
    if (value.includes(' ') || value.includes('#') || value.includes('=') || value.includes('"')) {
      escapedValue = `"${value.replace(/"/g, '\\"')}"`;
    }
    
    lines.push(`${key}=${escapedValue}`);
  }
  
  return lines.join('\n');
}

// GET - Read .env and .env.local files (merge with .env.local taking precedence)
export async function GET() {
  try {
    const envPath = getEnvFilePath();
    const envLocalPath = getEnvLocalFilePath();
    
    const envVarsMap = new Map<string, { key: string; value: string }>();
    
    // Read .env file first
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      const envVars = parseEnvFile(content);
      envVars.forEach(({ key, value }) => {
        envVarsMap.set(key, { key, value });
      });
    }
    
    // Read .env.local file (overrides .env values)
    if (existsSync(envLocalPath)) {
      const content = readFileSync(envLocalPath, 'utf-8');
      const envVars = parseEnvFile(content);
      envVars.forEach(({ key, value }) => {
        envVarsMap.set(key, { key, value });
      });
    }
    
    const envVars = Array.from(envVarsMap.values());
    
    return NextResponse.json({ envVars });
  } catch (error: any) {
    console.error('Error reading .env files:', error);
    return NextResponse.json(
      { error: `Failed to read .env files: ${error.message}` },
      { status: 500 }
    );
  }
}

// POST - Write/update both .env and .env.local files
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { envVars } = body;
    
    if (!Array.isArray(envVars)) {
      return NextResponse.json(
        { error: 'envVars must be an array' },
        { status: 400 }
      );
    }
    
    // Validate all keys
    for (const envVar of envVars) {
      if (!envVar.key || typeof envVar.key !== 'string') {
        return NextResponse.json(
          { error: 'All env vars must have a valid key' },
          { status: 400 }
        );
      }
      
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(envVar.key)) {
        return NextResponse.json(
          { error: `Invalid key name: ${envVar.key}. Keys must start with a letter or underscore and contain only alphanumeric characters and underscores.` },
          { status: 400 }
        );
      }
      
      if (envVar.value === undefined || envVar.value === null) {
        return NextResponse.json(
          { error: `Value for ${envVar.key} cannot be undefined or null` },
          { status: 400 }
        );
      }
    }
    
    const envPath = getEnvFilePath();
    const envLocalPath = getEnvLocalFilePath();
    const content = serializeEnvFile(envVars);
    
    // Write to both .env and .env.local files
    writeFileSync(envPath, content, 'utf-8');
    writeFileSync(envLocalPath, content, 'utf-8');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Environment variables saved successfully to both .env and .env.local files' 
    });
  } catch (error: any) {
    console.error('Error writing .env files:', error);
    return NextResponse.json(
      { error: `Failed to write .env files: ${error.message}` },
      { status: 500 }
    );
  }
}

