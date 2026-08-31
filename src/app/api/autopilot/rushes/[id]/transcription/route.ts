/**
 * M3-D2 — LA ROUTE DE LA TRANSCRIPTION.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE GARANTIT, ET DANS QUEL ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. La session, et rien d'autre, décide de `user_id`.
 *   2. Le rush est lu AVEC le filtre de propriété : le rush d'autrui ne
 *      revient pas, donc il n'y a rien à décider ici.
 *   3. Si M3-D1 a ÉTABLI que le rush ne porte aucune piste, la transcription
 *      se clôt `reussie` avec `presente: false` — SANS extraire un octet et
 *      SANS appeler personne.
 *   4. La place est prise AVANT la première écriture.
 *   5. La ligne est créée AVANT tout travail — elle existe donc même si le
 *      processus meurt.
 *   6. L'idempotence est portée par `rush_transcriptions_active_unique`, EN
 *      BASE. Cette route ne fait aucun `select` qui autoriserait l'insertion.
 *   7. Le fournisseur est appelé UNE fois. Aucune reprise.
 *
 * ⚠️ CETTE ROUTE NE TOUCHE AUCUNE ANALYSE. Elle lit `rush_analyses` pour deux
 * choses seulement — la durée mesurée et le verdict audio de M3-D1 — et n'y
 * écrit jamais. `rush_analyses.parole`, `rush_analyses.audio` et les
 * candidats M3-C sont hors de son périmètre.
 *
 * ⚠️ AUCUN DÉBIT DE CRÉDITS. `usage` est une mesure. Ce fichier n'importe pas
 * `@/lib/credits`, et un test le vérifie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireRush } from '@/lib/autopilot/tournage/service';
import { lireDerniereAnalyse } from '@/lib/autopilot/analyse/service';
import {
  creerTranscription, majTranscription, lireDerniereTranscription,
} from '@/lib/autopilot/analyse/transcription-service';
import { chargerFournisseurTranscription } from '@/lib/autopilot/analyse/moteur-transcription';
import { transcrireRush } from '@/lib/autopilot/analyse/transcription';
import {
  transcriptionPourBase, transcriptionSansAudio, FOURNISSEUR_TRANSCRIPTION,
  type MotifTranscription,
} from '@/lib/autopilot/analyse/transcription-contrat';
import {
  prendrePlaceTranscription, RETRY_APRES_SECONDES,
  MOTIF_CAPACITE_SATUREE, MESSAGE_CAPACITE_SATUREE,
} from '@/lib/autopilot/analyse/capacite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 360 s — la SOMME des budgets internes que cette requête enchaîne :
 * `BUDGET_FLAC_MS` (130 s) plus `TIMEOUT_TRANSCRIPTION_MS` (180 s), et la
 * marge de la lecture de base.
 *
 * ⚠️ COMME AILLEURS, CETTE DÉCLARATION NE PROTÈGE RIEN SUR NOTRE HÉBERGEMENT.
 * `maxDuration` est une limite de plateforme : Vercel l'applique, le serveur
 * Node autonome de Coolify NON. Ce qui borne réellement est INTERNE :
 * `TIMEOUT_MINIO_MS` < `TIMEOUT_FLAC_MS` < `TIMEOUT_TRANSCRIPTION_MS` <
 * `PEREMPTION_TRANSCRIPTION_MS`.
 */
export const maxDuration = 360;

const SOCLE_TRANSCRIPTION_ABSENT =
  'La table des transcriptions n’existe pas encore sur ce serveur.';

