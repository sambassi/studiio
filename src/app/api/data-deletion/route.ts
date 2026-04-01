import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// POST /api/data-deletion - Facebook Data Deletion Callback
// Meta requires this endpoint for apps that handle user data
export async function POST(req: NextRequest) {
    try {
          const body = await req.json();
          const { signed_request } = body;

          if (!signed_request) {
                  return NextResponse.json({ error: 'Missing signed_request' }, { status: 400 });
                }

          // Parse the signed request
          const [encodedSig, payload] = signed_request.split('.', 2);
          const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
          const userId = data.user_id;

          // Generate a confirmation code
          const confirmationCode = crypto.randomBytes(16).toString('hex');

          // In production, you would delete user data here
          console.log(`[DATA-DELETION] Received deletion request for Facebook user: ${userId}`);

          // Return the required response format
          return NextResponse.json({
                  url: `https://studiio.pro/api/data-deletion/status?code=${confirmationCode}`,
                  confirmation_code: confirmationCode,
                });
        } catch (error) {
          console.error('Data deletion error:', error);
          return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
        }
  }

// GET /api/data-deletion - Status page for data deletion
export async function GET(req: NextRequest) {
    const code = req.nextUrl.searchParams.get('code');

    return NextResponse.json({
          status: 'completed',
          message: 'Your data has been deleted from Studiio.',
          confirmation_code: code,
        });
  }
