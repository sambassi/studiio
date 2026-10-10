/**
 * POST /api/avatar/sources/photo — dépose l'ORIGINAL d'une photo source, tel
 * quel, pour l'embellissement (multipart, champ `file`). Rien n'est envoyé à
 * un fournisseur ; la clé rendue n'est utilisable que par CE compte.
 *
 * Réponse : `{ success: true, data: { cleOriginal } }`.
 */
import { prendreVerrouSource, libererVerrouSource, MESSAGE_SOURCE_EN_COURS } from '@/lib/avatar/verrou-traitement';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { BUCKET_AVATAR, cleSourceAvatar } from '@/lib/avatar/source';
import { TYPES_PHOTO_ACCEPTES, TAILLE_MAX_PHOTO_OCTETS } from '@/lib/avatar/preparation-photo-regles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const refus = (status: number, error: string) => NextResponse.json({ success: false, error }, { status });

export async function POST(req: NextRequest) {
  let verrouille: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) return refus(401, 'Unauthorized');
    const userId = session.user.id;
    if (!prendreVerrouSource(userId)) return refus(429, MESSAGE_SOURCE_EN_COURS);
    verrouille = userId;

    let fichier: File | null = null;
    try {
      const f = (await req.formData()).get('file');
      fichier = f && typeof f === 'object' && 'arrayBuffer' in f ? (f as File) : null;
    } catch {
      return refus(400, 'Envoi illisible.');
    }
    if (!fichier) return refus(400, 'Aucune photo reçue.');
    const type = (fichier.type || '').split(';')[0].trim().toLowerCase();
    const extension = TYPES_PHOTO_ACCEPTES[type];
    if (!extension) return refus(415, 'Format non pris en charge : utilisez une photo JPG, PNG ou WebP.');
    if (fichier.size <= 0) return refus(400, 'Le fichier est vide.');
    if (fichier.size > TAILLE_MAX_PHOTO_OCTETS) return refus(413, 'Photo trop lourde : 10 Mo maximum.');
    const octets = Buffer.from(await fichier.arrayBuffer());
    if (octets.length > TAILLE_MAX_PHOTO_OCTETS) return refus(413, 'Photo trop lourde : 10 Mo maximum.');

    const cleOriginal = cleSourceAvatar(userId, extension);
    const { error } = await supabaseAdmin.storage.from(BUCKET_AVATAR).upload(cleOriginal, octets, { contentType: type, upsert: false });
    if (error) {
      console.error('[Avatar][sources/photo] stockage impossible :', error.message);
      return refus(500, 'Votre photo n’a pas pu être enregistrée. Réessayez.');
    }
    return NextResponse.json({ success: true, data: { cleOriginal } });
  } catch (e: unknown) {
    console.error('[Avatar][sources/photo] erreur :', e instanceof Error ? e.message : String(e));
    return refus(500, 'Une erreur interne est survenue.');
  } finally {
    if (verrouille) libererVerrouSource(verrouille);
  }
}
