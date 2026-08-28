import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireRush, majDureeRush } from '@/lib/autopilot/tournage/service';
import { creerAnalyse, majAnalyse, listerAnalyses } from '@/lib/autopilot/analyse/service';
import { CHAMPS_INTERDITS_ANALYSE, analyseActive, type RushAnalysis } from '@/lib/autopilot/analyse/contrat';
import {
  chargerMoteurExtraction, resultatExtractionValide,
  type MotifExtraction,
} from '@/lib/autopilot/analyse/moteur';

/**
 * Lance l'analyse d'un rush — l'étape `extraction`, et elle seule.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE FAIT, DANS L'ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elle relit le rush, refuse tout de suite ce qui doit l'être, crée la ligne
 * d'analyse AVANT de travailler, la passe `en_cours`, appelle le moteur une
 * fois, consigne le résultat, et recopie la durée sur le rush.
 *
 * La ligne est posée avant le travail pour la même raison qu'en M3-B1 : si le
 * processus meurt en cours de mesure, une reprise retrouve une analyse
 * `en_cours` plutôt que d'avoir à deviner qu'un travail a eu lieu.
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
 * Ce n'est PAS un réglage de confort. Un `maxDuration` plus court que le délai
 * interne du moteur ferait tuer le processus pendant la mesure, et l'analyse
 * resterait `en_cours` pour toujours — un état dont l'index unique interdit
 * ensuite de sortir autrement qu'à la main. La borne de la route doit rester
 * la plus LARGE des deux ; c'est au moteur de rendre `timeout` avant elle.
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

    // ── La ligne d'analyse, AVANT tout travail ────────────────────────────
    const creation = await creerAnalyse(userId, params.id);
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
      // L'analyse gagnante est relue pour que le perdant sache quoi suivre —
      // sans elle, il n'aurait qu'un refus et aucun identifiant à interroger.
      const { analyses } = await listerAnalyses(userId, params.id);
      const enCours = analyses.find((a) => analyseActive(a.etat)) ?? null;
      return NextResponse.json(
        {
          ok: false,
          error: 'Une analyse de ce rush est déjà en cours.',
          motif: 'analyse_active_existante',
          analyse: enCours ? analysePublique(enCours) : null,
        },
        { status: 409 },
      );
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
      const copie = await majDureeRush(userId, params.id, resultat.dureeSecondes);
      dureeRushEcrite = copie.motif === null;
    } catch {
      dureeRushEcrite = false;
    }

    return NextResponse.json(
      { ok: true, analyse: analysePublique(consigne.analyse), dureeRushEcrite },
      { status: 201 },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'analyse impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
