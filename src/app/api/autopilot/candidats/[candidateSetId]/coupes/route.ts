/**
 * M3-E — LA ROUTE DES COUPES INTELLIGENTES.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN `GET` QUI CALCULE — ET POURQUOI IL N'Y A PAS DE `POST`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-C et M3-D2 ont un `POST`, une table, un index d'unicité partiel et une
 * péremption des générations abandonnées. Toute cette machinerie existe pour
 * UNE raison : ils appellent un fournisseur payant, et payer deux fois devait
 * être impossible.
 *
 * M3-E ne paie rien. Le calcul est local, déterministe et instantané ; ses
 * entrées sont déjà persistées et versionnées ailleurs. Un `GET` est donc
 * idempotent par nature — sans verrou, sans reprise, sans rien à nettoyer.
 * La décision se figera au rendu, quand il y aura des octets dont être
 * comptable.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'ENCHAÎNEMENT, ET IL N'EST PAS NÉGOCIABLE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   jeu de candidats (par SON id)
 *     → `analysis_id` de CE jeu  → le D1 de CETTE analyse
 *     → `rush_id`     de CE jeu  → la transcription D2
 *
 * ⚠️ JAMAIS « la dernière analyse du rush ». Un candidat est la conséquence
 * d'une analyse précise ; prendre une autre mesure audio ferait changer de
 * sens un résultat historique sans qu'aucune écriture n'ait eu lieu.
 *
 * ⚠️ CETTE ROUTE N'ÉCRIT RIEN. Aucun `insert`, aucun `update`, aucun `delete`
 * — un test le vérifie sur le source, et un autre compte les écritures.
 * Aucun fournisseur, aucun ffmpeg, aucun stockage, aucun crédit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireAnalyse } from '@/lib/autopilot/analyse/service';
import { lireGenerationParId } from '@/lib/autopilot/analyse/candidat-service';
import {
  lireTranscriptionParId, lireDerniereTranscriptionReussie,
} from '@/lib/autopilot/analyse/transcription-service';
import { calerCoupes } from '@/lib/autopilot/analyse/coupe';
import {
  ALGORITHME_COUPES, nombreFini,
  type SourceTranscription,
} from '@/lib/autopilot/analyse/coupe-contrat';
import type { TranscriptionRush } from '@/lib/autopilot/analyse/transcription-service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Trente secondes, et c'est déjà large.
 *
 * Tout est local : quatre lectures indexées et un calage sur au plus six
 * candidats. Aucun processus, aucun réseau sortant, aucune attente d'un
 * tiers — rien de commun avec les 360 s de la transcription.
 */
export const maxDuration = 30;

const SOCLE_CANDIDATS_ABSENT =
  'La table des passages suggérés n’existe pas encore sur ce serveur.';
const SOCLE_TRANSCRIPTION_ABSENT =
  'La table des transcriptions n’existe pas encore sur ce serveur.';

/** Ce que chaque refus dit à l'écran, et avec quel statut. */
const REFUS: Record<string, { message: string; statut: number }> = {
  identifiant_invalide: {
    message: 'Identifiant invalide.', statut: 422,
  },
  generation_non_reussie: {
    message: 'Cette recherche de passages n’a pas abouti.', statut: 409,
  },
  candidats_absents: {
    message: 'Cette recherche de passages n’a proposé aucun moment.', statut: 409,
  },
  duree_inconnue: {
    message: 'La durée de ce rush n’a pas été mesurée.', statut: 409,
  },
  transcription_autre_rush: {
    message: 'Cette transcription ne concerne pas le rush de ces passages.', statut: 409,
  },
  transcription_non_reussie: {
    message: 'Cette transcription n’a pas abouti.', statut: 409,
  },
};

function refus(motif: keyof typeof REFUS) {
  const r = REFUS[motif];
  return NextResponse.json({ ok: false, error: r.message, motif }, { status: r.statut });
}

/**
 * Un identifiant de ressource acceptable.
 *
 * La forme d'un UUID, et rien d'autre. Sans ce contrôle, une chaîne
 * quelconque partirait jusqu'à PostgREST, qui répondrait une erreur de type —
 * un 500 pour ce qui est une faute d'appelant, donc un 422.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L'état de la mesure audio de M3-D1, tel qu'il vit dans l'analyse.
 *
 * ⚠️ UNE COLONNE `audio` VIDE VAUT `indisponible`, JAMAIS `absente`. Les
 * analyses antérieures à M3-D1 n'ont rien mesuré : dire « ce rush n'a pas de
 * piste » à leur place serait affirmer ce que personne n'a constaté. C'est
 * exactement la distinction que M3-D1 a été écrit pour porter.
 */
function etatMesureAudio(audio: Record<string, unknown>): 'mesuree' | 'absente' | 'indisponible' {
  const etat = audio?.etatMesure;
  if (etat === 'mesuree') return 'mesuree';
  if (etat === 'absente') return 'absente';
  return 'indisponible';
}