/** Ce que chaque motif dit à l'écran, et avec quel statut. */
const REFUS: Record<string, { message: string; statut: number }> = {
  rush_non_verifie: {
    message: 'Ce rush n’a pas été vérifié dans le stockage : il ne peut pas être transcrit.',
    statut: 409,
  },
  duree_inconnue: {
    message: 'La durée de ce rush n’a pas été mesurée : analysez-le d’abord.', statut: 409,
  },
  cle_hors_perimetre: {
    message: 'Ce rush n’est pas lisible dans le stockage.', statut: 422,
  },
  stockage_injoignable: {
    message: 'Le stockage n’a pas répondu.', statut: 503,
  },
  outil_absent: {
    message: 'L’outil audio n’est pas disponible sur ce serveur.', statut: 503,
  },
  audio_illisible: {
    message: 'La bande son de ce rush n’a pas pu être extraite.', statut: 422,
  },
  audio_trop_long: {
    message: 'La bande son de ce rush est trop longue pour être transcrite en une fois.',
    statut: 413,
  },
  fournisseur_absent: {
    message: 'La transcription n’est pas activée sur ce serveur.', statut: 503,
  },
  fournisseur_en_erreur: {
    message: 'La transcription a échoué.', statut: 502,
  },
  reponse_illisible: {
    message: 'La transcription a rendu un résultat inexploitable.', statut: 500,
  },
  resultat_transcription_invalide: {
    message: 'La transcription a rendu un résultat inexploitable.', statut: 500,
  },
  timeout: {
    message: 'L’extraction de la bande son a dépassé le temps imparti.', statut: 504,
  },
};

function refusDe(motif: MotifTranscription) {
  return REFUS[motif] ?? REFUS.resultat_transcription_invalide;
}

/**
 * La durée qui borne tous les instants, et d'où elle vient.
 *
 * ⚠️ L'ANALYSE D'ABORD, LE RUSH ENSUITE. `rush_analyses.duree_secondes` est
 * la mesure FAISANT FOI — celle que ffprobe a produite ;
 * `rushes.duree_secondes` n'en est qu'une copie de confort, et elle peut être
 * `null` sur un rush jamais analysé.
 *
 * Aucune des deux : on REFUSE. Sans durée, rien ne borne les instants rendus
 * par le fournisseur, et un contrat qui ne peut pas vérifier ses bornes ne
 * vérifie rien.
 */
function dureeUtilisable(
  analyse: { dureeSecondes: number | null } | null, rush: { dureeSecondes: number | null },
): number | null {
  for (const mesure of [analyse?.dureeSecondes, rush.dureeSecondes]) {
    if (typeof mesure === 'number' && Number.isFinite(mesure) && mesure > 0) {
      return mesure;
    }
  }
  return null;
}

/**
 * Le verdict de M3-D1 : ce rush porte-t-il une piste ?
 *
 * ⚠️ SEUL `present === false` COURT-CIRCUITE. C'est la distinction que M3-D1
 * a été écrit pour porter : `present: false` veut dire « le fichier ne porte
 * aucune piste », et rien d'autre. Une mesure INDISPONIBLE laisse `present`
 * à `true` ou `null` — on ne sait pas, donc on essaie, et c'est ffmpeg qui
 * tranchera. Confondre les deux ferait sauter la transcription d'un rush
 * parlé sur une simple panne de mesure.
 */
