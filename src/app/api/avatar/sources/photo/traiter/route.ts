/**
 * POST /api/avatar/sources/photo/traiter — `{ cleOriginal, embellissement }`.
 *
 * Embellit une photo source DU COMPTE avec le ffmpeg du serveur (filtre
 * bilatéral, aucune transformation géométrique, orientation EXIF respectée),
 * et dépose le résultat comme SECOND objet : l'original n'est jamais modifié.
 * `aucun` → l'original lui-même, sans traitement ni nouvel objet.
 *
 * Réponse : `{ success: true, data: { cleOriginal, cleTraitee, embellissement } }`.
 */
import { prendreVerrouSource, libererVerrouSource, MESSAGE_SOURCE_EN_COURS } from '@/lib/avatar/verrou-traitement';
import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { BUCKET_AVATAR, cleSourceAvatar, cleSourceAvatarDuCompte, ouvrirSourceAvatar, typeSourceAvatar } from '@/lib/avatar/source';
import { dossierTemporaire, retirerDossierTemporaire } from '@/lib/avatar/preparation-source';
import {
  TYPES_PHOTO_ACCEPTES, TAILLE_MAX_PHOTO_OCTETS, bornerEmbellissementPhoto, orientationExif, traiterPhoto,
} from '@/lib/avatar/preparation-photo';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const refus = (status: number, error: string) => NextResponse.json({ success: false, error }, { status });
const introuvable = () => refus(404, 'Source introuvable.');

export async function POST(req: NextRequest) {
  let dossier: string | null = null;
  let verrouille: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) return refus(401, 'Unauthorized');
    const userId = session.user.id;

    let corps: { cleOriginal?: unknown; embellissement?: unknown };
    try { corps = await req.json(); } catch { return refus(400, 'Requête illisible.'); }
    const cleOriginal = corps?.cleOriginal;
    // Propriété et nature (une PHOTO du compte), AVANT tout accès au stockage.
    if (!cleSourceAvatarDuCompte(cleOriginal, userId)) return introuvable();
    const type = typeSourceAvatar(cleOriginal) ?? '';
    const extension = TYPES_PHOTO_ACCEPTES[type];
    if (!extension) return introuvable();
    const niveau = bornerEmbellissementPhoto(corps.embellissement);
    if (niveau === 'aucun') {
      return NextResponse.json({ success: true, data: { cleOriginal, cleTraitee: cleOriginal, embellissement: niveau } });
    }

    if (!prendreVerrouSource(userId)) return refus(429, MESSAGE_SOURCE_EN_COURS);
    verrouille = userId;
    let source: Awaited<ReturnType<typeof ouvrirSourceAvatar>>;
    try { source = await ouvrirSourceAvatar(userId, cleOriginal); } catch { return introuvable(); }
    if (!source || source.taille <= 0 || source.taille > TAILLE_MAX_PHOTO_OCTETS) return introuvable();

    dossier = await dossierTemporaire();
    const entree = join(dossier, `original.${extension}`);
    const sortie = join(dossier, 'embellie.jpg');
    await pipeline(Readable.from(source.flux), createWriteStream(entree));
    const orientation = extension === 'jpg' ? orientationExif(await readFile(entree)) : 1;

    try {
      await traiterPhoto(entree, sortie, niveau, orientation);
    } catch (e) {
      console.error('[Avatar][sources/photo/traiter] ffmpeg :', e instanceof Error ? e.message.slice(0, 500) : String(e));
      return refus(422, 'L’embellissement de la photo a échoué. Choisissez « Aucun » ou une autre photo.');
    }

    const octets = await readFile(sortie);
    const cleTraitee = cleSourceAvatar(userId, 'jpg');
    const { error } = await supabaseAdmin.storage.from(BUCKET_AVATAR).upload(cleTraitee, octets, { contentType: 'image/jpeg', upsert: false });
    if (error) {
      console.error('[Avatar][sources/photo/traiter] stockage impossible :', error.message);
      return refus(500, 'La photo embellie n’a pas pu être enregistrée. Réessayez.');
    }
    return NextResponse.json({ success: true, data: { cleOriginal, cleTraitee, embellissement: niveau } });
  } catch (e: unknown) {
    console.error('[Avatar][sources/photo/traiter] erreur :', e instanceof Error ? e.message : String(e));
    return refus(500, 'Une erreur interne est survenue.');
  } finally {
    if (verrouille) libererVerrouSource(verrouille);
    await retirerDossierTemporaire(dossier);
  }
}