/** Les silences de M3-D1, relus depuis le `jsonb` sans rien supposer. */
function silencesDe(audio: Record<string, unknown>) {
  const brut = audio?.silences;
  if (!Array.isArray(brut)) return [];
  return brut.filter(
    (s): s is { debutSecondes: number; finSecondes: number } => (
      typeof s === 'object' && s !== null
      && nombreFini((s as Record<string, unknown>).debutSecondes) !== null
      && nombreFini((s as Record<string, unknown>).finSecondes) !== null
    ),
  );
}

export async function GET(
  req: NextRequest, { params }: { params: { candidateSetId: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    if (!UUID.test(params.candidateSetId ?? '')) return refus('identifiant_invalide');

    // ── 1. LE jeu de candidats, désigné par son identifiant ──────────────
    //
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du travail d'un tiers.
    const { generation, motif: motifGen } = await lireGenerationParId(
      userId, params.candidateSetId,
    );
    if (motifGen === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (!generation) {
      return NextResponse.json({ ok: false, error: 'Passages introuvables' }, { status: 404 });
    }
    if (generation.etat !== 'reussie') return refus('generation_non_reussie');
    if (generation.candidats.length === 0) return refus('candidats_absents');

    // ── 2. L'analyse SOURCE — celle de ce jeu, et aucune autre ───────────
    const { analyse } = await lireAnalyse(userId, generation.analysisId);
    // L'analyse a disparu, ou la clé étrangère composite a été contournée :
    // sans elle, ni durée ni mesure audio. Même réponse que « introuvable ».
    if (!analyse || analyse.rushId !== generation.rushId) {
      return NextResponse.json({ ok: false, error: 'Passages introuvables' }, { status: 404 });
    }

    const dureeRush = nombreFini(analyse.dureeSecondes);
    if (dureeRush === null || dureeRush <= 0) return refus('duree_inconnue');

    // ── 3. La transcription : demandée, ou résolue ───────────────────────
    const demande = req.nextUrl.searchParams.get('transcriptionId');
    let transcription: TranscriptionRush | null = null;
    let source: SourceTranscription = 'aucune';

    if (demande !== null) {
      // ⚠️ UN IDENTIFIANT DEMANDÉ NE RETOMBE JAMAIS SUR UN AUTRE. Résoudre
      // « la dernière » à la place rendrait un résultat qui n'est pas celui
      // qu'on a demandé, sous le même code 200 — le pire des silences.
      if (!UUID.test(demande)) return refus('identifiant_invalide');

      const lu = await lireTranscriptionParId(userId, demande);
      if (lu.motif === 'socle_absent') {
        return NextResponse.json(
          { ok: false, error: SOCLE_TRANSCRIPTION_ABSENT, motif: 'socle_absent' }, { status: 503 },
        );
      }
      if (!lu.transcription) {
        return NextResponse.json(
          { ok: false, error: 'Transcription introuvable' }, { status: 404 },
        );
      }
      // Caler des coupes sur la parole d'un AUTRE rush produirait des
      // fenêtres plausibles et fausses. C'est un conflit d'états, pas une
      // requête malformée : 409.
      if (lu.transcription.rushId !== generation.rushId) return refus('transcription_autre_rush');
      if (lu.transcription.etat !== 'reussie') return refus('transcription_non_reussie');

      transcription = lu.transcription;
      source = 'demandee';
    } else {
      const lu = await lireDerniereTranscriptionReussie(userId, generation.rushId);
      if (lu.motif === 'socle_absent') {
        return NextResponse.json(
          { ok: false, error: SOCLE_TRANSCRIPTION_ABSENT, motif: 'socle_absent' }, { status: 503 },
        );
      }
      // Aucune transcription réussie N'EST PAS une erreur : M3-E continue
      // avec M3-C et la mesure audio.
      if (lu.transcription) { transcription = lu.transcription; source = 'derniere'; }
    }

    // ── 4. Le calage — une fonction pure, sur des données ────────────────
    const resultat = calerCoupes({
      dureeRushSecondes: dureeRush,
      candidats: generation.candidats,
      silences: silencesDe(analyse.audio),
      audioEtatMesure: etatMesureAudio(analyse.audio),
      transcriptionRetenue: transcription !== null,
      parolePresente: transcription?.presente === true,
      segments: transcription?.segments ?? [],
      mots: transcription?.mots ?? [],
    });

    return NextResponse.json(
      {
        ok: true,
        algorithme: ALGORITHME_COUPES,
        candidateSetId: generation.id,
        candidateSetVersion: generation.version,
        analysisId: generation.analysisId,
        rushId: generation.rushId,
        // ⚠️ CE BLOC EST CE QUI REND LA DÉCISION REJOUABLE. Sans
        // `transcriptionId`, le serveur a résolu « la dernière réussie » — un
        // futur rendu rappellera la route avec l'identifiant rendu ici pour
        // figer exactement cette décision. Une réponse qui tairait laquelle a
        // servi ne serait pas rejouable, et le prétendre serait faux.
        transcription: {
          id: transcription?.id ?? null,
          version: transcription?.version ?? null,
          source,
        },
        sources: resultat.sources,
        coupes: resultat.coupes,
      },
      // `private, no-store` : la réponse dépend de la session, et un cache
      // partagé qui la garderait la servirait au visiteur suivant.
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 },
    );
  }
}
