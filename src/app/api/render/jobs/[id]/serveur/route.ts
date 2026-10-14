/**
 * A2.3 — RENDU SERVEUR D'UNE TENTATIVE DÉJÀ RÉSERVÉE.
 *
 * POST : lance le rendu Remotion de la spec reçue pour la tentative `[id]`
 * (réservée par `/api/render/jobs`), puis la confirme par la MÊME porte que
 * le navigateur. Répond 202 tout de suite ; le travail continue derrière.
 * GET  : relit l'état de la tentative et dit si elle est en cours de rendu.
 *
 * ⚠️ ÉTEINT PAR DÉFAUT. Sans `MOTEUR_EXPORT_SERVEUR=true` (exactement),
 * la route répond 404 avant de lire quoi que ce soit — ni session, ni base.
 * Allumé, elle n'est ouverte qu'aux administrateurs en A2.3 ; un autre
 * compte reçoit le même 404 neutre.
 *
 * Ordre des refus (aucun n'a d'effet de bord) : interrupteur → session →
 * administrateur (ces trois-là : même 404 `{ ok:false }`) → propriété
 * (`lireRendu`) → état `reserved` → opération → corps (≤ 256 Ko) → spec
 * (liste blanche, médias, couleurs, bornes) et cohérence du format facturé →
 * job déjà en cours → place (la sienne ET tout rendu Remotion du processus)
 * → relecture de la ligne. La place est prise en dernier : un refus n'en
 * garde jamais une.
 *
 * L'Autopilote ne lit pas ces places : A2.3 lui cède la main (429), il ne la
 * cède jamais à A2.3.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { isAdmin } from '@/lib/admin';
import { lireRendu } from '@/lib/rendus/service';
import { formatRenduFacturation } from '@/lib/format/projet';
import {
  OPERATIONS_RENDU_SERVEUR, TAILLE_MAX_CORPS, executerRenduServeur, moteurExportServeurActif,
  prendreExecution, renduServeurEnCours, retryAfterSecondes, validerSpecServeur,
} from '@/lib/render/moteur-export-serveur';
import { rendusRemotionActifs } from '@/lib/render/occupation-remotion';
import type { LigneRendu } from '@/lib/rendus/confirmation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const INTROUVABLE = () => NextResponse.json({ ok: false }, { status: 404 });

/** Les contrôles communs à POST et GET. Rend la ligne ou la réponse de refus. */
async function acceder(id: string): Promise<
  | { ok: true; userId: string; rendu: LigneRendu }
  | { ok: false; reponse: NextResponse }
