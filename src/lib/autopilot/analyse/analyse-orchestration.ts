/**
 * A_0b — L'ORCHESTRATION DE L'ANALYSE, HORS DE SA ROUTE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE MODULE EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ces 640 lignes vivaient DANS `POST /api/autopilot/rushes/[id]/analyse`.
 * Tant qu'elles y sont restées, un cron ne pouvait pas analyser un rush : la
 * seule façon de déclencher l'analyse était d'avoir une session, un cookie et
 * un navigateur. L'Autopilote automatique en était réduit à monter la matière
 * qu'un humain avait analysée à la main.
 *
 * ⚠️ RIEN N'A ÉTÉ RÉÉCRIT — LE BLOC A ÉTÉ DÉPLACÉ.
 *
 * La seule transformation est l'enveloppe de sortie : `NextResponse.json(x,
 * { status: n })` est devenu `reponse(x, n)`, vingt-trois fois, à
 * l'identique. Aucune condition n'a changé, aucun ordre d'appel, aucun motif,
 * aucun statut. La route rhabille le résultat en HTTP et rend exactement ce
 * qu'elle rendait ; le cron lit le même résultat sans HTTP.
 *
 * C'est ce qui rend l'extraction sûre : une réécriture aurait demandé de
 * relire vingt-trois branches, un déplacement ne demande que de vérifier
 * qu'il n'en manque aucune — ce qu'un test fait à notre place.
 *
 * ⚠️ CE MODULE N'IMPORTE NI `next/server`, NI `auth`, NI `cookies`. C'est la
 * propriété qui le rend appelable depuis un cron. Un test le vérifie sur le
 * source : sans lui, une arête réintroduite un jour de fatigue referait
 * silencieusement la prison dont ce lot sort.
 */
import { majDureeRush } from '@/lib/autopilot/tournage/service';
import {
  creerAnalyse, majAnalyse, listerAnalyses,
} from '@/lib/autopilot/analyse/service';
import { analyseActive, type RushAnalysis } from '@/lib/autopilot/analyse/contrat';
import {
  chargerMoteurExtraction, resultatExtractionValide,
  type MotifExtraction,
} from '@/lib/autopilot/analyse/moteur';
import {
  chargerMoteurVisuel, resultatVisuelEtapeValide, FOURNISSEUR_VISUEL,
  diagnosticVisuelSur,
} from '@/lib/autopilot/analyse/moteur-visuel';
import {
  RETRY_APRES_SECONDES, MOTIF_CAPACITE_SATUREE, MESSAGE_CAPACITE_SATUREE,
} from '@/lib/autopilot/analyse/capacite';
import { mesurerAudio } from '@/lib/autopilot/analyse/audio';
import { audioPourBase, audioIndisponible } from '@/lib/autopilot/analyse/audio-contrat';
import type { Rush } from '@/lib/autopilot/tournage/contrat';

/**
 * Ce qu'une orchestration rend : un corps, un statut, et parfois un en-tête.
 *
 * Le statut n'est pas une fioriture d'API : il PORTE le sens. 409 dit « déjà
 * en cours », 429 « pas de place », 503 « socle absent », 201 « fait ». Le
 * cron s'en sert autant que le navigateur.
 */
export interface ReponseServeur {
  corps: Record<string, unknown>;
  statut: number;
  entetes?: Record<string, string>;
}

const reponse = (
  corps: Record<string, unknown>, statut = 200, entetes?: Record<string, string>,
): ReponseServeur => (entetes ? { corps, statut, entetes } : { corps, statut });

export const SOCLE_TOURNAGE_ABSENT =
  'Rushes indisponibles : migration '
  + '2026-08-31-shoot-sessions-rushes.sql non appliquée sur ce serveur.';

export const SOCLE_ANALYSE_ABSENT =
  'Analyses indisponibles : migration '
  + '2026-09-01-rush-analyses.sql non appliquée sur ce serveur.';

const MOTEUR_ABSENT =
  'Moteur d’extraction indisponible sur ce serveur : '
  + 'src/lib/autopilot/analyse/extraction.ts n’est pas branché.';

