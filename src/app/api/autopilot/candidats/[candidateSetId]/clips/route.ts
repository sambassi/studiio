/**
 * M3-F — LA ROUTE QUI MATÉRIALISE UN JEU DE CLIPS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE NAVIGATEUR NE DONNE AUCUN TIMECODE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le corps ne porte qu'un `transcriptionId`. Les bornes viennent de M3-E,
 * appelé ICI, côté serveur, par sa fonction pure — pas par un aller-retour
 * HTTP, et surtout pas par ce que l'appelant voudrait bien annoncer.
 *
 * Accepter des timecodes du client laisserait extraire n'importe quel morceau
 * de n'importe quel rush possédé, en contournant toute la chaîne C → D → E.
 * Le contrat de cette route n'a donc PAS de champ pour cela, et un test le
 * vérifie sur le source.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 202, ET NON 200 : LE TRAVAIL SURVIT À LA RÉPONSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Mesuré : un jeu de cinq clips coûte une trentaine de secondes de CPU sur
 * quatre cœurs partagés. Un rush long dépasserait toute requête raisonnable,
 * et un redéploiement à mi-parcours perdrait tout. La ligne est donc créée,
 * le découpage lancé sans être attendu, et l'avancement se lit par
 * `GET /api/autopilot/clips/[clipSetId]`.
 *
 * ⚠️ AUCUN CRÉDIT, AUCUN FOURNISSEUR. M3-F n'appelle personne : son coût est
 * du CPU local. Facturer ici ferait payer deux fois le montage livrable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireRush } from '@/lib/autopilot/tournage/service';
import { lireAnalyse } from '@/lib/autopilot/analyse/service';
import { lireGenerationParId } from '@/lib/autopilot/analyse/candidat-service';
import {
  lireTranscriptionParId, lireDerniereTranscriptionReussie,
} from '@/lib/autopilot/analyse/transcription-service';
import { calerCoupes } from '@/lib/autopilot/analyse/coupe';
import { ALGORITHME_COUPES, nombreFini } from '@/lib/autopilot/analyse/coupe-contrat';
import {
  creerSet, lireSetReussiIdentique, majSet,
} from '@/lib/autopilot/analyse/clip-service';
import { materialiserSet, coupesRetenues } from '@/lib/autopilot/analyse/clip';
import {
  identifiantValide, type IdentiteClipSet, type MotifClips,
} from '@/lib/autopilot/analyse/clip-contrat';
import {
  prendrePlaceClips, RETRY_APRES_SECONDES,
  MOTIF_CAPACITE_SATUREE, MESSAGE_CAPACITE_SATUREE,
} from '@/lib/autopilot/analyse/capacite';
import type { TranscriptionRush } from '@/lib/autopilot/analyse/transcription-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Trente secondes — le budget de la RÉPONSE, pas du travail.
 *
 * Tout ce qui précède le 202 est local : quatre lectures indexées, un calage
 * pur, une insertion. Le découpage, lui, continue derrière la réponse et n'a
 * aucune raison d'être borné par elle.
 */
export const maxDuration = 30;

const SOCLE_ABSENT = 'La table des clips n’existe pas encore sur ce serveur.';

const REFUS: Record<string, { message: string; statut: number }> = {
  identifiant_invalide: { message: 'Identifiant invalide.', statut: 422 },
  generation_non_reussie: {
    message: 'Cette recherche de passages n’a pas abouti.', statut: 409,
  },
  candidats_absents: {
    message: 'Cette recherche de passages n’a proposé aucun moment.', statut: 409,
  },
  duree_inconnue: { message: 'La durée de ce rush n’a pas été mesurée.', statut: 409 },
  rush_non_verifie: {
    message: 'Ce rush n’a pas été vérifié dans le stockage.', statut: 409,
  },
  transcription_autre_rush: {
    message: 'Cette transcription ne concerne pas le rush de ces passages.', statut: 409,
  },
  transcription_non_reussie: {
    message: 'Cette transcription n’a pas abouti.', statut: 409,
  },
  decision_invalide: {
    message: 'Aucun passage de ce jeu n’est découpable.', statut: 409,
  },
  set_actif_existant: {
    message: 'Une découpe de ces passages est déjà en cours.', statut: 409,
  },
};

function refus(motif: keyof typeof REFUS) {
  const r = REFUS[motif];
  return NextResponse.json({ ok: false, error: r.message, motif }, { status: r.statut });
}

/** Ce que l'écran reçoit d'un jeu — la ligne, sans rien de plus. */
function setPublic(set: {
  id: string; etat: string; etape: string | null; version: number;
  candidateSetId: string; candidateSetVersion: number; rushId: string; analysisId: string;
  transcriptionId: string | null; transcriptionVersion: number | null;
  algorithme: string; clips: unknown[]; usage: Record<string, unknown>;
  motifEchec: string | null; createdAt: string; startedAt: string | null;
  completedAt: string | null; updatedAt: string;
}) {
  return set;
}

