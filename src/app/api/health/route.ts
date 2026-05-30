import { NextResponse } from 'next/server';

// Healthcheck endpoint pour Docker/Coolify HEALTHCHECK.
// Retourne 200 si l'app boote correctement, peu importe l'état DB/storage.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
  });
}
