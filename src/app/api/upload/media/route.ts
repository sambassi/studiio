import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

// Increase Vercel serverless function limits for video uploads
export const maxDuration = 60; // seconds
export const dynamic = 'force-dynamic';

// Max file sizes per type
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;  // 10MB
const MAX_AUDIO_SIZE = 50 * 1024 * 1024;  // 50MB

function getBucket(mimeType: string): string {
  if (mimeType.startsWith('video/')) return 'media';
  if (mimeType.startsWith('image/')) return 'media';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'media';
}

function getMaxSize(mimeType: string): number {
  if (mimeType.startsWith('video/')) return MAX_VIDEO_SIZE;
  if (mimeType.startsWith('image/')) return MAX_IMAGE_SIZE;
  if (mimeType.startsWith('audio/')) return MAX_AUDIO_SIZE;
  return MAX_IMAGE_SIZE;
}

// POST /api/upload/media - Upload a media file to Supabase Storage
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const purpose = formData.get('purpose') as string || 'general'; // rush, music, voiceover, character, thumbnail

    if (!file) {
      return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    }

    const mimeType = file.type;
    const maxSize = getMaxSize(mimeType);

    if (file.size > maxSize) {
      const maxMB = Math.round(maxSize / 1024 / 1024);
      return NextResponse.json(
        { success: false, error: `File too large. Maximum: ${maxMB}MB` },
        { status: 413 }
      );
    }

    // Determine bucket and path
    const bucket = getBucket(mimeType);
    const ext = file.name.split('.').pop() || 'bin';
    const timestamp = Date.now();
    const storagePath = `${session.user.id}/${purpose}/${timestamp}-${file.name}`;

    // Upload to Supabase Storage
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      console.error('Storage upload error:', error);
      return NextResponse.json(
        { success: false, error: `Upload failed: ${error.message}` },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(storagePath);

    return NextResponse.json({
      success: true,
      file: {
        url: urlData.publicUrl,
        bucket,
        path: storagePath,
        name: file.name,
        size: file.size,
        type: mimeType,
        purpose,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { success: false, error: 'Upload failed' },
      { status: 500 }
    );
  }
}