> {
  const session = await auth();
  // Sans session, ou hors des cas autorisés en A2.3 (administrateurs
  // seulement) : même 404 que le flag éteint — rien ne révèle la route.
  if (!session?.user?.id) return { ok: false, reponse: INTROUVABLE() };
  if (!isAdmin(session.user.email)) return { ok: false, reponse: INTROUVABLE() };

  const { rendu, socleAbsent } = await lireRendu(session.user.id, id);
  if (socleAbsent) {
    return {
      ok: false,
      reponse: NextResponse.json(
        { ok: false, error: 'Rendu indisponible : migration des rendus non appliquee.' }, { status: 503 },
      ),
    };
  }
  // Inconnue ou d'autrui : même réponse.
  if (!rendu) {
    return { ok: false, reponse: NextResponse.json({ ok: false, error: 'Rendu introuvable' }, { status: 404 }) };
  }
  return { ok: true, userId: session.user.id, rendu: rendu as LigneRendu };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!moteurExportServeurActif()) return INTROUVABLE();
  try {
    const acces = await acceder(params.id);
    if (!acces.ok) return acces.reponse;
    const { userId, rendu } = acces;

    // Une tentative confirmée, annulée ou échouée ne se rend plus : on en
    // réserve une nouvelle. C'est ce qui garantit une confirmation unique.
    if (rendu.etat !== 'reserved') {
      return NextResponse.json({ ok: false, motif: 'etat_invalide', etat: rendu.etat }, { status: 409 });
    }
    if (!(OPERATIONS_RENDU_SERVEUR as readonly unknown[]).includes(rendu.operation)) {
      return NextResponse.json({ ok: false, motif: 'operation_refusee' }, { status: 403 });
    }

    // Corps borné AVANT d'être lu (Content-Length annoncé), puis mesuré.
    const annonce = Number(req.headers?.get?.('content-length') ?? NaN);
    if (Number.isFinite(annonce) && annonce > TAILLE_MAX_CORPS) {
      return NextResponse.json({ ok: false, motif: 'corps_trop_gros' }, { status: 413 });
    }
    let texte = '';
    try { texte = await req.text(); } catch { /* corps absent : refusé ci-dessous */ }
    if (Buffer.byteLength(texte, 'utf8') > TAILLE_MAX_CORPS) {
      return NextResponse.json({ ok: false, motif: 'corps_trop_gros' }, { status: 413 });
    }
    let corps: unknown = null;
    try { corps = JSON.parse(texte); } catch {
      return NextResponse.json({ ok: false, motif: 'corps_illisible' }, { status: 422 });
    }
    const validation = validerSpecServeur((corps as { spec?: unknown } | null)?.spec);
    if (!validation.ok) {
      return NextResponse.json({ ok: false, motif: validation.motif }, { status: 422 });
    }
    const spec = validation.spec;
    // Le format FACTURÉ est celui de la ligne, figé à la réservation. Une
    // spec d'un autre format rendrait une vidéo payée au mauvais tarif.
    if (formatRenduFacturation(spec.format!) !== rendu.format) {
      return NextResponse.json({ ok: false, motif: 'format_incoherent' }, { status: 422 });
    }

    const prise = prendreExecution(rendu.id, rendusRemotionActifs());
    if (!prise.ok) {
      if (prise.motif === 'deja_en_cours') {
        return NextResponse.json({ ok: false, motif: 'deja_en_cours' }, { status: 409 });
      }
      return NextResponse.json(
        { ok: false, motif: 'capacite_saturee', error: 'Un rendu est déjà en cours sur ce serveur.' },
        { status: 429, headers: { 'Retry-After': String(retryAfterSecondes()) } },
      );
    }

    // ── P1 : relire APRÈS la place ────────────────────────────────────
    // Entre la première lecture et ici (corps lent), une autre requête a pu
    // rendre et confirmer cette tentative. Sans cette relecture, la même
    // tentative serait rendue deux fois.
    let relue: LigneRendu | null = null;
    try {
      relue = (await lireRendu(userId, rendu.id)).rendu as LigneRendu | null;
    } catch (e) {
      prise.place.liberer();
      throw e;
    }
    if (!relue || relue.etat !== 'reserved') {
      prise.place.liberer();
      return NextResponse.json({ ok: false, motif: 'etat_invalide', etat: relue?.etat ?? null }, { status: 409 });
    }

    // ⚠️ LE TRAVAIL SURVIT À LA RÉPONSE (`node server.js`, conteneur
    // unique). `executerRenduServeur` ne jette pas et libère la place dans
    // son `finally` ; ce `catch` n'est que la ceinture.
    void executerRenduServeur({ userId, rendu, spec, place: prise.place })
      .catch(() => { prise.place.liberer(); });

    return NextResponse.json({ ok: true, jobId: rendu.id, etat: 'reserved', enCours: true }, { status: 202 });
  } catch (e: unknown) {
    console.error('[RenduServeur/A2.3] POST :', e instanceof Error ? e.name : 'erreur');
    return NextResponse.json({ ok: false, error: 'rendu serveur impossible' }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!moteurExportServeurActif()) return INTROUVABLE();
  try {
    const acces = await acceder(params.id);
    if (!acces.ok) return acces.reponse;
    return NextResponse.json({
      ok: true, jobId: acces.rendu.id, etat: acces.rendu.etat, enCours: renduServeurEnCours(acces.rendu.id),
    });
  } catch (e: unknown) {
    console.error('[RenduServeur/A2.3] GET :', e instanceof Error ? e.name : 'erreur');
    return NextResponse.json({ ok: false, error: 'lecture impossible' }, { status: 500 });
  }
}
