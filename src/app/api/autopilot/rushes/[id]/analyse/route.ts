import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireRush, majDureeRush } from '@/lib/autopilot/tournage/service';
import { creerAnalyse, majAnalyse, listerAnalyses } from '@/lib/autopilot/analyse/service';
import { CHAMPS_INTERDITS_ANALYSE, analyseActive, type RushAnalysis } from '@/lib/autopilot/analyse/contrat';
import {
  chargerMoteurExtraction, resultatExtractionValide,
  type MotifExtraction,
} from '@/lib/autopilot/analyse/moteur';
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
export const maxDuration = 300;

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
  const consigne = await majAnalyse(userId, analyse.id, {
    etat: 'reussie',
    // `etape` reste `extraction` : c'est là que cette analyse s'arrête, et
    // l'effacer perdrait l'information de jusqu'où elle est allée.
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

  return NextResponse.json(
    { ok: true, analyse: analysePublique(consigne.analyse), dureeRushEcrite },
    { status: 201 },
  );
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