/** Le fournisseur de l'étape `extraction` : ffmpeg, chez nous, sans modèle. */
const FOURNISSEUR_EXTRACTION = { fournisseur: 'local' as const, modele: 'ffmpeg' };


/**
 * Ce que l'ecran comprend d'un echec de l'etape VISUELLE.
 *
 * Aucun de ces echecs n'efface la mesure : `dureeSecondes`, `technique` et
 * `vignettes` sont deja consignes quand on arrive ici. L'analyse passe
 * `echouee` a l'etape `visuel`, et ce qui a ete mesure reste lisible.
 */
const REFUS_VISUEL: Record<string, { statut: number; message: string }> = {
  aucune_image: {
    statut: 422,
    message: 'Aucune image exploitable n\u2019a pu \u00eatre lue pour ce rush.',
  },
  fournisseur_en_erreur: {
    statut: 503,
    message: 'La lecture des images n\u2019a pas abouti. R\u00e9essayez plus tard.',
  },
  resultat_visuel_invalide: {
    statut: 500,
    message: 'La lecture des images a rendu un r\u00e9sultat inexploitable.',
  },
};

/**
 * Ce que l'écran comprend d'un échec de mesure, et le code qui va avec.
 *
 * 422 pour les deux échecs qui ne passeront jamais — le fichier est illisible,
 * ou il n'est plus là. Ré-essayer donnerait le même résultat, et le dire évite
 * une boucle. Même code que la route d'indexation pour `objet_absent`, qui
 * répond déjà de la même situation.
 *
 * 504 pour le délai dépassé : c'est le seul échec dont on sait qu'il peut ne
 * pas se reproduire, et le seul qui mérite qu'on relance.
 *
 * 503 pour l'échec sans cause identifiée : la panne est de notre côté. Le même
 * code que « migration absente », et pour la même raison — le service ne peut
 * pas répondre maintenant, ce n'est pas la faute de l'appelant. Le champ
 * `motif` distingue les deux.
 *
 * ⚠️ DEUX MOTIFS DE PLUS QUE PRÉVU, ET ILS NE SE RÉPONDENT PAS PAREIL.
 *
 * Le moteur en distingue six, là où cette table en attendait quatre. Les deux
 * qui manquaient ne sont pas des variantes de `extraction_impossible` :
 *
 * `cle_hors_perimetre`   — la clé indexée ne commence pas par l'identifiant de
 *   son propriétaire. Ce n'est pas une panne, c'est une incohérence entre la
 *   ligne `rushes` et le stockage. Ré-essayer ne changera rien, et le journal
 *   doit le montrer : 422, comme les autres refus définitifs.
 *
 * `stockage_injoignable` — MinIO n'a pas répondu. Transitoire, de notre côté,
 *   et ça mérite une relance : 503, comme `extraction_impossible`, mais avec
 *   un `motif` distinct pour qu'on sache lequel des deux compter.
 */
const REFUS_EXTRACTION: Record<MotifExtraction, { statut: number; message: string }> = {
  format_illisible: {
    statut: 422,
    message: 'Ce fichier n’est pas une vidéo exploitable.',
  },
  objet_introuvable: {
    statut: 422,
    message: 'Le fichier de ce rush n’est plus dans le stockage.',
  },
  timeout: {
    statut: 504,
    message: 'La mesure a dépassé son délai. Relancez l’analyse.',
  },
  extraction_impossible: {
    statut: 503,
    message: 'L’analyse n’a pas abouti. Réessayez plus tard.',
  },
  cle_hors_perimetre: {
    statut: 422,
    message: 'Ce fichier n’appartient pas à votre espace.',
  },
  stockage_injoignable: {
    statut: 503,
    message: 'Le stockage est momentanément injoignable. Réessayez.',
  },
};