function rushSansPiste(analyse: { audio: Record<string, unknown> } | null): boolean {
  return analyse?.audio?.present === false && analyse?.audio?.etatMesure === 'absente';
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // Le rush d'abord : sans lui, un rush inexistant et un rush jamais
    // transcrit répondraient la même chose, et l'écran ne saurait pas s'il
    // doit proposer « Transcrire ».
    const { rush } = await lireRush(userId, params.id);
    if (!rush) return NextResponse.json({ ok: false, error: 'Rush introuvable' }, { status: 404 });

    // ⚠️ LES MOTS SONT SUR DEMANDE EXPLICITE. L'écran affiche du texte et des
    // phrases ; les mots horodatés pèsent des centaines de kilo-octets et ne
    // servent qu'au futur moteur de coupe. Les rendre par défaut les ferait
    // transiter à chaque rafraîchissement.
    const avecMots = req.nextUrl.searchParams.get('mots') === '1';

    const { transcription, motif } = await lireDerniereTranscription(userId, params.id, avecMots);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_TRANSCRIPTION_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: true, transcription },
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

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  let place: { liberer(): void } | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // ── Le rush ───────────────────────────────────────────────────────────
    //
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du rush d'un tiers.
    const { rush } = await lireRush(userId, params.id);
    if (!rush) return NextResponse.json({ ok: false, error: 'Rush introuvable' }, { status: 404 });

    // `indexe` veut dire « enregistré sans preuve » : personne n'a vérifié
    // que le fichier est là. Envoyer ffmpeg chercher un fichier dont on sait
    // déjà qu'on ne l'a pas vu serait une dépense sans objet.
    if (rush.etat !== 'verifie') {
      return NextResponse.json(
        { ok: false, error: REFUS.rush_non_verifie.message, motif: 'rush_non_verifie' },
        { status: REFUS.rush_non_verifie.statut },
      );
    }

    // ── Ce que M3-D1 a établi ─────────────────────────────────────────────
    //
    // La lecture est SANS EFFET : rien n'est écrit sur l'analyse, ni ici ni
    // plus bas.
    const { analyse } = await lireDerniereAnalyse(userId, params.id);
    const analyseReussie = analyse && analyse.etat === 'reussie' ? analyse : null;

    const duree = dureeUtilisable(analyseReussie, rush);
    if (duree === null) {
      return NextResponse.json(
        { ok: false, error: REFUS.duree_inconnue.message, motif: 'duree_inconnue' },
        { status: REFUS.duree_inconnue.statut },
      );
    }

    // ── La place, AVANT la première écriture ──────────────────────────────
    //
    // APRÈS les refus — session, propriété, état d'ingestion, durée — parce
    // qu'une requête qui n'avait pas le droit de transcrire ne doit pas
    // s'entendre dire que le serveur est plein : ce serait lui faire
    // réessayer un refus définitif.
    place = prendrePlaceTranscription();
    if (!place) {
      // 429, et non 503 : le service fonctionne, il est occupé. Aucune
      // écriture, donc aucune ligne à nettoyer.
      return NextResponse.json(
        { ok: false, error: MESSAGE_CAPACITE_SATUREE, motif: MOTIF_CAPACITE_SATUREE },
        { status: 429, headers: { 'Retry-After': String(RETRY_APRES_SECONDES) } },
      );
    }

    // ── La ligne, AVANT tout travail ──────────────────────────────────────
    const creation = await creerTranscription(userId, params.id);
    if (creation.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_TRANSCRIPTION_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    if (creation.motif === 'transcription_active_existante') {
      // 409 : la contrainte de la base a tranché, pas un `if` de cette route.
      return NextResponse.json(
        {
          ok: false,
          error: 'Une transcription de ce rush est déjà en cours.',
          motif: 'transcription_active_existante',
        },
        { status: 409 },
      );
    }
    const ligne = creation.transcription!;

    // ── Rush sans piste : un RÉSULTAT, pas un échec ───────────────────────
    //
    // ⚠️ POURQUOI UNE LIGNE `reussie` ET NON UN REFUS.
    //
    // « Ce rush ne contient pas de parole » est une RÉPONSE à la question
    // posée, et une réponse qui ne changera pas : le fichier ne change pas.
    // La consigner, c'est permettre au futur moteur de coupe de la lire au
    // lieu de la redemander, et à l'écran d'afficher « pas de parole » plutôt
    // qu'un bouton qui semble n'avoir jamais été cliqué.
    //
    // `echouee` serait un mensonge : rien n'a échoué.
    if (rushSansPiste(analyseReussie)) {
      const vide = transcriptionPourBase(transcriptionSansAudio(), duree);
      const clot = await majTranscription(userId, ligne.id, {
        etat: 'reussie',
        etape: null,
        ...vide,
        // Aucun fournisseur : personne n'a été appelé, et l'écrire ferait
        // croire le contraire.
        fournisseurs: {},
        usage: {},
        motifEchec: null,
        demarree: true,
        terminee: true,
      });
      if (!clot.ok) {
        return NextResponse.json(
          { ok: false, error: 'Résultat non consigné.', motif: clot.motif }, { status: 409 },
        );
      }
      const { transcription } = await lireDerniereTranscription(userId, params.id);
      return NextResponse.json({ ok: true, transcription }, { status: 201 });
    }

    // ── Le fournisseur ────────────────────────────────────────────────────
    //
    // Chargé APRÈS la création : si le serveur n'a pas d'adaptateur, la ligne
    // existe déjà et se clôt `echouee` avec un motif nommé, plutôt que de
    // laisser l'utilisateur devant un bouton qui ne fait rien.
    let fournisseur;
    try {
      fournisseur = await chargerFournisseurTranscription();
    } catch {
      // `ConfigurationTranscriptionInvalide` : le drapeau est posé mais la
      // clé ou le modèle manque. Le message n'est PAS repris — il nomme une
      // variable d'environnement.
      await majTranscription(userId, ligne.id, {
        etat: 'echouee', motifEchec: 'fournisseur_absent', terminee: true,
      });
      return NextResponse.json(
        { ok: false, error: REFUS.fournisseur_absent.message, motif: 'fournisseur_absent' },
        { status: REFUS.fournisseur_absent.statut },
      );
    }
    if (!fournisseur) {
      await majTranscription(userId, ligne.id, {
        etat: 'echouee', motifEchec: 'fournisseur_absent', terminee: true,
      });
      return NextResponse.json(
        { ok: false, error: REFUS.fournisseur_absent.message, motif: 'fournisseur_absent' },
        { status: REFUS.fournisseur_absent.statut },
      );
    }

    await majTranscription(userId, ligne.id, {
      etat: 'en_cours',
      etape: 'extraction_audio',
      // L'identité provisoire : le modèle n'est pas encore connu, il est
      // corrigé à la clôture avec celui réellement employé.
      fournisseurs: { transcription: { ...FOURNISSEUR_TRANSCRIPTION } },
      demarree: true,
    });

    // ⚠️ UN SEUL APPEL, sans reprise. Le fichier temporaire est supprimé par
    // `avecAudioFlac`, y compris si ceci lève.
    let resultat;
    try {
      resultat = await transcrireRush(
        { bucket: rush.bucket, cleObjet: rush.cleObjet, userId, dureeSecondes: duree },
        fournisseur,
      );
    } catch {
      await majTranscription(userId, ligne.id, {
        etat: 'echouee', etape: 'transcription',
        motifEchec: 'fournisseur_en_erreur', terminee: true,
      });
      return NextResponse.json(
        { ok: false, error: REFUS.fournisseur_en_erreur.message, motif: 'fournisseur_en_erreur' },
        { status: REFUS.fournisseur_en_erreur.statut },
      );
    }

    if (!resultat.ok) {
      // ⚠️ LA CAUSE FINE VA AU JOURNAL, ET NULLE PART AILLEURS. Le motif
      // public ne change pas, et le nom d'un champ interne n'a rien à faire
      // devant l'utilisateur.
      if (resultat.detail !== undefined) {
        console.warn(
          `[autopilote][transcription] ${resultat.motif} transcription=${ligne.id}`,
        );
      }
      await majTranscription(userId, ligne.id, {
        etat: 'echouee',
        etape: resultat.motif === 'fournisseur_en_erreur' ? 'transcription' : 'extraction_audio',
        motifEchec: resultat.motif,
        terminee: true,
      });
      const refus = refusDe(resultat.motif);
      return NextResponse.json(
        { ok: false, error: refus.message, motif: resultat.motif }, { status: refus.statut },
      );
    }

    // ── LA SEULE ÉCRITURE DE `reussie` DE TOUT LE CHEMIN ──────────────────
    //
    // Ceinture de dernier moment : `transcriptionPourBase` reborne tout ce
    // qui entre, même si le contrat l'a déjà fait — ce qui va en base ne doit
    // jamais dépendre d'un seul contrôle.
    const propre = transcriptionPourBase(resultat.transcription, duree);
    const clot = await majTranscription(userId, ligne.id, {
      etat: 'reussie',
      etape: 'transcription',
      // ⚠️ LE MODÈLE RÉELLEMENT EMPLOYÉ, et il vient d'une CONSTANTE de
      // l'adaptateur — jamais d'un champ de la réponse.
      fournisseurs: {
        transcription: { ...FOURNISSEUR_TRANSCRIPTION, modele: resultat.modele },
      },
      ...propre,
      usage: resultat.usage,
      motifEchec: null,
      terminee: true,
    });
    if (!clot.ok) {
      return NextResponse.json(
        { ok: false, error: 'Résultat non consigné.', motif: clot.motif }, { status: 409 },
      );
    }

    const { transcription } = await lireDerniereTranscription(userId, params.id);
    return NextResponse.json({ ok: true, transcription }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 },
    );
  } finally {
    // La seule libération, et elle couvre tout : un `return` de succès, un
    // refus contrôlé, une exception, un dépassement de délai.
    place?.liberer();
  }
}
