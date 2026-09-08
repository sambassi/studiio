/**
 * A_7d4 — CREER UN MONTAGE A PARTIR DE PLUSIEURS RUSHES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI UNE ROUTE, ET PAS UN ELARGISSEMENT DE L'EXISTANTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `/api/autopilot/clips/{clipSetId}/montage` encode UN jeu de clips DANS SON
 * CHEMIN. Lui faire soudain accepter N rushes en la laissant sous cette URL
 * donnerait une route dont l'adresse ment sur ce qu'elle fait : le
 * `clipSetId` du chemin deviendrait « l'un des jeux, peut-etre », et tout
 * appelant existant devrait deviner lequel. Le contrat mono-rush reste donc
 * intact, et celui-ci vit a cote.
 *
 * ⚠️ ELLE NE DECIDE RIEN, ET NE DUPLIQUE RIEN. Elle valide l'entree, prouve la
 * propriete, et delegue a `monterMultiRush` — LE MEME service que le cycle
 * automatique appelle. Une seconde implementation pour le manuel donnerait
 * deux facons de preparer, de planifier et d'ecrire, et le jour ou l'une
 * serait corrigee, l'autre continuerait.
 *
 * ⚠️ LE NAVIGATEUR N'ENVOIE QUE DES INTENTIONS. Des identifiants de rush, un
 * format, une duree, un objectif. Ni URL, ni chemin de fichier, ni
 * transcription, ni jeu de clips : la lignee rush -> analyse -> candidats ->
 * clips -> transcription se resout ICI, par les services qui la connaissent.
 * La lui faire construire reviendrait a lui faire choisir quels octets monter.
 *
 * ⚠️ ELLE NE REND PAS. Elle rend un PLAN ; le rendu reste
 * `/api/autopilot/montages/{planId}/rendu`, qui sait deja rendre un plan
 * multi-source depuis A_7c et lui fournir ses sous-titres par source depuis
 * A_7d1. Deux chemins de rendu auraient donne deux facons de rendre.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { identifiantValide } from '@/lib/autopilot/analyse/clip-contrat';
import { formatValide } from '@/lib/autopilot/analyse/montage-contrat';
import { MAX_RUSHES_MANUEL, SOURCES_RETENUES_MIN } from '@/lib/autopilot/analyse/montage-pool';
import { lireRush } from '@/lib/autopilot/tournage/service';
import { objectifEffectifUtilisateur } from '@/lib/autopilot/analyse/objectif-compte';
import {
  lireObjectif, normaliserObjectif,
} from '@/lib/autopilot/analyse/objectif-communication';
import { monterMultiRush } from '@/lib/autopilot/automatique/multi-rush';

/** Les bornes de duree du contrat de montage, reprises telles quelles. */
const DUREE_MIN = 1;
const DUREE_MAX = 120;

