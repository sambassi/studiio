import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits } from '@/lib/credits/system';
import { politiqueDeLUtilisateur } from '@/lib/facturation/politique';
import { compteExempteDeCredits } from '@/lib/facturation/exemption';
import { creneauImmediat } from '@/lib/autopilot/rules';
import { preparePosts } from '@/lib/autopilot/engine';
import { choisirContenuManuel } from '@/lib/autopilot/contenu-manuel';
import {
  postVisibleDansCalendrier, jumeauEnPreparation, jobIdManuel, jetonManuel,
  productionDirecteEnCours, reserverProductionDirecte, noterEtapeDirecte, battementDirect, terminerProductionDirecte,
  BATTEMENT_DIRECT_MS,
} from '@/lib/autopilot/suivi-jumeau-manuel';
import {
  produireUnMontage, sujetsRecents, creneauxExistants, configDepuisLigne, devisMontage,
} from '@/lib/autopilot/produire';
import { lancerJumeauMontage, scriptJumeauMontage } from '@/lib/autopilot/jumeau-async';
import { CODE_DUREE_A_CONFIRMER, DUREE_RECOMMANDEE_AVATAR, dureeAConfirmerAvecAvatar, messageDureeAConfirmer } from '@/lib/autopilot/duree-cible';
import { avatarSeulConfig } from '@/lib/autopilot/sources';
import { budgetAutopiloteDuCompte, devisVideoAutopilote } from '@/lib/fournisseurs/devis-autopilote';
import { CHAMP_CONFIRMATION_COUT, confirmationCoutLue, confirmationValable, reponseConfirmationCout } from '@/lib/fournisseurs/confirmation-cout';
import { aUneSourceVisuelle, avatarActifConfig, etatSourcesServeur } from '@/lib/autopilot/sources';
import { rushesUtilisablesServeur } from '@/lib/autopilot/validite-rush';
import { sondeRushPour } from '@/lib/autopilot/sonde-rush-compte';
import { mediaLisiblePar } from '@/lib/creer/analyse-rush-serveur';
import { noterProgression, effacerProgression, noterResultat, effacerResultat, lireProgression } from '@/lib/autopilot/progression';
import { estErreurDeFile } from '@/lib/autopilot/limite-rendus';

/**
 * « Produire un brouillon maintenant » — UNE vidéo, tout de suite, pour le
 * compte de la session.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE C'EST, ET CE QUE CE N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * C'est le MOTEUR DU CRON, appelé une fois : mêmes rushes, même brief, même
 * style, même rendu serveur, même débit atomique (`produireUnMontage`). Ce
 * qui change est forcé, et forcé ICI, quoi que dise la configuration :
 *
 *   - statut `draft`, réseaux `[]` : AUCUNE publication sociale n'est
 *     possible — le cron de publication ne prend que les `scheduled`, et un
 *     post sans réseau n'a nulle part où partir ;
 *   - date/heure = aujourd'hui, maintenant + 5 min arrondi (`creneauImmediat`),
 *     dans le fuseau de la configuration — PAS l'heure de publication
 *     configurée, qui est celle des posts programmés par le cron pour le
 *     lendemain. Une heure de publication n'est pas une commande de
 *     production immédiate, et inversement ;
 *   - la décision du cron (`decideRun` : activé ? heure ? cadence ? date de
 *     début ?) n'est PAS consultée — c'est le point : tester le résultat sans
 *     attendre le passage. Restent les deux refus que rien ne peut lever :
 *     aucun rush (422) et crédits insuffisants (402), vérifiés AVANT tout
 *     rendu, sans rien débiter.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN CLIC = UN RENDU = UN DÉBIT — TROIS VERROUS
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. `enVol` : un utilisateur à la fois, dans ce processus. Deux requêtes
 *      simultanées — double clic, double onglet — n'entrent pas toutes deux
 *      dans le rendu : la seconde répond 409 immédiatement, sans avoir rien
 *      lu ni débité.
 *   2. Le jeton de créneau `manuel:<userId>|<date>|<HH:MM>` : les deux
 *      clics d'une même fenêtre de 5 min calculent le MÊME jeton, et
 *      `creneauxExistants` le trouve dès que le premier post est déposé —
 *      la relance après coup (autre processus, page rechargée) répond 409.
 *   3. La référence de débit `autopilote:<jobId>` est DÉTERMINISTE (dérivée
 *      du jeton) : l'index unique `(user_id, reference_id)` rend un second
 *      débit inoffensif même si les deux premiers verrous étaient contournés.
 *
 * Le premier verrou vit en mémoire : il est exact pour UN processus. Il est
 * doublé, SANS AVATAR, d'un verrou PERSISTANT par compte (`reserverProductionDirecte`,
 * ligne `manuel-direct` d'`autopilot_jumeau_attente`, unicité tranchée par la
 * base) : un redémarrage, un second processus ou un second onglet ne lancent
 * pas un second rendu pendant qu'un premier tourne — et l'état (étape,
 * avancement, issue) est relu depuis la base par `/progression` et par le
 * Calendrier. Un rendu mort avec son processus est libéré (orphelin), jamais
 * bloquant pour toujours.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Utilisateurs dont une production manuelle est en cours, dans ce processus. */
