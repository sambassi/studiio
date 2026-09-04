/**
 * M3-G — LE CALCUL D'UN PLAN DE MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ SYNCHRONE, ET C'EST UNE SIMPLIFICATION VOULUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-F répond 202 et travaille derrière, parce qu'il lance ffmpeg : jusqu'à
 * dix-huit minutes de découpage et de téléversement. M3-G ne lance rien — il
 * lit deux lignes, calcule en mémoire, écrit une ligne. Il répond donc 201,
 * sans travail détaché, sans place de capacité, sans état `en_cours` et sans
 * péremption. Reprendre l'asynchrone de M3-F ici aurait ajouté trois
 * mécanismes à surveiller pour protéger un calcul de quelques microsecondes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE CLIENT DÉCIDE, ET CE QUE LE SERVEUR DÉCIDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le client apporte DEUX valeurs, toutes deux bornées : le format cible et la
 * durée cible. Tout le reste — l'ordre, les durées retenues, les positions,
 * les rectangles de recadrage, les clés des sources — est calculé ici, à
 * partir du jeu de clips et de l'analyse du rush.
 *
 * ⚠️ AUCUN TIMECODE CLIENT, comme en M3-F. Accepter `plans` ou
 * `dureeRetenueSecondes` reviendrait à laisser monter n'importe quoi sous
 * couvert d'un plan calculé.
 *
 * ⚠️ AUCUN OCTET, AUCUN CRÉDIT, AUCUN FOURNISSEUR. Cette route ne rend rien,
 * ne facture rien, n'appelle personne. Le rendu appartient à M3-H.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { identifiantValide } from '@/lib/autopilot/analyse/clip-contrat';
import { lireSetParId } from '@/lib/autopilot/analyse/clip-service';
import { lireAnalyse } from '@/lib/autopilot/analyse/service';
import { diagnosticSur } from '@/lib/autopilot/analyse/clip-extraction';
import {
  ALGORITHME_PLAN, DUREE_CIBLE_MAX_SECONDES, DUREE_CIBLE_MIN_SECONDES,
  dimensionsCible, dureeCibleValide, formatValide,
  type FormatMontage, type IdentitePlan,
} from '@/lib/autopilot/analyse/montage-contrat';
import { geometrieDepuisTechnique, planifierMontage } from '@/lib/autopilot/analyse/montage';
import { creerPlan, lirePlanIdentique } from '@/lib/autopilot/analyse/montage-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Deux lectures indexées et un calcul en mémoire. */
export const maxDuration = 30;

const SOCLE_ABSENT = 'La table des plans de montage n’existe pas encore sur ce serveur.';

/**
 * ⚠️ REFUSÉS, JAMAIS IGNORÉS. Un champ ignoré laisse croire qu'il a été pris
 * en compte, et c'est exactement ce qu'espère celui qui l'envoie.
 */
const CHAMPS_INTERDITS = [
  'plans', 'ordre', 'dureeRetenueSecondes', 'debutTimelineSecondes',
  'entreeSecondes', 'debutSecondes', 'finSecondes', 'coupes', 'clips',
  'recadrage', 'crop', 'largeurSource', 'hauteurSource',
  'largeurCible', 'hauteurCible', 'raccordEntrant',
  'bucket', 'cle', 'cleObjet', 'rushId', 'userId', 'user_id',
] as const;

function refus(motif: string, message: string, status = 409) {
  return NextResponse.json({ ok: false, error: message, motif }, { status });
}