export async function POST(requete: NextRequest): Promise<NextResponse> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'Non authentifié' }, { status: 401 });
  }

  let corps: Record<string, unknown>;
  try {
    corps = await requete.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Corps illisible' }, { status: 400 });
  }

  /* ── LES IDENTIFIANTS ────────────────────────────────────────────────────
     ⚠️ DEDUPLIQUES ICI AUSSI. Le meme rush envoye deux fois ferait deux
     preparations pour une seule source ; le service les reduit egalement,
     mais un plafond calcule sur une liste non reduite refuserait a tort. */
  const brut = Array.isArray(corps.rushIds) ? corps.rushIds : null;
  if (!brut) {
    return NextResponse.json(
      { ok: false, error: 'Aucun rush sélectionné', motif: 'rush_ids_absents' },
      { status: 400 },
    );
  }
  const rushIds: string[] = [];
  for (const v of brut) {
    if (typeof v !== 'string' || !identifiantValide(v)) {
      return NextResponse.json(
        { ok: false, error: 'Sélection de rushes invalide', motif: 'rush_id_invalide' },
        { status: 400 },
      );
    }
    if (!rushIds.includes(v)) rushIds.push(v);
  }

  if (rushIds.length < SOURCES_RETENUES_MIN) {
    /* ⚠️ CETTE ROUTE NE SERT PAS LE MONO-RUSH. Le chemin historique existe,
       ses rendus sont en base, et le detourner ici ferait basculer un plan a
       une source sous l'identite multi-rush d'A_7M. */
    return NextResponse.json({
      ok: false,
      error: 'Cette création demande au moins deux rushes.',
      motif: 'sources_insuffisantes',
    }, { status: 400 });
  }
  if (rushIds.length > MAX_RUSHES_MANUEL) {
    return NextResponse.json({
      ok: false,
      error: `Vous pouvez assembler jusqu’à ${MAX_RUSHES_MANUEL} rushes dans une vidéo.`,
      motif: 'trop_de_rushes',
    }, { status: 400 });
  }

  /* ── LA PROPRIETE, PROUVEE AVANT LE MOINDRE TRAVAIL ──────────────────────
     ⚠️ `preparerRush` filtre deja par compte a chaque lecture, et un rush
     d'autrui ressortirait simplement « ecarte ». Ce serait un diagnostic FAUX
     — la personne croirait son rush illisible — et surtout une analyse
     lancee, donc payee, avant de decouvrir que la demande etait invalide.
     Le refus est donc pose ICI, avant tout appel de fournisseur.

     Aucune difference de message entre « n'existe pas » et « appartient a
     quelqu'un d'autre » : la distinction apprendrait a un tiers quels
     identifiants existent. */
  for (const id of rushIds) {
    const { rush } = await lireRush(userId, id);
    if (!rush) {
      return NextResponse.json({
        ok: false,
        error: 'Un des rushes sélectionnés n’est plus disponible.',
        motif: 'rush_introuvable',
      }, { status: 404 });
    }
  }

  const format = corps.format;
  if (!formatValide(format)) {
    return NextResponse.json(
      { ok: false, error: 'Format inconnu', motif: 'format_invalide' }, { status: 400 },
    );
  }
  const duree = Number(corps.dureeCibleSecondes);
  if (!Number.isFinite(duree) || duree < DUREE_MIN || duree > DUREE_MAX) {
    return NextResponse.json(
      { ok: false, error: 'Durée hors bornes', motif: 'duree_invalide' }, { status: 400 },
    );
  }

  /* L'objectif de CETTE video s'il est fourni et VALIDE ; sinon celui du
     compte. Un objectif mal forme n'est pas force : il est refuse, comme sur
     la route mono-rush. */
  let objectif = null;
  if (corps.objectif !== undefined && corps.objectif !== null) {
    const lu = lireObjectif(corps.objectif);
    if (!lu.ok) {
      return NextResponse.json(
        { ok: false, error: 'Objectif invalide', motif: 'objectif_invalide' },
        { status: 400 },
      );
    }
    objectif = normaliserObjectif(lu.objectif);
  } else {
    objectif = await objectifEffectifUtilisateur(userId);
  }

  const issue = await monterMultiRush({
    userId, rushIds, format, dureeCibleSecondes: duree, objectif,
  });

  if (issue.plan) {
    return NextResponse.json({
      ok: true,
      plan: { id: issue.plan.id, version: issue.plan.version },
      sources: issue.sources,
      /* ⚠️ CE QUI N'A PAS PU SERVIR EST DIT. « 2 rushes sur 3 ont été
         utilisés » vaut mieux qu'une vidéo plus courte que prevu dont personne
         n'explique pourquoi. */
      ecartees: issue.ecartees,
    }, { status: 201 });
  }

  /* ── LES REFUS, EN FRANCAIS ET SANS DETAIL D'INFRASTRUCTURE ───────────── */
  if (issue.motif === 'source_unique') {
    /* ⚠️ CE N'EST PAS UNE ERREUR, C'EST UN AIGUILLAGE. Une seule source a
       survecu : le montage existe, mais c'est un montage mono-rush, et le
       chemin historique sait le faire. On rend donc de quoi y repartir. */
    return NextResponse.json({
      ok: false,
      motif: 'source_unique',
      rushId: issue.rushUnique,
      ecartees: issue.ecartees,
      error: 'Un seul rush est exploitable : la vidéo sera montée à partir de celui-là.',
    }, { status: 409 });
  }
  if (issue.motif === 'socle_absent') {
    return NextResponse.json({
      ok: false, motif: 'socle_absent',
      error: 'Le montage multi-rush n’est pas encore disponible sur ce serveur.',
    }, { status: 503 });
  }
  return NextResponse.json({
    ok: false,
    motif: issue.motif ?? 'plan_impossible',
    ecartees: issue.ecartees,
    error: issue.motif === 'aucun_rush'
      ? 'Aucun rush exploitable.'
      : 'Impossible de créer cette vidéo pour le moment.',
  }, { status: 422 });
}