/**
 * L'analyse telle qu'elle sort de l'application — sans les clés de stockage.
 *
 * Une clé n'est pas une URL, et le contrat interdit déjà d'en stocker une.
 * Mais une clé est un POINTEUR durable dans le stockage, et la rendre au
 * navigateur inviterait à en fabriquer une URL — alors que tout accès à un
 * média se signe à la demande, pour une durée courte. Le nombre de vignettes
 * et leurs positions suffisent à un écran ; le compartiment, lui, ne sort
 * jamais.
 */
export function analysePublique(analyse: RushAnalysis) {
  const { vignettes, ...reste } = analyse;
  return {
    ...reste,
    vignettes: {
      nombre: vignettes.length,
      secondes: vignettes.map((v) => v.seconde),
    },
  };
}

/**
 * Le 409 « une analyse tourne déjà », écrit UNE fois.
 *
 * Deux endroits le rendent — le refus de la base après `creerAnalyse`, et le
 * refus de capacité qui découvre la même chose avant d'avoir inséré. Recopier
 * la réponse aux deux endroits la ferait diverger d'un mot, et un écran qui
 * teste `motif` marcherait sur l'un et pas sur l'autre.
 *
 * L'analyse gagnante est jointe pour que le perdant sache quoi suivre : sans
 * elle, il n'a qu'un refus et aucun identifiant à interroger.
 */
function reponseAnalyseDejaActive(analyse: RushAnalysis | null): ReponseServeur {
  return reponse({
      ok: false,
      error: 'Une analyse de ce rush est déjà en cours.',
      motif: 'analyse_active_existante',
      analyse: analyse ? analysePublique(analyse) : null,
    },
    409);
}

/**
 * Ce qu'on répond quand il n'y a plus de place — et pourquoi ce n'est pas
 * toujours 429.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNE LECTURE, JAMAIS UNE ÉCRITURE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Avec UNE place, deux requêtes simultanées sur le MÊME rush se croisent
 * forcément ici : la seconde trouve la place prise. Répondre 429 serait vrai
 * mais moins utile — et surtout, ce serait faire disparaître le refus
 * d'idempotence exactement dans le cas où il compte. L'appelant repartirait
 * avec « le serveur est plein, revenez dans 300 s » là où la réponse exacte
 * est « ce rush-là est déjà en cours d'analyse, voici laquelle ».
 *
 * On relit donc les analyses de CE rush. Si l'une est active, c'est le même
 * 409 qu'avant ce lot : le contrat de M3-B1 ne bouge pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CETTE LECTURE N'EST PAS LE `SELECT` QUE LA ROUTE S'INTERDIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le `select` proscrit est celui qui AUTORISERAIT une insertion : entre lui
 * et l'`insert` il y a une fenêtre, et deux requêtes la traversent. Ici, rien
 * ne sera inséré quoi qu'on lise — la décision de refuser est déjà prise. La
 * lecture ne fait que CHOISIR LE MOT du refus.
 *
 * Elle ne peut donc pas se tromper dangereusement : si elle rate l'analyse
 * active (course, ou base injoignable), on retombe sur 429, qui reste un
 * refus. Jamais l'inverse.
 */
export async function refusFauteDePlace(userId: string, rushId: string): Promise<ReponseServeur> {
  let active: RushAnalysis | null = null;
  try {
    const { analyses } = await listerAnalyses(userId, rushId);
    active = analyses.find((a) => analyseActive(a.etat)) ?? null;
  } catch {
    // Une base injoignable ne doit pas transformer un refus en 500 : le refus
    // est déjà décidé, seul son libellé est en jeu.
    active = null;
  }
  if (active) return reponseAnalyseDejaActive(active);

  // 429, et non 503 : le service fonctionne, il est occupé. `Retry-After` est
  // explicite pour que le client sache quand revenir au lieu de marteler — un
  // refus sans délai annoncé se retente tout de suite.
  //
  // Aucune file d'attente : attendre ici consommerait le budget de cette
  // requête à ne rien faire, puis la ferait tuer avant même de mesurer.
  return reponse(
    { ok: false, error: MESSAGE_CAPACITE_SATUREE, motif: MOTIF_CAPACITE_SATUREE },
    429,
    // ⚠️ L'EN-TÊTE SURVIT À L'EXTRACTION. `Retry-After` dit au client QUAND
    // revenir ; le perdre transformerait un refus temporaire poli en un mur.
    { 'Retry-After': String(RETRY_APRES_SECONDES) },
  );
}

