// GET /api/server-time
//
// Ported from the inline closure in routes/api.php. Note this endpoint returns a
// RAW body — it is deliberately NOT wrapped in the success envelope.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ server_time_ms: Math.round(Date.now()) });
}
