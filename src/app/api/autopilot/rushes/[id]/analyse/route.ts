import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireRush } from '@/lib/autopilot/tournage/service';
import { CHAMPS_INTERDITS_ANALYSE } from '@/lib/autopilot/analyse/contrat';
import { lireDerniereAnalyse } from '@/lib/autopilot/analyse/service';
import { prendrePlaceExtraction } from '@/lib/autopilot/analyse/capacite';
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
 * 480 s — la SOMME des trois budgets internes que cette requête enchaîne, et
 * rien d'autre : `BUDGET_EXTRACTION_MS` (290 s) + `TIMEOUT_VISUEL_MS` (60 s)
 * + `BUDGET_AUDIO_MS` (130 s). Le travail est du même ordre que celui de
 * `/api/convert/to-mp4` ou `/api/render` : faire lire par ffmpeg un rush qui
 * peut peser des gigaoctets — deux fois ici, puisque la bande son est
 * entrelacée et ne se lit pas par requêtes `Range`.
 *
 * ⚠️ MAIS CETTE DÉCLARATION NE PROTÈGE RIEN SUR NOTRE HÉBERGEMENT.
 *
 * `maxDuration` est une limite de plateforme sans frais : Vercel l'applique,
 * le serveur Node autonome de Coolify NON (`docs/infra.md` : « il ne reste
 * que `functions.maxDuration` […] inerte sur Coolify »). Aucune requête ne
 * sera donc interrompue à 480 s, et rien au-dessus du moteur ne le sera non
 * plus. Écrire ici que la route « borne » la mesure serait faux, et c'est
 * exactement la croyance qui laissait passer un stockage muet.
 *
 * Ce qui borne réellement est INTERNE au moteur, et lui seul :
 * `TIMEOUT_MINIO_MS` < `TIMEOUT_VIGNETTE_MS` < `TIMEOUT_SONDE_MS` <
 * `BUDGET_EXTRACTION_MS` (`src/lib/autopilot/analyse/extraction.ts`), auquel
 * s'ajoutent `TIMEOUT_VISUEL_MS` et `BUDGET_AUDIO_MS`, dont la somme du pire
 * cas reste sous cette valeur. La déclaration est conservée
 * parce qu'elle redeviendrait vraie sur une plateforme qui l'applique, et
 * parce que `RETRY_APRES_SECONDES` s'aligne dessus — pas parce qu'elle
 * garantit quoi que ce soit aujourd'hui.
 */
export const maxDuration = 480;

/**
 * ⚠️ L'ORCHESTRATION A DÉMÉNAGÉ — ET LA ROUTE N'EN GARDE QUE L'HABILLAGE.
 *
 * Les 640 lignes qui vivaient ici sont dans `analyse-orchestration.ts`, mot
 * pour mot. Elles n'ont pas été réécrites : seule leur enveloppe de sortie a
 * changé, de `NextResponse.json(x, { status: n })` à `reponse(x, n)`. Cette
 * route les rhabille en HTTP et rend exactement ce qu'elle rendait.
 *
 * La raison est ailleurs que dans l'esthétique : tant que ce bloc était ici,
 * seule une session pouvait analyser un rush, et l'Autopilote automatique en
 * était réduit à monter la matière qu'un humain avait analysée à la main.
 * Le cron appelle DÉSORMAIS la même fonction, avec le même `userId`, sans
 * cookie et sans navigateur.
 */
import {
  SOCLE_TOURNAGE_ABSENT, SOCLE_ANALYSE_ABSENT, analysePublique,
  refusFauteDePlace as refusFauteDePlaceServeur,
  executerAnalyseRush, type ReponseServeur,
} from '@/lib/autopilot/analyse/analyse-orchestration';

/** Une réponse de service, rhabillée en HTTP. Rien de plus. */
function enHttp(r: ReponseServeur): NextResponse {
  return NextResponse.json(r.corps, r.entetes
    ? { status: r.statut, headers: r.entetes }
    : { status: r.statut });
}

const refusFauteDePlace = async (userId: string, rushId: string): Promise<NextResponse> =>
  enHttp(await refusFauteDePlaceServeur(userId, rushId));

const executerAnalyse = async (
  userId: string, rushId: string, rush: Rush,
): Promise<NextResponse> => enHttp(await executerAnalyseRush(userId, rushId, rush));

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