export async function POST(
  req: NextRequest, { params }: { params: { candidateSetId: string } },
) {
  let place: { liberer(): void } | null = null;
  let libereeParLeTravail = false;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    if (!identifiantValide(params.candidateSetId)) return refus('identifiant_invalide');

    // ── Le corps : un identifiant de transcription, et RIEN d'autre ──────
    const brut = (await req.text()).trim();
    let corps: Record<string, unknown> = {};
    if (brut.length > 0) {
      let json: unknown;
      try { json = JSON.parse(brut); } catch {
        return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
      }
      if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 422 });
      }
      corps = json as Record<string, unknown>;
    }
    // ⚠️ REFUSÉ, JAMAIS IGNORÉ. Un champ ignoré laisse croire qu'il a été pris
    // en compte, et c'est exactement ce qu'espère celui qui l'envoie.
    for (const interdit of ['debutSecondes', 'finSecondes', 'coupes', 'clips',
      'bucket', 'cle', 'cleObjet', 'rushId', 'userId', 'user_id']) {
      if (Object.prototype.hasOwnProperty.call(corps, interdit)) {
        return NextResponse.json(
          { ok: false, error: `Le champ « ${interdit} » est decide par le serveur.` },
          { status: 422 },
        );
      }
    }

    // ── Le jeu de candidats, désigné par son identifiant ─────────────────
    const { generation, motif: motifGen } = await lireGenerationParId(
      userId, params.candidateSetId,
    );
    if (motifGen === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du travail d'un tiers.
    if (!generation) {
      return NextResponse.json({ ok: false, error: 'Passages introuvables' }, { status: 404 });
    }
    if (generation.etat !== 'reussie') return refus('generation_non_reussie');
    if (generation.candidats.length === 0) return refus('candidats_absents');

    // ── L'analyse SOURCE — celle de ce jeu, et aucune autre ──────────────
    const { analyse } = await lireAnalyse(userId, generation.analysisId);
    if (!analyse || analyse.rushId !== generation.rushId) {
      return NextResponse.json({ ok: false, error: 'Passages introuvables' }, { status: 404 });
    }
    const dureeRush = nombreFini(analyse.dureeSecondes);
    if (dureeRush === null || dureeRush <= 0) return refus('duree_inconnue');

    // ── Le rush : ses octets doivent avoir été constatés ─────────────────
    const { rush } = await lireRush(userId, generation.rushId);
    if (!rush) {
      return NextResponse.json({ ok: false, error: 'Passages introuvables' }, { status: 404 });
    }
    if (rush.etat !== 'verifie') return refus('rush_non_verifie');

    // ── La transcription : demandée, ou résolue PUIS FIGÉE ───────────────
    //
    // ⚠️ M3-E tolère l'absence parce qu'il ne produit rien. M3-F produit des
    // octets dont il faudra rendre compte : ce qui est retenu ici est écrit
    // dans la ligne, et aucun « dernier » ne pourra plus le changer.
    const demande = corps.transcriptionId;
    let transcription: TranscriptionRush | null = null;
    if (demande !== undefined && demande !== null) {
      if (!identifiantValide(demande)) return refus('identifiant_invalide');
      const lu = await lireTranscriptionParId(userId, demande);
      if (lu.motif === 'socle_absent') {
        return NextResponse.json(
          { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
        );
      }
      if (!lu.transcription) {
        return NextResponse.json(
          { ok: false, error: 'Transcription introuvable' }, { status: 404 },
        );
      }
      // Découper sur la parole d'un AUTRE rush produirait des clips
      // plausibles et faux.
      if (lu.transcription.rushId !== generation.rushId) return refus('transcription_autre_rush');
      if (lu.transcription.etat !== 'reussie') return refus('transcription_non_reussie');
      transcription = lu.transcription;
    } else {
      const lu = await lireDerniereTranscriptionReussie(userId, generation.rushId);
      if (lu.motif === 'socle_absent') {
        return NextResponse.json(
          { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
        );
      }
      // Aucune transcription réussie n'est pas une erreur : le rush se découpe
      // sur la seule décision visuelle et audio.
      transcription = lu.transcription;
    }

    // ── LA DÉCISION M3-E, CALCULÉE ICI ──────────────────────────────────
    const decision = calerCoupes({
      dureeRushSecondes: dureeRush,
      candidats: generation.candidats,
      silences: Array.isArray(analyse.audio?.silences)
        ? (analyse.audio.silences as { debutSecondes: number; finSecondes: number }[])
        : [],
      audioEtatMesure: analyse.audio?.etatMesure === 'mesuree' ? 'mesuree'
        : analyse.audio?.etatMesure === 'absente' ? 'absente' : 'indisponible',
      transcriptionRetenue: transcription !== null,
      parolePresente: transcription?.presente === true,
      segments: transcription?.segments ?? [],
      mots: transcription?.mots ?? [],
    });
    if (coupesRetenues(decision.coupes).length === 0) return refus('decision_invalide');

    const identite: IdentiteClipSet = {
      candidateSetId: generation.id,
      candidateSetVersion: generation.version,
      rushId: generation.rushId,
      analysisId: generation.analysisId,
      transcriptionId: transcription?.id ?? null,
      transcriptionVersion: transcription?.version ?? null,
      algorithme: ALGORITHME_COUPES,
    };

    // ── LA RÉUTILISATION, AVANT TOUT TRAVAIL ────────────────────────────
    //
    // ⚠️ M3-F EST DÉTERMINISTE, CONTRAIREMENT À M3-C ET M3-D2. Les mêmes
    // bornes sur les mêmes octets produisent le même fichier : refaire
    // coûterait trente secondes de CPU pour un résultat identique, et
    // changerait les clés de stockage sans qu'aucun besoin ne le demande.
    const existant = await lireSetReussiIdentique(userId, identite);
    if (existant.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (existant.set) {
      return NextResponse.json(
        { ok: true, reutilise: true, clipSet: setPublic(existant.set) }, { status: 200 },
      );
    }

    // ── La place, AVANT la première écriture ────────────────────────────
    place = prendrePlaceClips();
    if (!place) {
      return NextResponse.json(
        { ok: false, error: MESSAGE_CAPACITE_SATUREE, motif: MOTIF_CAPACITE_SATUREE },
        { status: 429, headers: { 'Retry-After': String(RETRY_APRES_SECONDES) } },
      );
    }

    // ── La ligne, AVANT tout travail ────────────────────────────────────
    const creation = await creerSet(userId, identite);
    if (creation.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (creation.motif === 'set_actif_existant') return refus('set_actif_existant');
    const ligne = creation.set!;

    // ── Le travail, DERRIÈRE la réponse ─────────────────────────────────
    //
    // La place est transmise au travail : c'est lui qui la rendra, à la fin,
    // dans son propre `finally`. La rendre ici la libérerait pendant que six
    // ffmpeg tournent encore.
    const placeDuTravail = place;
    libereeParLeTravail = true;
    void executerSet(userId, ligne.id, rush, decision.coupes, placeDuTravail);

    return NextResponse.json(
      { ok: true, reutilise: false, clipSet: setPublic(ligne) }, { status: 202 },
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 },
    );
  } finally {
    // Rendue ICI seulement si le travail n'a pas été lancé — sinon c'est lui
    // qui la tient, et la rendre deux fois ouvrirait une place qui n'existe pas.
    if (!libereeParLeTravail) place?.liberer();
  }
}

/**
 * Le découpage lui-même, détaché de la requête.
 *
 * Ne lève jamais : toute issue est écrite dans la ligne, sans quoi un jeu
 * resterait `en_attente` pour toujours et occuperait le verrou d'unicité.
 */
async function executerSet(
  userId: string,
  clipSetId: string,
  rush: { bucket: string; cleObjet: string },
  coupes: readonly import('@/lib/autopilot/analyse/coupe-contrat').Coupe[],
  place: { liberer(): void },
): Promise<void> {
  try {
    await majSet(userId, clipSetId, { etat: 'en_cours', etape: 'extraction', demarre: true });

    const r = await materialiserSet({
      userId,
      clipSetId,
      source: { bucket: rush.bucket, cleObjet: rush.cleObjet, userId },
      coupes,
    });

    if (!r.ok) {
      // ⚠️ LA CAUSE FINE VA AU JOURNAL, ET NULLE PART AILLEURS — et sans le
      // moindre chemin ni la moindre URL.
      console.warn(`[autopilote][clips] ${r.motif} set=${clipSetId}`);
      await majSet(userId, clipSetId, {
        etat: 'echouee', motifEchec: r.motif as MotifClips, usage: r.usage, termine: true,
      });
      return;
    }

    await majSet(userId, clipSetId, {
      etat: 'reussie', etape: 'televersement',
      clips: r.clips, usage: r.usage, motifEchec: null, termine: true,
    });
  } catch {
    // Le message n'est PAS repris : il peut porter un chemin ou une URL.
    try {
      await majSet(userId, clipSetId, {
        etat: 'echouee', motifEchec: 'extraction_echouee', termine: true,
      });
    } catch { /* la ligne se fermera par péremption */ }
  } finally {
    place.liberer();
  }
}

/** Exportée pour les tests : c'est le travail détaché, sans la couche HTTP. */
export { executerSet as executerSetPourTests };
