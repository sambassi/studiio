import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';

// POST /api/upload/signed-url — Generate a signed upload URL for direct Supabase Storage upload
// This bypasses Vercel's 4.5MB body size limit for serverless functions
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { filename, contentType, purpose } = await req.json();

    if (!filename || !contentType) {
      return NextResponse.json({ success: false, error: 'Missing filename or contentType' }, { status: 400 });
    }

    const bucket = contentType.startsWith('audio/') ? 'audio' : 'media';
    const timestamp = Date.now();
    const storagePath = `${session.user.id}/${purpose || 'rush'}/${timestamp}-${filename}`;

    // Create a signed upload URL (valid for 2 minutes)
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error) {
      console.error('[SignedUrl] Error creating signed URL:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Also get the public URL for later use
    const { data: urlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(storagePath);

    return NextResponse.json({
      success: true,
      signedUrl: data.signedUrl,
      token: data.token,
      path: storagePath,
      publicUrl: urlData.publicUrl,
      bucket,
    });
  } catch (error) {
    console.error('[SignedUrl] Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to create signed URL' }, { status: 500 });
  }
}