/**
 * Le travail lui-même — tout ce qui suit la prise de place.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI C'EST UNE FONCTION À PART, ET NON LA SUITE DE `POST`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Parce que la place doit être rendue quoi qu'il arrive, et que la seule
 * façon de l'écrire sans se tromper est un `finally` qui enveloppe TOUT le
 * travail — pas quelques branches choisies à la main. Un `try` autour de
 * cent quatre-vingts lignes déjà imbriquées se relit mal, et le jour où l'on
 * ajoute une sortie anticipée on ne voit plus si elle est couverte.
 *
 * Ici, l'appelant tient la place et ce corps l'ignore complètement : il ne
 * peut donc pas oublier de la rendre, quel que soit le `return` qu'il prend
 * et même s'il lève.
 *
 * Le rush est passé en argument plutôt que relu : il vient d'être lu par
 * l'appelant, et le relire ouvrirait une fenêtre pendant laquelle son état
 * pourrait changer entre la vérification et l'usage.
 */
/**
 * M3-D1 — LA MESURE AUDIO, JUSTE AVANT LA CLÔTURE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI ICI, ET NULLE PART AILLEURS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `majAnalyse` refuse d'écrire sur une ligne déjà terminée
 * (`.in('etat', ETATS_ACTIFS)`). Une route séparée qui viendrait renseigner
 * `audio` APRÈS coup se heurterait donc à `analyse_close` sur toute analyse
 * `reussie` — c'est-à-dire sur toutes celles qui existent. La mesure doit
 * avoir lieu pendant que l'analyse est encore ACTIVE, et c'est ce que cette
 * fonction garantit : elle n'est appelée qu'immédiatement avant l'écriture
 * qui clôt.
 *
 * L'ordre est donc : extraction → visuel → audio → clôture. L'audio en
 * DERNIER parce qu'il est le moins important des trois : le placer avant le
 * visuel ferait payer sa lecture du fichier entier à une analyse que le
 * visuel va peut-être faire échouer trois secondes plus tard.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ELLE NE PEUT PAS FAIRE ÉCHOUER UNE ANALYSE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun chemin de sortie n'est un échec. `mesurerAudio` rend déjà une issue
 * `indisponible` plutôt que de lever, et le `catch` ci-dessous est la
 * ceinture : perdre un résumé visuel qui a coûté un appel de fournisseur
 * parce qu'une mesure gratuite s'est mal passée serait le pire arbitrage
 * possible.
 *
 * ⚠️ `etape` N'EST PAS TOUCHÉE. Le vocabulaire de la colonne est borné EN
 * BASE à `extraction | visuel | transcription` ; y ajouter « audio »
 * demanderait une migration, que ce lot n'a pas. La provenance de la mesure
 * vit dans l'objet lui-même, sous `mesure.outil`.
 */
async function mesureAudioPourCloture(
  rush: Rush, userId: string, technique: Record<string, unknown>, dureeSecondes: number | null,
): Promise<Record<string, unknown>> {
  // La SEULE autorité sur la présence d'une piste : le sondage ffprobe qui a
  // mesuré la durée. Absent ou non booléen, c'est `null` — « on ne sait pas »
  // — et surtout pas `false`.
  const piste = typeof technique.aAudio === 'boolean' ? technique.aAudio : null;
  try {
    return audioPourBase(await mesurerAudio({
      bucket: rush.bucket,
      cleObjet: rush.cleObjet,
      userId,
      dureeSecondes,
      pisteAttendue: piste,
    }));
  } catch {
    // Le message n'est PAS repris : il pourrait nommer un hôte de stockage.
    return audioPourBase(audioIndisponible('audio_illisible', dureeSecondes, piste));
  }
}