const enVol = new Set<string>();

// Préfixe des jetons manuels (`manuel:`) : jamais confondus avec un créneau
// du cron — porté par `jetonManuel` (suivi-jumeau-manuel.ts).

/**
 * Le DEVIS : ce que le clic coûtera, avant de cliquer.
 *
 * ⚠️ LE MÊME NOMBRE QUE LE DÉBIT. `coutMontage()` (grille centrale,
 * `render.reel`) est ce que `produireUnMontage` retire ; l'annoncer depuis
 * une autre source pourrait afficher un prix et en débiter un autre. La politique vient de
 * la base, comme partout : un administrateur voit « frais partenaires », pas
 * un nombre qu'on ne lui retirera pas.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const [{ politique }, solde, lignes] = await Promise.all([
    politiqueDeLUtilisateur(userId),
    getUserCredits(userId).catch(() => null),
    supabaseAdmin.from('autopilot_config').select('*').eq('user_id', userId).limit(1).then((r) => r.data, () => null),
  ]);
  // Le devis = ce que POST vérifiera et ce que le montage débitera : rendu
  // (+ avatar si la vidéo du jumeau est montée, + affiche de référence si ce
  // mode est actif). `devisMontage` est la formule partagée avec POST.
  const config = configDepuisLigne((lignes?.[0] as Record<string, unknown> | undefined) ?? null);
  const devis = await devisMontage(config);
  // ADMIN (0 crédit Studiio) : le coût RÉEL chez le fournisseur, par vidéo, par
  // jour et par mois — visible AVANT d'activer ou de produire. Estimation, jamais un débit.
  const fournisseur = await compteExempteDeCredits(userId).catch(() => false)
    ? await budgetAutopiloteDuCompte(userId, config).catch(() => null)
    : null;
  return NextResponse.json({
    success: true,
    politique,
    cout: devis.total,
    detail: { rendu: devis.rendu, avatar: devis.avatar, affiche: devis.affiche },
    solde,
    // En cours dans CE processus, ou — après un redémarrage, ou dans un autre
    // processus — d'après la réservation persistante.
    enCours: enVol.has(userId) || !!(await productionDirecteEnCours(userId).catch(() => null)),
    ...(fournisseur ? { fournisseur } : {}),
  });
}

export async function POST(req?: Request) {
  // Empreinte de l'aperçu affiché (facultative) : voir `choisirContenuManuel`.
  // Lue AVANT tout verrou — un corps illisible vaut « pas d'empreinte »,
  // c'est-à-dire l'ancien comportement.
  let apercuSignature: string | null = null;
  // Admin : le coût fournisseur de la vidéo avatar a-t-il été confirmé ?
  let coutConfirme = false;
  let moteurConfirme: unknown;
  try {
    const corps = req ? await req.json() : null;
    const brut = corps && typeof corps === 'object' ? (corps as { apercuSignature?: unknown }).apercuSignature : null;
    if (typeof brut === 'string' && /^c1-[0-9a-f]{8}$/.test(brut)) apercuSignature = brut;
    coutConfirme = confirmationCoutLue(corps && typeof corps === 'object' ? (corps as Record<string, unknown>)[CHAMP_CONFIRMATION_COUT] : null);
    moteurConfirme = corps && typeof corps === 'object' ? (corps as Record<string, unknown>).moteurConfirme : undefined;
  } catch { /* pas de corps */ }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ── Verrou 1 : un seul en vol par utilisateur ──────────────────────────
  // AVANT toute lecture : c'est ce qui rend le double clic inoffensif même
  // quand les deux requêtes arrivent dans la même milliseconde.
  if (enVol.has(userId)) {
    return NextResponse.json(
      { success: false, error: 'Une production est déjà en cours. Patientez.', code: 'en-cours' },
      { status: 409 },
    );
  }
  enVol.add(userId);
  let delegue = false;
  try {
    // ── Verrou 1 persistant : une production sans avatar déjà en cours ────
    // (autre processus, ou celle d'avant un redémarrage encore vivante). Le
    // créneau en cours est renvoyé : l'écran SUIT cette production au lieu
    // d'en lancer une autre. Réservation atomique plus bas, juste avant le rendu.
    const enCoursAilleurs = await productionDirecteEnCours(userId).catch(() => null);
    if (enCoursAilleurs) {
      return NextResponse.json(
        { success: false, error: 'Une production est déjà en cours. Patientez.', code: 'en-cours', scheduledDate: enCoursAilleurs.date, scheduledTime: enCoursAilleurs.time },
        { status: 409 },
      );
    }
    effacerResultat(userId);
    const { data: lignes, error } = await supabaseAdmin
      .from('autopilot_config')
      .select('*')
      .eq('user_id', userId)
      .limit(1);
    if (error) {
      return NextResponse.json(
        { success: false, error: 'Configuration indisponible — la migration autopilot_config est-elle appliquée ?' },
        { status: 503 },
      );
    }
    // Ligne absente : les défauts — sans rush, donc refus juste en dessous.
    const config = configDepuisLigne((lignes?.[0] as Record<string, unknown> | undefined) ?? null);

    // ── Verrou 1 bis : aucune vidéo avec avatar encore en préparation ─────
    // Sans avatar, le verrou `enVol` ne voit que CE processus et sa mémoire ;
    // une production avec avatar du même compte attend, elle, en FILE
    // (`autopilot_jumeau_attente`, persistante). Lancer un second montage
    // pendant ce temps ferait deux générations pour un seul geste. Refus AVANT
    // toute lecture coûteuse, tout rendu, tout débit. (Avec avatar : la file a
    // déjà son propre verrou par créneau — comportement inchangé.)
    if (!avatarActifConfig(config) && await jumeauEnPreparation(userId).catch(() => false)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Une vidéo avec votre avatar est encore en préparation. Attendez qu’elle soit déposée dans le Calendrier avant de lancer une autre production : rien n’a été lancé ni débité.',
          code: 'generation-en-cours',
        },
        { status: 409 },
      );
    }

    // ── Refus SANS DÉBIT ────────────────────────────────────────────────
    // MULTI-SOURCES : le refus ne vaut que si AUCUNE source visuelle n'existe —
    // calculé ici, depuis la configuration (rushes personnels selon `actives`,
    // avatar actif, stock retenu, vidéos stock importées). Le jumeau tient la
    // séquence « Vidéo » à lui seul ; sa disponibilité est vérifiée à son lancement.
    if (!aUneSourceVisuelle(etatSourcesServeur(config))) {
      return NextResponse.json(
        { success: false, error: 'Aucun rush dans la banque : ajoutez au moins une vidéo.', code: 'sans-rush' },
        { status: 422 },
      );
    }
    // SOURCE = média LISIBLE (`validite-rush.ts`). Des rushes configurés mais
    // tous introuvables, expirés ou refusés valent une banque vide : sans
    // autre source, refus — jamais un montage titre/cartes/CTA seul. Sondé
    // seulement sans avatar (le jumeau porte la séquence à lui seul) ; un
    // rush refusé par la garde de propriété n'est jamais contacté.
    if (!avatarActifConfig(config) && config.rushUrls.length > 0) {
      const rushUrls = await rushesUtilisablesServeur(config.rushUrls, (u) => mediaLisiblePar(u, userId), sondeRushPour(userId));
      if (!aUneSourceVisuelle(etatSourcesServeur({ ...config, rushUrls }))) {
        return NextResponse.json(
          { success: false, error: 'Aucun média utilisable pour ce montage.', code: 'sans-rush' },
          { status: 422 },
        );
      }
    }
    // ── A4 v3 : durée à confirmer — SANS DÉBIT, SANS APPEL ────────────────
    // Avatar seul et cible sous 20 s : le message complet ne tient pas. Rien
    // n'est généré ni débité, et la durée n'est jamais changée ici : le clic
    // « Passer à 30 s » (route de configuration existante) confirme.
    if (dureeAConfirmerAvecAvatar(config.brief?.duree, avatarSeulConfig(config))) {
      return NextResponse.json(
        { success: false, error: messageDureeAConfirmer(config.brief?.duree as number), code: CODE_DUREE_A_CONFIRMER, recommandee: DUREE_RECOMMANDEE_AVATAR },
        { status: 409 },
      );
    }
    // Avec le jumeau, deux coûts : la génération de l'avatar (`avatar.jumeau`,
    // débitée au lancement) PUIS le rendu (`coutMontage()`, à la finalisation).
    // On vérifie les deux d'avance pour ne pas lancer (et facturer l'avatar) un
    // montage dont le rendu échouerait faute de crédits. Prix lus UNE fois
    // dans la grille centrale ; le rendu débite ce même `coutRendu`.
    // + l'affiche de référence quand elle sera produite (débitée après dépôt).
    // La MÊME formule que le devis affiché (`devisMontage`).
    const devis = await devisMontage(config);
    const coutRendu = devis.rendu;
    const cout = devis.total;
    const credits = await getUserCredits(userId).catch(() => 0);
    if (credits < cout) {
      return NextResponse.json({
        success: false,
        error: `Crédits insuffisants : ce montage coûte ${cout} crédits, il vous en reste ${credits}.`,
        code: 'credits',
        cout,
        solde: credits,
        manque: cout - credits,
      }, { status: 402 });
    }

    // ── Le créneau : aujourd'hui, maintenant arrondi, chez l'utilisateur ──
    const now = Date.now();
    const { date, time } = creneauImmediat(now, config.runTimezone);
    // Le MÊME jeton que relit le suivi (`jetonManuel`) — `manuel:<slotKey>`.
    const jeton = jetonManuel(userId, date, time);

    // ── Verrou 2 : le créneau n'a pas déjà été produit ──────────────────
    const dejaFaits = await creneauxExistants(userId);
    if (dejaFaits.has(jeton)) {
      return NextResponse.json(
        { success: false, error: 'Un brouillon vient déjà d’être produit pour ce créneau.', code: 'deja-produit' },
        { status: 409 },
      );
    }

    // ── Le sujet : celui de l'APERÇU quand l'écran l'envoie ──────────────
    // Sinon, comme le cron : différent des derniers brouillons.
    const recents = await sujetsRecents(userId);
    const choix = choisirContenuManuel({ config, apercuSignature, recents, now });
    if (!choix.ok) {
      return NextResponse.json({ success: false, error: choix.message, code: choix.code }, { status: 409 });
    }
    const { topic } = choix;

    // ── Brouillon FORCÉ ─────────────────────────────────────────────────
    // `mode: review` → statut `draft` (`statusForMode`) ; `platforms: []` →
    // aucun réseau. Les deux sont posés sur la configuration transmise ET
    // sur le post : `toPostRow` lit le statut sur l'une, les réseaux sur
    // l'autre, et les métadonnées (`autopilotMode`) sur la première.
    const configBrouillon = { ...config, mode: 'review' as const, platforms: [] as string[] };
    const [prepare] = preparePosts({ config: configBrouillon, topic, count: 1, now, seeds: choix.seeds });
    const post = { ...prepare, scheduledDate: date, scheduledTime: time, platforms: [] as string[] };

    // Verrou 3 : `jobId` DÉTERMINISTE pour le créneau — la référence de
    // débit `autopilote:<jobId>` l'est donc aussi.
    const jobId = jobIdManuel(userId, date, time);
    console.log(`[Autopilote/Manuel] ${userId} — sujet : ${topic}, créneau ${date} ${time}`);

    // ── JUMEAU : lancement ASYNCHRONE, sans navigateur ──────────────────
    // La génération D-ID prend des minutes ; on ne bloque pas la requête (300 s).
    // On LANCE la génération et on met le montage en file — le finaliseur (cron)
    // le rendra dès que la vidéo est prête. Le montage arrive dans le Calendrier
    // quelques minutes plus tard, même si l'onglet est fermé.
    if (avatarActifConfig(configBrouillon)) {
      // COÛT FOURNISSEUR — lancement manuel d'un admin : le devis HeyGen de
      // CETTE vidéo (moteur de l'Autopilote, durée estimée de SON script)
      // AVANT toute réservation, tout débit et tout appel. 428 sinon.
      if (await compteExempteDeCredits(userId)) {
        const devisFournisseur = await devisVideoAutopilote(userId, configBrouillon, scriptJumeauMontage(post, configBrouillon));
        if (devisFournisseur && !confirmationValable(coutConfirme, moteurConfirme, devisFournisseur)) return reponseConfirmationCout(devisFournisseur);
      }
      const lancement = await lancerJumeauMontage({
        userId,
        config: configBrouillon,
        post,
        rang: 0,
        now,
        jobId,
        slotKey: jeton,
        metadataSupplement: { production: 'manuelle', ...(choix.depuisApercu ? { contenuDepuisApercu: true, apercuSignature: choix.contenuSignature } : null) },
        journal: '[Autopilote/Manuel]',
      });
      if (!lancement.ok) {
        // Moteur indisponible / crédits / texte : rien n'est monté, on le dit.
        const statut = lancement.motif === 'credits_insuffisants' ? 402 : lancement.motif === CODE_DUREE_A_CONFIRMER ? 409 : 400;
        return NextResponse.json(
          { success: false, error: lancement.message, code: lancement.motif === CODE_DUREE_A_CONFIRMER ? CODE_DUREE_A_CONFIRMER : `jumeau-${lancement.motif}` },
          { status: statut },
        );
      }
      return NextResponse.json({
        success: true,
        jumeau: 'en_preparation',
        // ⚠️ RIEN N'EST ENCORE DANS LE CALENDRIER : le montage attend la vidéo
        // de l'avatar, en file. L'écran le dit et suit la file
        // (`/progression` → `jumeau`) jusqu'au post RÉELLEMENT déposé.
        message: 'Votre avatar se prépare. Le brouillon sera déposé dans le Calendrier dès que sa vidéo sera prête.',
        jobId,
        scheduledDate: date,
        scheduledTime: time,
        timezone: config.runTimezone,
        status: 'draft',
        platforms: [],
        cout,
        title: post.title,
      });
    }

    // ── Rendu EN ARRIÈRE-PLAN ────────────────────────────────────────────
    // Réponse immédiate (202), rendu qui continue, résultat relu par l'écran
    // (`/progression`). La requête ne reste plus ouverte 10 minutes : une
    // coupure réseau ou un rechargement ne fait plus croire à un échec — ce
    // qui laissait relancer une DEUXIÈME production (staging 30/09 : créneaux
    // 21:10 puis 21:45, un seul post voulu). Le verrou `enVol` tient jusqu'à
    // la FIN du rendu, pas jusqu'à la fin de la requête.
    // ── RÉSERVATION PERSISTANTE, AVANT LE RENDU ─────────────────────────
    // La base tranche (`unique (user_id, slot_key)` + mise à jour
    // conditionnelle) : deux onglets, deux processus, un redémarrage → un seul
    // rendu. Base en panne : RIEN n'est lancé (jamais un rendu sans verrou).
    const reservation = await reserverProductionDirecte(userId, {
      jobId, date, time, timezone: config.runTimezone, title: post.title,
    }, now);
    if (!reservation.ok) {
      if (reservation.raison === 'en_cours') {
        return NextResponse.json(
          { success: false, error: 'Une production est déjà en cours. Patientez.', code: 'en-cours', scheduledDate: reservation.date, scheduledTime: reservation.time },
          { status: 409 },
        );
      }
      console.error(`[Autopilote/Manuel] ${userId} — réservation impossible : ${reservation.message}`);
      return NextResponse.json(
        { success: false, error: 'Production impossible pour le moment : rien n’a été lancé ni débité. Réessayez dans un instant.', code: 'base' },
        { status: 503 },
      );
    }

    const noter = (etape: Parameters<typeof noterProgression>[1], avancement = 0) => {
      noterProgression(userId, etape, avancement);
      const p = lireProgression(userId);
      if (p) void noterEtapeDirecte(userId, jobId, { etape: p.etape, avancement: p.avancement ?? null, pourcent: p.pourcent });
    };
    noter('analyse', 0);
    // Signe de vie : sans lui, un rendu long sans changement d'étape serait
    // pris pour un orphelin. S'arrête avec le rendu.
    const battement = setInterval(() => { void battementDirect(userId, jobId); }, BATTEMENT_DIRECT_MS);
    (battement as { unref?: () => void }).unref?.();
    delegue = true;
    void produireUnMontage({
      onProgression: (etape, avancement) => noter(etape, avancement),
      userId,
      config: configBrouillon,
      post,
      rang: 0,
      now,
      jobId,
      slotKey: jeton,
      journal: '[Autopilote/Manuel]',
      // Le prix annoncé et contrôlé ci-dessus : c'est lui qui sera débité.
      coutRendu,
      metadataSupplement: { production: 'manuelle', ...(choix.depuisApercu ? { contenuDepuisApercu: true, apercuSignature: choix.contenuSignature } : null) },
    }).then(async (rendu) => {
      // PREUVE avant d'annoncer un dépôt : le post existe pour CE compte, avec
      // sa vidéo, dans un statut que le Calendrier affiche.
      const depose = rendu.postId ? await postVisibleDansCalendrier(userId, rendu.postId) : null;
      if (!depose) {
        const error = 'Le rendu est terminé, mais le brouillon n’a pas été retrouvé dans le Calendrier.';
        noterResultat(userId, { success: false, error });
        await terminerProductionDirecte(userId, jobId, { ok: false, message: error });
        return;
      }
      await terminerProductionDirecte(userId, jobId, { ok: true, postId: depose.postId });
      noterResultat(userId, {
        success: true,
        postId: depose.postId,
        // Le Calendrier ne lit pas de paramètre d'URL : le lien mène à la page,
        // et la date dit où regarder — celle RELUE dans le post.
        calendrierUrl: '/dashboard/calendar',
        scheduledDate: depose.scheduledDate,
        scheduledTime: depose.scheduledTime,
        timezone: config.runTimezone,
        status: 'draft',
        platforms: [],
        avertissements: rendu.avertissements,
        cout: coutRendu,
        debite: rendu.debite,
        videoUrl: depose.videoUrl,
        thumbnailUrl: rendu.thumbnailUrl,
        title: post.title,
      });
    }).catch((err) => {
      console.error('[Autopilote/Manuel]', err instanceof Error ? err.message : err);
      // File de rendu : un serveur saturé n'est pas une panne du montage — on le dit.
      const message = estErreurDeFile(err)
        ? err.message
        : 'Production impossible. Rien n’a été débité.';
      noterResultat(userId, { success: false, error: message });
      return terminerProductionDirecte(userId, jobId, { ok: false, message });
    }).catch((err) => {
      console.error('[Autopilote/Manuel] fin non écrite :', err instanceof Error ? err.message : err);
    }).finally(() => {
      clearInterval(battement);
      enVol.delete(userId);
    });

    return NextResponse.json({
      success: true,
      enCours: true,
      jobId,
      scheduledDate: date,
      scheduledTime: time,
      timezone: config.runTimezone,
      title: post.title,
    }, { status: 202 });
  } catch (err) {
    console.error('[Autopilote/Manuel]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: 'Production impossible. Rien n’a été débité.' },
      { status: 500 },
    );
  } finally {
    // Rendu délégué : c'est LUI qui libère le verrou, à sa fin.
    if (!delegue) {
      enVol.delete(userId);
      effacerProgression(userId);
    }
  }
}