export async function POST(
  req: NextRequest, { params }: { params: { clipSetId: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    if (!identifiantValide(params.clipSetId)) {
      return refus('identifiant_invalide', 'Identifiant invalide.', 422);
    }

    // ── Le corps : un format, une durée cible, et RIEN d'autre ──────────
    const brut = (await req.text()).trim();
    if (brut.length === 0) {
      return refus('corps_manquant',
        'Le format et la durée cible sont obligatoires.', 422);
    }
    let json: unknown;
    try { json = JSON.parse(brut); } catch {
      return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
    }
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 422 });
    }
    const corps = json as Record<string, unknown>;

    for (const interdit of CHAMPS_INTERDITS) {
      if (Object.prototype.hasOwnProperty.call(corps, interdit)) {
        return NextResponse.json(
          { ok: false, error: `Le champ « ${interdit} » est decide par le serveur.` },
          { status: 422 },
        );
      }
    }

    if (!formatValide(corps.format)) {
      return refus('format_invalide',
        'Le format doit valoir « 9:16 », « 1:1 » ou « 16:9 ».', 422);
    }
    const format = corps.format as FormatMontage;

    // ⚠️ OBLIGATOIRE, ET SANS DÉFAUT. Le produit ne connaît aucune durée de
    // montage — ni `autopilot_config`, ni `objectives`, ni `shoot_sessions`
    // n'en portent. En inventer une ici produirait un montage que personne
    // n'a demandé et que rien dans la réponse ne signalerait comme arbitraire.
    if (!dureeCibleValide(corps.dureeCibleSecondes)) {
      return refus('duree_cible_invalide',
        `La durée cible doit être comprise entre ${DUREE_CIBLE_MIN_SECONDES}`
        + ` et ${DUREE_CIBLE_MAX_SECONDES} secondes.`, 422);
    }
    const dureeCibleSecondes = Number(corps.dureeCibleSecondes);

    // ── Le jeu de clips, et la propriété prouvée par la requête ─────────
    const { set, motif: motifSet } = await lireSetParId(userId, params.clipSetId);
    if (motifSet === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du travail d'un tiers.
    if (!set) {
      return NextResponse.json({ ok: false, error: 'Clips introuvables' }, { status: 404 });
    }
    if (set.etat !== 'reussie') {
      return refus('jeu_non_reussi', 'Ce jeu de clips n’est pas abouti.');
    }
    if (set.clips.length === 0) {
      return refus('jeu_sans_clip', 'Ce jeu ne porte aucun clip.');
    }

    // ── L'identité complète, figée AVANT tout calcul ────────────────────
    const identite: IdentitePlan = {
      clipSetId: set.id,
      clipSetVersion: set.version,
      candidateSetId: set.candidateSetId,
      analysisId: set.analysisId,
      algorithme: set.algorithme,
      methodeMaterialisation: set.methodeMaterialisation,
      algorithmePlan: ALGORITHME_PLAN,
      format,
      dureeCibleSecondes,
    };

    // ── Déjà calculé ? On rend l'existant, sans recalculer ──────────────
    const existant = await lirePlanIdentique(userId, identite);
    if (existant.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (existant.plan) {
      return NextResponse.json({ ok: true, reutilise: true, plan: existant.plan });
    }

    // ── La géométrie du rush : LUE, jamais devinée ──────────────────────
    //
    // Sans dimensions mesurées, aucun recadrage n'est décidable. Supposer du
    // 1920×1080 aurait recadré de travers un rush vertical, et le plan aurait
    // eu l'air valide.
    const { analyse, motif: motifAnalyse } = await lireAnalyse(userId, set.analysisId);
    if (motifAnalyse === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (!analyse) {
      return refus('geometrie_inconnue', 'L’analyse de ce rush est introuvable.');
    }
    const geometrie = geometrieDepuisTechnique(analyse.technique);
    if (geometrie === null) {
      return refus('geometrie_inconnue',
        'Les dimensions de ce rush ne sont pas connues.');
    }

    // ── Le calcul, pur ──────────────────────────────────────────────────
    const { resultat, motif: motifPlan } = planifierMontage({
      clips: set.clips,
      format,
      dureeCibleSecondes,
      geometrie,
      // ⚠️ LA DUREE DU RUSH, POUR LE PLAFOND DE COUVERTURE. Elle vient de
      // l'analyse deja lue ci-dessus : aucune requete de plus, et c'est la
      // meme mesure que celle qui a servi a decider la geometrie.
      dureeRushSecondes: analyse.dureeSecondes ?? undefined,
    });
    if (!resultat) {
      return refus(motifPlan ?? 'plan_vide',
        'Aucun plan ne peut être bâti avec ces clips.');
    }

    const cible = dimensionsCible(format);
    const creation = await creerPlan(userId, identite, {
      largeurCible: cible.largeur,
      hauteurCible: cible.hauteur,
      fps: geometrie.fps,
      plans: resultat.plans,
      dureeTotaleSecondes: resultat.dureeTotaleSecondes,
      ecartSecondes: resultat.ecartSecondes,
      clipsEcartes: resultat.clipsEcartes,
      usage: resultat.usage,
    });

    if (creation.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // La base a refusé un doublon : quelqu'un d'autre — un second onglet, un
    // rejeu — a écrit le même plan entre notre lecture et notre insertion.
    // Le résultat attendu existe donc ; on le relit plutôt que d'échouer.
    if (creation.motif === 'plan_concurrent') {
      const relu = await lirePlanIdentique(userId, identite);
      if (relu.plan) {
        return NextResponse.json({ ok: true, reutilise: true, plan: relu.plan });
      }
      return refus('plan_concurrent', 'Un plan identique vient d’être créé.');
    }
    if (!creation.plan) {
      return refus('plan_vide', 'Le plan n’a pas pu être enregistré.', 500);
    }

    return NextResponse.json(
      { ok: true, reutilise: false, plan: creation.plan }, { status: 201 },
    );
  } catch (e: unknown) {
    // ⚠️ LE MESSAGE INTERNE NE REDESCEND PAS. Il porte l'adresse et le port
    // du socle. Le détail part au journal, masqué ; la réponse est muette.
    console.error(
      `[autopilote][montage] panne inattendue : ${diagnosticSur(
        e instanceof Error ? e.message : String(e),
      )}`,
    );
    return NextResponse.json(
      { ok: false, error: 'Une erreur interne est survenue.', motif: 'erreur_interne' },
      { status: 500 },
    );
  }
}
