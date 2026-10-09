/**
 * POST /api/avatar/sources — déposer l'ORIGINAL d'une vidéo source, sans rien
 * lui faire.
 *
 * Multipart, champ `file` (MP4, WebM ou MOV, 32 Mo au plus). Le fichier est
 * d'abord SONDÉ (ffprobe, sur une copie temporaire) ; il n'est stocké que
 * s'il peut servir — une vidéo sans son, trop courte ou trop petite est
 * refusée (422) SANS être conservée : un visage inutilisable n'a rien à
 * faire en stockage. Ce que la préparation sait corriger (trop longue, trop
 * grande) passe, avec un avertissement.
 *
 * La clé est construite ICI (`cleSourceAvatar`), jamais reçue. Aucun
 * fournisseur n'est appelé, aucune ligne n'est écrite en base : l'avatar ne
 * change qu'au parcours d'import existant.
 *
 * Réponse : `{ success: true, data: { cleOriginal, infos, preflight } }`.
 */
import { prendreVerrouSource, libererVerrouSource, MESSAGE_SOURCE_EN_COURS } from '@/lib/avatar/verrou-traitement';
import { NextRequest, NextResponse } from 'next/server';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { BUCKET_AVATAR, cleSourceAvatar } from '@/lib/avatar/source';
import {
  TAILLE_MAX_OCTETS, TYPES_VIDEO_ACCEPTES, dossierTemporaire, infosVideo, preflightSource, retirerDossierTemporaire,
  type InfosVideo,
} from '@/lib/avatar/preparation-source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const refus = (status: number, error: string, data?: unknown) =>
  NextResponse.json({ success: false, error, ...(data ? { data } : {}) }, { status });

export async function POST(req: NextRequest) {
  let dossier: string | null = null;
  let verrouille: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) return refus(401, 'Unauthorized');
    const userId = session.user.id;
    if (!prendreVerrouSource(userId)) return refus(429, MESSAGE_SOURCE_EN_COURS);
    verrouille = userId;

    let fichier: File | null = null;
    try {
      const corps = await req.formData();
      const f = corps.get('file');
      fichier = f && typeof f === 'object' && 'arrayBuffer' in f ? (f as File) : null;
    } catch {
      return refus(400, 'Envoi illisible.');
    }
    if (!fichier) return refus(400, 'Aucune vidéo reçue.');

    const type = (fichier.type || '').split(';')[0].trim().toLowerCase();
    const extension = TYPES_VIDEO_ACCEPTES[type];
    if (!extension) return refus(415, 'Format non pris en charge : utilisez une vidéo MP4, MOV ou WebM.');
    if (fichier.size <= 0) return refus(400, 'Le fichier est vide.');
    if (fichier.size > TAILLE_MAX_OCTETS) return refus(413, 'Vidéo trop lourde : 32 Mo maximum.');

    const octets = Buffer.from(await fichier.arrayBuffer());
    if (octets.length > TAILLE_MAX_OCTETS) return refus(413, 'Vidéo trop lourde : 32 Mo maximum.');

    // La sonde, AVANT tout stockage.
    dossier = await dossierTemporaire();
    const chemin = join(dossier, `original.${extension}`);
    await writeFile(chemin, octets);
    let infos: InfosVideo;
    try {
      infos = await infosVideo(chemin);
    } catch (e) {
      if ((e as { code?: string } | null)?.code === 'ENOENT') {
        console.error('[Avatar][sources] ffprobe introuvable');
        return refus(503, 'L’analyse vidéo est momentanément indisponible. Réessayez plus tard.');
      }
      return refus(422, 'Ce fichier vidéo est illisible. Exportez-le à nouveau en MP4, puis réessayez.');
    }

    const preflight = preflightSource(infos, { etape: 'original' });
    if (!preflight.ok) {
      return refus(422, preflight.motifs[0] ?? 'Cette vidéo ne peut pas servir de source.', { infos, preflight });
    }

    const cleOriginal = cleSourceAvatar(userId, extension);
    const { error } = await supabaseAdmin.storage
      .from(BUCKET_AVATAR)
      .upload(cleOriginal, octets, { contentType: type, upsert: false });
    if (error) {
      console.error('[Avatar][sources] stockage impossible :', error.message);
      return refus(500, 'Votre vidéo n’a pas pu être enregistrée. Réessayez.');
    }

    return NextResponse.json({ success: true, data: { cleOriginal, infos, preflight } });
  } catch (e: unknown) {
    console.error('[Avatar][sources] erreur :', e instanceof Error ? e.message : String(e));
    return refus(500, 'Une erreur interne est survenue.');
  } finally {
    if (verrouille) libererVerrouSource(verrouille);
    await retirerDossierTemporaire(dossier);
  }
}
