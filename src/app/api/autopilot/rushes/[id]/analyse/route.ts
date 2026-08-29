import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireRush, majDureeRush } from '@/lib/autopilot/tournage/service';
import {
  creerAnalyse, majAnalyse, listerAnalyses, lireDerniereAnalyse,
} from '@/lib/autopilot/analyse/service';
import { CHAMPS_INTERDITS_ANALYSE, analyseActive, type RushAnalysis } from '@/lib/autopilot/analyse/contrat';
import {
  chargerMoteurExtraction, resultatExtractionValide,
  type MotifExtraction,
} from '@/lib/autopilot/analyse/moteur';
import {
  chargerMoteurVisuel, resultatVisuelEtapeValide, FOURNISSEUR_VISUEL,
} from '@/lib/autopilot/analyse/moteur-visuel';
import {
  prendrePlaceExtraction, RETRY_APRES_SECONDES,
  MOTIF_CAPACITE_SATUREE, MESSAGE_CAPACITE_SATUREE,
} from '@/lib/autopilot/analyse/capacite';
import type { Rush } from '@/lib/autopilot/tournage/contrat';

/**
 * Lance l'analyse d'un rush — l'étape `extraction`, et elle seule.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE FAIT, DANS L'ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elle relit le rush, refuse tout de suite ce qui doit l'être, PREND UNE PLACE
 * D'EXTRACTION, crée la ligne d'analyse AVANT de travailler, la passe
 * `en_cours`, appelle le moteur une fois, consigne le résultat, et recopie la
 * durée sur le rush.
 *
 * La ligne est posée avant le travail pour la même raison qu'en M3-B1 : si le
 * processus meurt en cours de mesure, une reprise retrouve une analyse
 * `en_cours` plutôt que d'avoir à deviner qu'un travail a eu lieu.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * DEUX BORNES DIFFÉRENTES, QU'IL NE FAUT PAS CONFONDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rush_analyses_active_unique` interdit deux analyses actives SUR LE MÊME
 * RUSH : c'est de l'idempotence, elle vit en base, et elle rend 409.
 *
 * `capacite.ts` borne le nombre d'extractions simultanées SUR CE SERVEUR,
 * tous rushes confondus : c'est de la charge machine, elle vit en mémoire du
 * processus, et elle rend 429.
 *
 * Les deux se cumulent et ne se remplacent pas. La place est prise AVANT
 * `creerAnalyse` — donc avant l'idempotence — pour qu'un refus de capacité ne
 * laisse aucune ligne derrière lui.
 *
 * Mais elle ne DOIT PAS masquer le 409, et avec une seule place elle le
 * masquerait systématiquement : deux requêtes simultanées sur le même rush se
 * croisent forcément sur la place. Le refus faute de place relit donc les
 * analyses de ce rush et rend 409 quand l'une est active. C'est une lecture
 * qui n'autorise rien — elle choisit le mot du refus, jamais le droit
 * d'écrire. Voir `refusFauteDePlace`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE CORPS N'APPORTE RIEN, ET C'EST VOLONTAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tout ce qui décrit l'analyse — son état, son étape, ses fournisseurs, sa
 * durée, ses vignettes — est décidé ou mesuré par le serveur. Un corps vide
 * est donc la requête normale. Un corps qui PROPOSE l'un de ces champs est
 * refusé en 422 par `CHAMPS_INTERDITS_ANALYSE`, jamais ignoré : un champ
 * ignoré laisse croire qu'il a été pris en compte, et c'est exactement ce
 * qu'espère celui qui l'envoie.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * L'IDEMPOTENCE VIENT DE LA BASE, PAS D'UN `IF`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux requêtes simultanées ne créent pas deux analyses actives. Ce n'est pas
 * cette route qui l'empêche : c'est l'index partiel
 * `rush_analyses_active_unique`, que `creerAnalyse` traduit en
 * `analyse_active_existante`. Un `select` « est-ce actif ? » suivi d'un
 * `insert` laisserait entre les deux une fenêtre que les deux requêtes
 * traverseraient — et le second passerait.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NI FILE D'ATTENTE, NI REPRISE AUTOMATIQUE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le moteur est appelé UNE fois. Un ré-essai caché doublerait le travail sur
 * une panne qui n'est pas transitoire, et masquerait la seule information
 * utile : que la mesure ne passe pas sur ce fichier. Ré-essayer est une
 * décision de l'appelant, qui relance une nouvelle version d'analyse.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * 300 s — la borne haute déjà retenue par tout ce qui manipule une vidéo dans
 * ce projet : `/api/convert/to-mp4`, `/api/render`, `/api/render/jobs/[id]/upload`,
 * `/api/cron/publish`. L'extraction est du même ordre de travail : télécharger
 * un rush qui peut peser des gigaoctets, puis le faire lire par ffmpeg.
 *
 * ⚠️ MAIS CETTE DÉCLARATION NE PROTÈGE RIEN SUR NOTRE HÉBERGEMENT.
 *
 * `maxDuration` est une limite de plateforme sans frais : Vercel l'applique,
 * le serveur Node autonome de Coolify NON (`docs/infra.md` : « il ne reste
 * que `functions.maxDuration` […] inerte sur Coolify »). Aucune requête ne
 * sera donc interrompue à 300 s, et rien au-dessus du moteur ne le sera non
 * plus. Écrire ici que la route « borne » la mesure serait faux, et c'est
 * exactement la croyance qui laissait passer un stockage muet.
 *
 * Ce qui borne réellement est INTERNE au moteur, et lui seul :
 * `TIMEOUT_MINIO_MS` < `TIMEOUT_VIGNETTE_MS` < `TIMEOUT_SONDE_MS` <
 * `BUDGET_EXTRACTION_MS` (`src/lib/autopilot/analyse/extraction.ts`), dont la
 * somme du pire cas reste sous cette valeur. La déclaration est conservée
 * parce qu'elle redeviendrait vraie sur une plateforme qui l'applique, et
 * parce que `RETRY_APRES_SECONDES` s'aligne dessus — pas parce qu'elle
 * garantit quoi que ce soit aujourd'hui.
 */
