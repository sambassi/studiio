import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  referencesUtilisateur, motifProtection, MESSAGE_MEDIA_UTILISE, type MotifProtection,
} from '@/lib/storage/references';

export const dynamic = 'force-dynamic';

/** Nombre maximal de fichiers par suppression groupée. */
const MAX_ELEMENTS = 200;

interface Cible { bucket: string; path: string }

function cibleValide(v: unknown): v is Cible {
  if (!v || typeof v !== 'object') return false;
  const { bucket, path } = v as Record<string, unknown>;
  return typeof bucket === 'string' && bucket.length > 0 && typeof path === 'string' && path.length > 0;
}

/** Le chemin reste-t-il dans le dossier du compte ? (`u1/../u2/x` ne l'est pas.) */
function appartientA(path: string, userId: string): boolean {
  if (!path.startsWith(userId + '/')) return false;
  return !path.split('/').some((s) => s === '..' || s === '.');
}

/**
 * Supprime un ou plusieurs fichiers de la Médiathèque.
 *
 * Corps : `{ bucket, path }` (un fichier) ou `{ items: [{ bucket, path }, …] }`.
 *
 * ⚠️ UN FICHIER UTILISÉ PAR UN CONTENU N'EST JAMAIS SUPPRIMÉ. Avant ce
 * contrôle, seul le préfixe `<userId>/` était vérifié : on pouvait supprimer
 * le rendu, le rush ou l'affiche d'un post brouillon, programmé ou publié —
 * post cassé (404), publication en échec, sans retour possible. Les
 * références sont celles que protège aussi le cron de nettoyage (posts,
 * banque Autopilote, rushes de brouillon, tournage), lues pour le seul compte.
 *
 * Références illisibles → 503 et RIEN n'est supprimé.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await req.json().catch(() => null);
    const groupe = Array.isArray(body?.items);
    const brutes: unknown[] = groupe ? body.items : [body];

    if (brutes.length === 0 || !brutes.every(cibleValide)) {
      return NextResponse.json({ success: false, error: 'Missing bucket or path' }, { status: 400 });
    }
    if (brutes.length > MAX_ELEMENTS) {
      return NextResponse.json({ success: false, error: `Maximum ${MAX_ELEMENTS} fichiers par suppression` }, { status: 400 });
    }
    const cibles = brutes as Cible[];

    if (!cibles.every((c) => appartientA(c.path, userId))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const refs = await referencesUtilisateur(userId);
    if (!refs) {
      console.error(`[MEDIA-DELETE] user=${userId} resultat=references-illisibles n=${cibles.length}`);
      return NextResponse.json(
        {
          success: false,
          error: 'Vérification des contenus impossible pour le moment : aucun fichier supprimé. Réessayez dans un instant.',
        },
        { status: 503 },
      );
    }

    const refuses: Array<Cible & { motif: MotifProtection }> = [];
    const aSupprimer = new Map<string, string[]>();
    for (const c of cibles) {
      const motif = motifProtection(c.bucket, c.path, refs);
      if (motif) {
        refuses.push({ ...c, motif });
        console.log(`[MEDIA-DELETE] user=${userId} cle=${c.bucket}/${c.path} resultat=refuse motif=${motif}`);
        continue;
      }
      const liste = aSupprimer.get(c.bucket) ?? [];
      if (!liste.includes(c.path)) liste.push(c.path);
      aSupprimer.set(c.bucket, liste);
    }

    const supprimes: Cible[] = [];
    const erreurs: Array<Cible & { error: string }> = [];
    for (const [bucket, paths] of aSupprimer) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabaseAdmin.storage.from(bucket).remove(paths);
      for (const path of paths) {
        if (error) {
          erreurs.push({ bucket, path, error: error.message });
          console.error(`[MEDIA-DELETE] user=${userId} cle=${bucket}/${path} resultat=erreur ${error.message}`);
        } else {
          supprimes.push({ bucket, path });
          console.log(`[MEDIA-DELETE] user=${userId} cle=${bucket}/${path} resultat=supprime`);
        }
      }
    }

    // ── Un seul fichier : réponse d'avant, plus le 409 ──────────────────────
    if (!groupe) {
      if (refuses.length > 0) {
        return NextResponse.json(
          { success: false, error: MESSAGE_MEDIA_UTILISE, code: 'MEDIA_UTILISE', refuses },
          { status: 409 },
        );
      }
      if (erreurs.length > 0) {
        return NextResponse.json({ success: false, error: erreurs[0].error }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    // ── Suppression groupée : les libres partent, les refusés sont listés ──
    const status = supprimes.length > 0
      ? 200
      : refuses.length > 0 ? 409 : erreurs.length > 0 ? 500 : 200;
    return NextResponse.json(
      {
        success: refuses.length === 0 && erreurs.length === 0,
        supprimes,
        refuses,
        erreurs,
        ...(refuses.length > 0 ? { error: MESSAGE_MEDIA_UTILISE, code: 'MEDIA_UTILISE' } : {}),
      },
      { status },
    );
  } catch (error) {
    console.error('[MediaDelete] Error:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete file' }, { status: 500 });
  }
}