export async function executerAnalyseRush(
  userId: string, rushId: string, rush: Rush,
): Promise<ReponseServeur> {
  // ── La ligne d'analyse, AVANT tout travail ────────────────────────────
  const creation = await creerAnalyse(userId, rushId);
  if (creation.motif === 'socle_absent') {
    return reponse({ ok: false, error: SOCLE_ANALYSE_ABSENT, motif: 'socle_absent' }, 503);
  }
  if (creation.motif === 'rush_introuvable') {
    // Le rush a disparu entre les deux lectures. Rare, mais réel.
    return reponse({ ok: false, error: 'Rush introuvable' }, 404);
  }
  if (creation.motif === 'analyse_active_existante') {
    // 409 : la contrainte de la base a tranché, pas un `if` de cette route.
    // L'analyse gagnante est relue pour que le perdant sache quoi suivre.
    const { analyses } = await listerAnalyses(userId, rushId);
    return reponseAnalyseDejaActive(analyses.find((a) => analyseActive(a.etat)) ?? null);
  }
  const analyse = creation.analyse;
  if (!analyse) {
    return reponse({ ok: false, error: 'Analyse non créée' }, 500);
  }

  // ── Le moteur : chargé APRÈS les refus, pour qu'ils restent gratuits ──
  const moteur = await chargerMoteurExtraction();
  if (!moteur) {
    // L'analyse existe déjà : la laisser `en_attente` pour toujours
    // occuperait le verrou d'unicité et interdirait toute relance. On la
    // clôt.
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: 'moteur_absent',
    });
    return reponse({ ok: false, error: MOTEUR_ABSENT, motif: 'moteur_absent' }, 503);
  }

  // ── `en_cours`, et qui fait le travail ────────────────────────────────
  const demarrage = await majAnalyse(userId, analyse.id, {
    etat: 'en_cours',
    etape: 'extraction',
    fournisseurs: { extraction: FOURNISSEUR_EXTRACTION },
  });
  if (demarrage.motif === 'socle_absent') {
    return reponse({ ok: false, error: SOCLE_ANALYSE_ABSENT, motif: 'socle_absent' }, 503);
  }
  if (demarrage.motif) {
    // `analyse_close` ou `analyse_introuvable` : quelqu'un l'a fermée entre
    // sa création et ici. On ne mesure pas une analyse qu'on ne tient plus.
    return reponse({ ok: false, error: 'Analyse close avant son démarrage.', motif: demarrage.motif },
      409);
  }

  // ── Une seule mesure. Pas de reprise, pas de second essai ─────────────
  let resultatBrut: unknown;
  try {
    resultatBrut = await moteur({
      bucket: rush.bucket,
      cleObjet: rush.cleObjet,
      userId,
      analysisId: analyse.id,
    });
  } catch (e: unknown) {
    // Le moteur a levé : ce n'est pas un des quatre échecs prévus, c'est un
    // bug. L'analyse est close quand même — une ligne `en_cours` abandonnée
    // occuperait le verrou et interdirait toute relance.
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: 'moteur_en_erreur',
    });
    const message = e instanceof Error ? e.message : 'extraction impossible';
    return reponse({ ok: false, error: message, motif: 'moteur_en_erreur' }, 500);
  }

  const resultat = resultatExtractionValide(resultatBrut);
  if (!resultat) {
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: 'resultat_moteur_invalide',
    });
    return reponse({
        ok: false,
        error: 'Le moteur d’extraction a rendu un résultat inexploitable.',
        motif: 'resultat_moteur_invalide',
      },
      500);
  }

  // ── Échec contrôlé : `echouee` + motif, et le code qui correspond ─────
  if (!resultat.ok) {
    const fin = await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: resultat.motif,
    });
    const refus = REFUS_EXTRACTION[resultat.motif];
    return reponse({
        ok: false,
        error: refus.message,
        motif: resultat.motif,
        analyse: fin.analyse ? analysePublique(fin.analyse) : null,
      },
      refus.statut);
  }

  // ── Succès : le résultat est consigné, PUIS l'état passe `reussie` ────
  //
  // Une seule écriture, parce que `majAnalyse` refuse tout ce qui n'est pas
  // valide AVANT d'écrire : si l'une des trois valeurs ne passe pas, rien
  // n'est écrit et l'état ne ment pas.
  // ⚠️ L'ANALYSE N'EST PAS CLOSE ICI, ET C'EST LE CŒUR DU LOT.
  //
  // `majAnalyse` refuse d'écrire sur une ligne déjà terminée
  // (`.in('etat', ETATS_ACTIFS)`). Marquer `reussie` maintenant fermerait la
  // porte à l'étape suivante — elle rendrait `analyse_close` et le visuel
  // n'aurait nulle part où s'écrire.
  //
  // Ce qui est mesuré est donc CONSIGNÉ sans être clos : un échec du visuel
  // laissera `dureeSecondes`, `technique` et `vignettes` intacts en base.
  const consigne = await majAnalyse(userId, analyse.id, {
    dureeSecondes: resultat.dureeSecondes,
    technique: resultat.technique,
    vignettes: resultat.vignettes,
  });
  if (consigne.motif === 'donnees_invalides') {
    // Le moteur a rendu une valeur que le contrat refuse — une vignette
    // hors compartiment, par exemple. C'est un désaccord entre deux
    // morceaux à nous, pas une faute de l'appelant.
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: `resultat_moteur_refuse:${consigne.champ ?? ''}`.slice(0, 200),
    });
    return reponse({
        ok: false,
        error: 'Le résultat du moteur a été refusé par le contrat d’analyse.',
        motif: 'resultat_moteur_refuse',
        champ: consigne.champ ?? null,
      },
      500);
  }
  if (consigne.motif || !consigne.analyse) {
    return reponse({ ok: false, error: 'Résultat non consigné.', motif: consigne.motif }, 409);
  }

  // ── La durée, recopiée sur le rush ────────────────────────────────────
  //
  // COPIE DE CONFORT, et traitée comme telle. `rush_analyses` porte la
  // mesure faisant foi ; `rushes.duree_secondes` évite une jointure pour
  // afficher une liste. Faire échouer la requête parce que la copie n'a pas
  // pris ferait croire que l'analyse a raté alors qu'elle est consignée et
  // `reussie`. On le dit, on ne le cache pas, et on ne ment pas dessus.
  let dureeRushEcrite = false;
  try {
    const copie = await majDureeRush(userId, rushId, resultat.dureeSecondes);
    dureeRushEcrite = copie.motif === null;
  } catch {
    dureeRushEcrite = false;
  }

  // ── ÉTAPE VISUELLE ────────────────────────────────────────────
  //
  // ⚠️ `null` N'EST PAS UNE PANNE. C'est un serveur où aucun fournisseur
  // n'est branché — l'état de ce lot, où aucun adaptateur réel n'est livré.
  // L'analyse se clot alors `reussie` à l'étape `extraction`, exactement comme
  // avant M3-B4, et les analyses déjà en base restent indiscernables des
  // nouvelles.
  // ⚠️ LE CHARGEMENT PEUT LEVER, ET IL FAUT QUE ÇA SE VOIE.
  //
  // Drapeau posé mais clé ou modèle manquant : quelqu'un a DEMANDÉ l'étape
  // visuelle et elle ne peut pas se faire. Retomber en extraction-only
  // laisserait croire que tout va bien — l'analyse s'écrirait `reussie` et
  // personne ne saurait que la configuration est cassée.
  let moteurVisuel: Awaited<ReturnType<typeof chargerMoteurVisuel>>;
  try {
    moteurVisuel = await chargerMoteurVisuel();
  } catch {
    // Le message de l'erreur n'est PAS repris : il pourrait nommer une
    // variable d'environnement. Le motif suffit à diagnostiquer.
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: 'configuration_visuelle_invalide',
    });
    return reponse({
        ok: false,
        error: 'La lecture des images est demandée mais mal configurée sur ce serveur.',
        motif: 'configuration_visuelle_invalide',
      },
      503);
  }
  if (!moteurVisuel) {
    // ── M3-D1 : la mesure audio, PUIS la clôture ─────────────────────────
    const audio = await mesureAudioPourCloture(
      rush, userId, consigne.analyse.technique, resultat.dureeSecondes,
    );
    const fin = await majAnalyse(userId, analyse.id, { etat: 'reussie', audio });
    if (fin.motif || !fin.analyse) {
      return reponse({ ok: false, error: 'Résultat non consigné.', motif: fin.motif }, 409);
    }
    return reponse({ ok: true, analyse: analysePublique(fin.analyse), dureeRushEcrite }, 201);
  }

  // ⚠️ `extraction` EST RECOPIÉ : `majAnalyse` REMPLACE la carte des
  // fournisseurs, il ne la fusionne pas. Écrire `{ visuel }` seul effacerait
  // la trace de ffmpeg.
  const passage = await majAnalyse(userId, analyse.id, {
    etape: 'visuel',
    // Au passage, le modèle n'est pas encore connu : le fournisseur ne l'a
    // pas encore répondu. On pose l'identité provisoire, et on la corrige à
    // la clôture avec le nom réellement employé.
    fournisseurs: { extraction: FOURNISSEUR_EXTRACTION, visuel: FOURNISSEUR_VISUEL },
  });
  if (passage.motif || !passage.analyse) {
    return reponse({ ok: false, error: 'Résultat non consigné.', motif: passage.motif }, 409);
  }

  // UN SEUL appel, sans reprise — `TENTATIVES_VISUEL`.
  let brutVisuel: unknown;
  try {
    brutVisuel = await moteurVisuel({
      userId,
      analysisId: analyse.id,
      vignettes: consigne.analyse.vignettes,
      dureeSecondes: resultat.dureeSecondes,
    });
  } catch {
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: 'moteur_visuel_en_erreur',
    });
    return reponse({ ok: false, error: 'La lecture des images a échoué.', motif: 'moteur_visuel_en_erreur' },
      500);
  }

  const visuel = resultatVisuelEtapeValide(brutVisuel);
  if (!visuel) {
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: 'resultat_visuel_invalide',
    });
    return reponse({
        ok: false,
        error: 'La lecture des images a rendu un résultat inexploitable.',
        motif: 'resultat_visuel_invalide',
      },
      500);
  }

  if (!visuel.ok) {
    // ⚠️ LA CAUSE FINE VA AU JOURNAL, ET NULLE PART AILLEURS.
    //
    // `resultat_visuel_invalide` dit qu'une réponse a été refusée ; il ne dit
    // pas laquelle des sept raisons, ni sur quel champ. Cette distinction est
    // ce qui sépare « il faudra relancer pour savoir » de « on sait ». Elle
    // reste HORS de la base, hors de la réponse HTTP et hors de l'écran : le
    // motif public ne change pas, et le nom d'un champ interne n'a rien à
    // faire devant l'utilisateur.
    //
    // Une seule ligne, et seulement pour ce motif : les autres n'ont pas de
    // détail à donner, et `fournisseur_en_erreur` porte un message de
    // fournisseur qu'on ne recopie surtout pas.
    if (visuel.motif === 'resultat_visuel_invalide' && visuel.detail !== undefined) {
      console.warn(
        `[autopilote][visuel] resultat_visuel_invalide analyse=${analyse.id} `
        + `diagnostic=${diagnosticVisuelSur(visuel.detail)}`,
      );
    }
    const refus = REFUS_VISUEL[visuel.motif] ?? REFUS_VISUEL.resultat_visuel_invalide;
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: visuel.motif.slice(0, 200),
    });
    return reponse({ ok: false, error: refus.message, motif: visuel.motif }, refus.statut);
  }

  // ── LE VISUEL EST CONSIGNÉ D'ABORD, ET SANS ÊTRE CLOS ───────────────
  //
  // ⚠️ POURQUOI DEUX ÉCRITURES ET NON UNE SEULE.
  //
  // Le visuel vient de COÛTER un appel de fournisseur. La mesure audio qui
  // suit traverse le rush entier et peut durer deux minutes. Tout écrire dans
  // la même requête ferait dépendre la SURVIE du résultat visuel du bon
  // déroulement d'une mesure gratuite : un redéploiement, un `SIGKILL`, une
  // coupure pendant ces deux minutes, et le résumé payé n'aurait jamais
  // touché la base. La relance repaierait le même appel pour le même rush.
  //
  // C'est le même raisonnement qu'à l'étape précédente, où `dureeSecondes`,
  // `technique` et `vignettes` sont consignés sans clore : ce qui est acquis
  // s'écrit dès qu'il est acquis, et l'état ne passe `reussie` qu'à la fin.
  //
  // L'analyse reste donc ACTIVE ici — `majAnalyse` refuserait d'écrire
  // l'audio sur une ligne déjà terminée.
  const visuelConsigne = await majAnalyse(userId, analyse.id, {
    // ⚠️ LE MODÈLE RÉELLEMENT EMPLOYÉ, pas l'étiquette générique posée avant
    // l'appel. Savoir qu'un rush a été lu par tel modèle et pas tel autre est
    // ce qui permettra de comparer deux analyses, ou d'expliquer une dérive.
    // La valeur vient d'une CONSTANTE de l'adaptateur, jamais d'un champ de
    // la réponse : un modèle qui se nommerait lui-même choisirait ce qu'on
    // écrit à son sujet.
    fournisseurs: {
      extraction: FOURNISSEUR_EXTRACTION,
      visuel: { ...FOURNISSEUR_VISUEL, modele: visuel.modele },
    },
    resume: visuel.visuel.resume,
    // ⚠️ LES OBJETS COMPLETS, PAS SEULEMENT LE TEXTE.
    //
    // `seconde` et `confiance` sont ce qui distingue une transcription d'un
    // ancrage : sans elles, M3-C saurait QU'un texte apparaît, jamais OÙ ni
    // avec quelle certitude. La colonne est un tableau `jsonb`, elle les
    // accepte tels quels — aucune migration.
    textesVisibles: visuel.visuel.textesVisibles as unknown as unknown[],
    qualite: visuel.visuel.qualite as unknown as Record<string, unknown>,
    usage: visuel.visuel.usage as unknown as Record<string, unknown>,
  });
  if (visuelConsigne.motif || !visuelConsigne.analyse) {
    // Rien n'a été écrit : `majAnalyse` valide AVANT d'écrire. Aller mesurer
    // l'audio d'une analyse qu'on ne tient plus n'aurait nulle part où
    // aboutir — deux minutes de lecture pour un second refus.
    return reponse({ ok: false, error: 'Résultat non consigné.', motif: visuelConsigne.motif },
      409);
  }

  // ── M3-D1 : la mesure audio, PUIS la clôture ────────────────────────
  //
  // APRÈS que le visuel est en base, et avant la clôture : M3-C ne voit
  // jamais une analyse `reussie` dont l'audio n'aurait pas été tenté, et une
  // panne pendant la mesure laisse le résumé visuel intact sur une analyse
  // encore active — donc reprenable.
  const audio = await mesureAudioPourCloture(
    rush, userId, consigne.analyse.technique, resultat.dureeSecondes,
  );

  // ── LA SEULE ÉCRITURE DE `reussie` DE TOUT LE CHEMIN ────────────────
  //
  // Elle ne porte QUE ce que l'écriture précédente n'a pas écrit. `majAnalyse`
  // n'applique que les champs présents dans le correctif : ne pas répéter
  // `resume`, `qualite` ni `fournisseurs` ne les efface pas, et les répéter
  // ferait croire qu'ils viennent d'être produits.
  const clot = await majAnalyse(userId, analyse.id, { etat: 'reussie', audio });
  if (clot.motif || !clot.analyse) {
    return reponse({ ok: false, error: 'Résultat non consigné.', motif: clot.motif }, 409);
  }

  return reponse({ ok: true, analyse: analysePublique(clot.analyse), dureeRushEcrite },
    201);
}