export const maxDuration = 360;

const SOCLE_TOURNAGE_ABSENT =
  'Rushes indisponibles : migration '
  + '2026-08-31-shoot-sessions-rushes.sql non appliquée sur ce serveur.';

const SOCLE_ANALYSE_ABSENT =
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
function analysePublique(analyse: RushAnalysis) {
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
function reponseAnalyseDejaActive(analyse: RushAnalysis | null): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: 'Une analyse de ce rush est déjà en cours.',
      motif: 'analyse_active_existante',
      analyse: analyse ? analysePublique(analyse) : null,
    },
    { status: 409 },
  );
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
async function refusFauteDePlace(userId: string, rushId: string): Promise<NextResponse> {
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
  return NextResponse.json(
    { ok: false, error: MESSAGE_CAPACITE_SATUREE, motif: MOTIF_CAPACITE_SATUREE },
    { status: 429, headers: { 'Retry-After': String(RETRY_APRES_SECONDES) } },
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
async function executerAnalyse(
  userId: string, rushId: string, rush: Rush,
): Promise<NextResponse> {
  // ── La ligne d'analyse, AVANT tout travail ────────────────────────────
  const creation = await creerAnalyse(userId, rushId);
  if (creation.motif === 'socle_absent') {
    return NextResponse.json(
      { ok: false, error: SOCLE_ANALYSE_ABSENT, motif: 'socle_absent' }, { status: 503 },
    );
  }
  if (creation.motif === 'rush_introuvable') {
    // Le rush a disparu entre les deux lectures. Rare, mais réel.
    return NextResponse.json({ ok: false, error: 'Rush introuvable' }, { status: 404 });
  }
  if (creation.motif === 'analyse_active_existante') {
    // 409 : la contrainte de la base a tranché, pas un `if` de cette route.
    // L'analyse gagnante est relue pour que le perdant sache quoi suivre.
    const { analyses } = await listerAnalyses(userId, rushId);
    return reponseAnalyseDejaActive(analyses.find((a) => analyseActive(a.etat)) ?? null);
  }
  const analyse = creation.analyse;
  if (!analyse) {
    return NextResponse.json(
      { ok: false, error: 'Analyse non créée' }, { status: 500 },
    );
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
    return NextResponse.json(
      { ok: false, error: MOTEUR_ABSENT, motif: 'moteur_absent' }, { status: 503 },
    );
  }

  // ── `en_cours`, et qui fait le travail ────────────────────────────────
  const demarrage = await majAnalyse(userId, analyse.id, {
    etat: 'en_cours',
    etape: 'extraction',
    fournisseurs: { extraction: FOURNISSEUR_EXTRACTION },
  });
  if (demarrage.motif === 'socle_absent') {
    return NextResponse.json(
      { ok: false, error: SOCLE_ANALYSE_ABSENT, motif: 'socle_absent' }, { status: 503 },
    );
  }
  if (demarrage.motif) {
    // `analyse_close` ou `analyse_introuvable` : quelqu'un l'a fermée entre
    // sa création et ici. On ne mesure pas une analyse qu'on ne tient plus.
    return NextResponse.json(
      { ok: false, error: 'Analyse close avant son démarrage.', motif: demarrage.motif },
      { status: 409 },
    );
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
    return NextResponse.json(
      { ok: false, error: message, motif: 'moteur_en_erreur' }, { status: 500 },
    );
  }

  const resultat = resultatExtractionValide(resultatBrut);
  if (!resultat) {
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: 'resultat_moteur_invalide',
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'Le moteur d’extraction a rendu un résultat inexploitable.',
        motif: 'resultat_moteur_invalide',
      },
      { status: 500 },
    );
  }

  // ── Échec contrôlé : `echouee` + motif, et le code qui correspond ─────
  if (!resultat.ok) {
    const fin = await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: resultat.motif,
    });
    const refus = REFUS_EXTRACTION[resultat.motif];
    return NextResponse.json(
      {
        ok: false,
        error: refus.message,
        motif: resultat.motif,
        analyse: fin.analyse ? analysePublique(fin.analyse) : null,
      },
      { status: refus.statut },
    );
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
    return NextResponse.json(
      {
        ok: false,
        error: 'Le résultat du moteur a été refusé par le contrat d’analyse.',
        motif: 'resultat_moteur_refuse',
        champ: consigne.champ ?? null,
      },
      { status: 500 },
    );
  }
  if (consigne.motif || !consigne.analyse) {
    return NextResponse.json(
      { ok: false, error: 'Résultat non consigné.', motif: consigne.motif }, { status: 409 },
    );
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
    return NextResponse.json(
      {
        ok: false,
        error: 'La lecture des images est demandée mais mal configurée sur ce serveur.',
        motif: 'configuration_visuelle_invalide',
      },
      { status: 503 },
    );
  }
  if (!moteurVisuel) {
    const fin = await majAnalyse(userId, analyse.id, { etat: 'reussie' });
    if (fin.motif || !fin.analyse) {
      return NextResponse.json(
        { ok: false, error: 'Résultat non consigné.', motif: fin.motif }, { status: 409 },
      );
    }
    return NextResponse.json(
      { ok: true, analyse: analysePublique(fin.analyse), dureeRushEcrite }, { status: 201 },
    );
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
    return NextResponse.json(
      { ok: false, error: 'Résultat non consigné.', motif: passage.motif }, { status: 409 },
    );
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
    return NextResponse.json(
      { ok: false, error: 'La lecture des images a échoué.', motif: 'moteur_visuel_en_erreur' },
      { status: 500 },
    );
  }

  const visuel = resultatVisuelEtapeValide(brutVisuel);
  if (!visuel) {
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: 'resultat_visuel_invalide',
    });
    return NextResponse.json(
      {
        ok: false,
        error: 'La lecture des images a rendu un résultat inexploitable.',
        motif: 'resultat_visuel_invalide',
      },
      { status: 500 },
    );
  }

  if (!visuel.ok) {
    const refus = REFUS_VISUEL[visuel.motif] ?? REFUS_VISUEL.resultat_visuel_invalide;
    await majAnalyse(userId, analyse.id, {
      etat: 'echouee', motifEchec: visuel.motif.slice(0, 200),
    });
    return NextResponse.json(
      { ok: false, error: refus.message, motif: visuel.motif }, { status: refus.statut },
    );
  }

  // ── LA SEULE ÉCRITURE DE `reussie` DE TOUT LE CHEMIN ────────────────
  const clot = await majAnalyse(userId, analyse.id, {
    etat: 'reussie',
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
  if (clot.motif || !clot.analyse) {
    return NextResponse.json(
      { ok: false, error: 'Résultat non consigné.', motif: clot.motif }, { status: 409 },
    );
  }

  return NextResponse.json(
    { ok: true, analyse: analysePublique(clot.analyse), dureeRushEcrite },
    { status: 201 },
  );
}

/**
 * Rend l'analyse LA PLUS RÉCENTE d'un rush — et rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UNE LECTURE, ET UNE SEULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce gestionnaire n'écrit rien, ne crée rien, ne ferme rien. En particulier
 * il n'appelle PAS `recupererAnalysesInterrompues` : consulter l'état d'une
 * analyse ne doit pas la fermer. Un écran qui rafraîchit sa page toutes les
 * cinq secondes tuerait alors le travail qu'il regarde. La récupération
 * appartient à la RELANCE, où l'utilisateur demande explicitement un nouveau
 * travail — c'est-à-dire à `creerAnalyse`, et à lui seul.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA PLUS RÉCENTE, C'EST LA PLUS GRANDE `version` — ET UNE SEULE LIGNE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `lireDerniereAnalyse`, et NON `listerAnalyses` : cet écran SONDE cet état
 * toutes les quelques secondes, par rush ouvert, sur le processus Node qui
 * fait aussi tourner ffmpeg. `listerAnalyses` rapatrierait toutes les
 * versions avec toutes leurs colonnes `jsonb` pour n'en afficher qu'une.
 *
 * Ni `created_at`, ni `updated_at` pour trancher : le premier peut être
 * identique à la milliseconde entre deux insertions, le second remonterait
 * une vieille analyse fermée après coup devant une neuve.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AUCUNE ANALYSE N'EST UN ÉTAT NORMAL, PAS UNE ERREUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un rush jamais analysé répond 200 avec `analyse: null`. Un 404 dirait « ce
 * rush n'existe pas », ce qui est faux et enverrait l'écran afficher la
 * mauvaise chose. La distinction compte : c'est précisément l'écran qui doit
 * proposer « Analyser » dans ce cas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI SORT, ET CE QUI NE SORT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `analysePublique` — la MÊME fonction que le POST, pas une seconde qui
 * divergerait d'un champ. Elle retire les clés de stockage et ne laisse des
 * vignettes que leur nombre et leurs positions. Les IMAGES elles-mêmes se
 * demandent une par une à `/api/autopilot/analyses/[id]/vignettes/[n]`, qui
 * les sert depuis l'application. Aucune clé, aucun compartiment et aucune
 * URL de stockage ne sortent d'ici — deux tests le vérifient déjà sur le
 * POST, et la raison vaut mot pour mot pour la lecture.
 *
 * ⚠️ Beaucoup de champs sont vides, et c'est NORMAL : `resume`, `parole`,
 * `qualite` et `textesVisibles` attendent M3-B4 et M3-B5. Ils sont rendus
 * tels quels — vides. Les remplir d'une valeur « raisonnable » ferait croire
 * à un travail qui n'a pas eu lieu.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // Le rush est lu D'ABORD, et pour DEUX raisons. La première : distinguer
    // les deux migrations qui peuvent manquer — un message qui nommerait la
    // mauvaise enverrait appliquer la mauvaise. La seconde : sans elle, un
    // rush inexistant et un rush jamais analysé répondraient la même chose,
    // et l'écran ne saurait pas s'il doit proposer « Analyser ».
    const { rush, motif: motifRush } = await lireRush(userId, params.id);
    if (motifRush === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_TOURNAGE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du rush d'un tiers.
    if (!rush) {
      return NextResponse.json({ ok: false, error: 'Rush introuvable' }, { status: 404 });
    }

    const { analyse, motif } = await lireDerniereAnalyse(userId, params.id);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ANALYSE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: true, analyse: analyse ? analysePublique(analyse) : null },
      // `private, no-store` : la réponse dépend de la session, et un cache
      // partagé qui la garderait la servirait au visiteur suivant.
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'lecture d analyse impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    // `user_id` vient de la session, et de nulle part ailleurs. Le corps n'a
    // aucun moyen de le proposer : `CHAMPS_INTERDITS_ANALYSE` le refuse dans
    // ses deux orthographes.
    const userId = session.user.id;

    // ── Le corps : facultatif, mais jamais ignoré ─────────────────────────
    const brut = (await req.text()).trim();
    let corps: Record<string, unknown> = {};
    if (brut.length > 0) {
      let analyseJson: unknown;
      try { analyseJson = JSON.parse(brut); } catch {
        return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
      }
      if (typeof analyseJson !== 'object' || analyseJson === null || Array.isArray(analyseJson)) {
        return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 422 });
      }
      corps = analyseJson as Record<string, unknown>;
    }

    const interdit = CHAMPS_INTERDITS_ANALYSE.find(
      (c) => Object.prototype.hasOwnProperty.call(corps, c),
    );
    if (interdit) {
      return NextResponse.json(
        { ok: false, error: `Le champ « ${interdit} » est decide par le serveur.` },
        { status: 422 },
      );
    }

    // ── Le rush : lu ICI, avant tout ──────────────────────────────────────
    //
    // `creerAnalyse` le relit de son côté, et c'est très bien : il ne doit pas
    // dépendre d'un appelant discipliné. Mais la route en a besoin pour trois
    // choses qu'il ne rend pas — la clé de l'objet à mesurer, l'état
    // d'ingestion, et la distinction entre les DEUX migrations qui peuvent
    // manquer. `creerAnalyse` rend `socle_absent` pour les deux ; un message
    // qui nommerait la mauvaise enverrait appliquer la mauvaise migration.
    const { rush, motif: motifRush } = await lireRush(userId, params.id);
    if (motifRush === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_TOURNAGE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du rush d'un tiers.
    if (!rush) {
      return NextResponse.json({ ok: false, error: 'Rush introuvable' }, { status: 404 });
    }

    // ── L'état d'ingestion : 409, et non 422 ──────────────────────────────
    //
    // La requête est bien formée — il n'y a rien à corriger dedans, donc pas
    // de 422. Le rush existe et appartient bien à l'appelant — donc pas de
    // 404. Ce qui s'y oppose est l'état ACTUEL de la ressource, et il peut
    // changer sans que la requête change : c'est la définition de 409.
    //
    // `indexe` veut dire « enregistré sans preuve » : personne n'a vérifié que
    // le fichier est là. `absent` veut dire qu'il n'y est pas. Mesurer l'un ou
    // l'autre, c'est envoyer ffmpeg chercher un fichier dont on sait déjà
    // qu'on ne l'a pas vu.
    if (rush.etat !== 'verifie') {
      return NextResponse.json(
        {
          ok: false,
          error: 'Ce rush n’a pas été vérifié dans le stockage : il ne peut pas être analysé.',
          motif: 'rush_non_verifie',
          etat: rush.etat,
        },
        { status: 409 },
      );
    }

    // ── La place, AVANT la première écriture ──────────────────────────────
    //
    // Ici, et pas ailleurs. APRÈS les refus — session, propriété du rush,
    // état d’ingestion — parce qu’une requête qui n’avait pas le droit
    // d’analyser ne doit pas s’entendre dire que le serveur est plein : ce
    // serait lui faire réessayer un refus définitif.
    //
    // Et AVANT `creerAnalyse`, parce qu’une place refusée ne doit laisser
    // AUCUNE ligne derrière elle. Une analyse créée puis abandonnée resterait
    // active, occuperait `rush_analyses_active_unique`, et interdirait toute
    // relance de ce rush : le refus le plus bénin produirait le blocage le
    // plus durable.
    const place = prendrePlaceExtraction();
    if (!place) {
      // 429 le plus souvent, 409 quand c'est CE rush qui est déjà analysé —
      // voir `refusFauteDePlace`. Dans les deux cas : aucune écriture.
      return await refusFauteDePlace(userId, params.id);
    }

    try {
      return await executerAnalyse(userId, params.id, rush);
    } finally {
      // La seule libération, et elle couvre tout : un `return` de succès, un
      // refus contrôlé, une exception du moteur, un dépassement de délai.
      place.liberer();
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'analyse impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
