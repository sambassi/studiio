/**
 * POST /api/creer/rush/keep — protéger un rush de brouillon contre la rétention.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un rush importé dans Créer via la Médiathèque vit sous
 * `media/<userId>/library/<fichier>.mp4` : classe VIDÉO → rétention 24 h. Il
 * n'est référencé QUE dans le brouillon `localStorage` du navigateur, que le
 * serveur ne voit pas. Le cron `/api/cron/cleanup-media` protège les médias
 * des `scheduled_posts` et la banque de l'Autopilote, mais PAS un rush qu'un
 * brouillon utilise activement. Résultat : supprimé après 24 h → l'URL du
 * brouillon devient 404 → la séquence « Vidéo » du montage disparaît.
 *
 * Cette route enregistre, dans `creer_draft_rushes`, la CLÉ de stockage du
 * rush choisi. `draftRushKeys()` la relit à chaque passage du cron et
 * l'exempte tant qu'elle a été rafraîchie il y a moins de 30 jours.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE N'ACCEPTE PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'URL doit se réduire à une cible de stockage APPARTENANT au compte :
 *   - une origine configurée (`originesStockageConfigurees`), pas n'importe
 *     quel hôte — c'est le parseur unique `extraireCibleStockage` ;
 *   - un compartiment autorisé et un chemin recevable (`cibleRecevable` :
 *     ni `..`, ni namespace privé analyse/lut/avatar/montage) ;
 *   - une clé qui commence par `<session.user.id>/` (`cleDuCompteStrict`) —
 *     jamais le rush d'un autre compte, ni un préfixe partagé.
 *
 * Tout le reste : 400, sans effet en base. Aucun secret n'est renvoyé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  extraireCibleStockage,
  originesStockageConfigurees,
  cibleRecevable,
  cleDuCompteStrict,
} from '@/lib/storage/acces-objet';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps illisible' }, { status: 400 });
  }
  if (typeof url !== 'string' || url.length === 0) {
    return NextResponse.json({ ok: false, error: 'URL absente' }, { status: 400 });
  }

  // Une seule et même validation que partout ailleurs : le parseur d'URL, la
  // recevabilité de la cible, puis la propriété STRICTE (aucun préfixe
  // partagé — un rush est à son compte, pas à `converted/`).
  const cible = extraireCibleStockage(url, { origines: originesStockageConfigurees() });
  if (!cible) {
    return NextResponse.json({ ok: false, error: 'URL hors stockage du compte' }, { status: 400 });
  }
  if (!cibleRecevable(cible.bucket, cible.cle)) {
    return NextResponse.json({ ok: false, error: 'Cible non recevable' }, { status: 400 });
  }
  if (!cleDuCompteStrict(cible.cle, userId)) {
    return NextResponse.json({ ok: false, error: 'Cible hors du compte' }, { status: 400 });
  }

  // La clé exactement sous la forme que le nettoyage compare
  // (`processFile` : `${bucket}/${path}`), et que `storageKey()` produit.
  const objectKey = `${cible.bucket}/${cible.cle}`;

  const { error } = await supabaseAdmin
    .from('creer_draft_rushes')
    .upsert(
      { user_id: userId, object_key: objectKey, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,object_key' },
    );

  if (error) {
    // Fire-and-forget côté client : on répond 500 mais l'import ne s'en soucie
    // pas. Aucun détail de base n'est exposé.
    console.error('[Creer][rush/keep] upsert impossible :', error.message);
    return NextResponse.json({ ok: false, error: 'Enregistrement impossible' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
