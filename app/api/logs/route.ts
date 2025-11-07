import { NextRequest, NextResponse } from 'next/server';

// Use Kong gateway URL for logs service
// Defaults to http://localhost:8002/logflare (Kong gateway)
// Can be overridden with LOGS_SERVICE_URL environment variable
const LOGS_SERVICE_URL = process.env.LOGS_SERVICE_URL || 'http://localhost:8002/logflare';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sql = searchParams.get('sql');
    const limit = searchParams.get('limit') || '100';
    const iso_timestamp_start = searchParams.get('iso_timestamp_start');
    const iso_timestamp_end = searchParams.get('iso_timestamp_end');

    // Build query parameters
    const params = new URLSearchParams();
    if (sql) params.append('sql', sql);
    params.append('limit', limit);
    if (iso_timestamp_start) params.append('iso_timestamp_start', iso_timestamp_start);
    if (iso_timestamp_end) params.append('iso_timestamp_end', iso_timestamp_end);

    const url = `${LOGS_SERVICE_URL}/api/endpoints/logs.all?${params.toString()}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Logs service returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching logs:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch logs' },
      { status: 500 }
    );
  }
}

