import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { sanitizeStorageFilename } from '@/lib/storage/sanitize-filename';

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
    const safeFilename = sanitizeStorageFilename(filename);
    const storagePath = `${session.user.id}/${purpose || 'rush'}/${timestamp}-${safeFilename}`;

    // Quand on est sur S3/MinIO (Hetzner), on ne peut pas exposer un
    // presigned URL MinIO direct au browser : le hostname interne
    // `studiio-minio:9000` n'est pas résolvable depuis l'extérieur.
    // On retourne plutôt un URL pointant vers notre proxy PUT côté
    // Next.js (/api/storage/upload) qui authentifie via session cookie
    // et stream vers MinIO en interne.
    if ((process.env.STORAGE_PROVIDER || '').toLowerCase() === 's3') {
      const proxyUrl = `/api/storage/upload?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}`;
      const publicUrl = `/storage/v1/object/public/${bucket}/${storagePath}`;
      return NextResponse.json({
        success: true,
        signedUrl: proxyUrl, // PUT vers cet URL avec credentials: 'include'
        token: '',
        path: storagePath,
        publicUrl,
        bucket,
      });
    }

    // Sinon (Supabase legacy), comportement historique
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error) {
      console.error('[SignedUrl] Error creating signed URL:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

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
