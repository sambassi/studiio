/**
 * POST /api/avatar/sources/traiter — produire la version PRÉPARÉE d'une
 * source, à côté de l'original.
 *
 * Corps JSON : `{ cleOriginal, parametres }`.
 *
 *   - la clé doit être UNE SOURCE VIDÉO DE CE COMPTE (`cleSourceAvatarDuCompte`)
 *     — sinon 404, la même réponse que pour un objet absent ;
 *   - les paramètres sont BORNÉS (`bornerParametres`) d'après la sonde de
 *     l'original : rien de ce que le navigateur envoie n'atteint ffmpeg tel
 *     quel ;
 *   - le résultat est sondé et contrôlé (`preflightSource`) : conforme, il
 *     est stocké sous une NOUVELLE clé ; non conforme, il n'est PAS stocké
 *     (422, motifs).
 *
 * ⚠️ L'ORIGINAL N'EST NI MODIFIÉ NI RETIRÉ, quel que soit le résultat :
 * cette route ne connaît aucun `remove`. Aucun fournisseur n'est appelé,
 * aucune ligne n'est écrite en base.
 *
 * Réponse : `{ success: true, data: { cleOriginal, cleTraitee, infos, preflight, parametres } }`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  BUCKET_AVATAR, cleSourceAvatar, cleSourceAvatarDuCompte, ouvrirSourceAvatar, typeSourceAvatar,
} from '@/lib/avatar/source';
import {
  TYPES_VIDEO_ACCEPTES, bornerParametres, dossierTemporaire, infosVideo, preflightSource, retirerDossierTemporaire,
  traiterVideo,
} from '@/lib/avatar/preparation-source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const refus = (status: number, error: string, data?: unknown) =>
  NextResponse.json({ success: false, error, ...(data ? { data } : {}) }, { status });
const introuvable = () => refus(404, 'Source introuvable.');

export async function POST(req: NextRequest) {
  let dossier: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) return refus(401, 'Unauthorized');
    const userId = session.user.id;

    let corps: { cleOriginal?: unknown; parametres?: unknown };
    try { corps = await req.json(); } catch { return refus(400, 'Requête illisible.'); }
    const cleOriginal = corps?.cleOriginal;

    // Propriété et nature, AVANT tout accès au stockage.
    if (!cleSourceAvatarDuCompte(cleOriginal, userId)) return introuvable();
    const extension = TYPES_VIDEO_ACCEPTES[typeSourceAvatar(cleOriginal) ?? ''];
    if (!extension) return introuvable();

    let source: Awaited<ReturnType<typeof ouvrirSourceAvatar>>;
    try { source = await ouvrirSourceAvatar(userId, cleOriginal); } catch { return introuvable(); }
    if (!source || source.taille <= 0) return introuvable();

    dossier = await dossierTemporaire();
    const entree = join(dossier, `original.${extension}`);
    const sortie = join(dossier, 'preparee.mp4');
    await pipeline(Readable.from(source.flux), createWriteStream(entree));

    let infosOriginal;
    try { infosOriginal = await infosVideo(entree); } catch {
      return refus(422, 'La vidéo d’origine est illisible.');
    }

    const parametres = bornerParametres(
      corps.parametres as never, infosOriginal.dureeS,
      { largeur: infosOriginal.largeurEffective, hauteur: infosOriginal.hauteurEffective },
    );

    try {
      await traiterVideo(entree, sortie, parametres, infosOriginal);
    } catch (e) {
      console.error('[Avatar][sources/traiter] ffmpeg :', e instanceof Error ? e.message.slice(0, 500) : String(e));
      return refus(422, 'La préparation de la vidéo a échoué. Modifiez les réglages ou importez une autre vidéo.');
    }

    let infos;
    try { infos = await infosVideo(sortie); } catch {
      return refus(422, 'La vidéo préparée est illisible. Réessayez.');
    }
    const preflight = preflightSource(infos, { etape: 'traitee' });
    if (!preflight.ok) {
      return refus(422, preflight.motifs[0] ?? 'La vidéo préparée ne respecte pas les règles.', {
        motifs: preflight.motifs, infos, preflight, parametres,
      });
    }

    const cleTraitee = cleSourceAvatar(userId, 'mp4');
    const octets = await readFile(sortie);
    const { error } = await supabaseAdmin.storage
      .from(BUCKET_AVATAR)
      .upload(cleTraitee, octets, { contentType: 'video/mp4', upsert: false });
    if (error) {
      console.error('[Avatar][sources/traiter] stockage impossible :', error.message);
      return refus(500, 'La vidéo préparée n’a pas pu être enregistrée. Réessayez.');
    }

    return NextResponse.json({ success: true, data: { cleOriginal, cleTraitee, infos, preflight, parametres } });
  } catch (e: unknown) {
    console.error('[Avatar][sources/traiter] erreur :', e instanceof Error ? e.message : String(e));
    return refus(500, 'Une erreur interne est survenue.');
  } finally {
    await retirerDossierTemporaire(dossier);
  }
}
