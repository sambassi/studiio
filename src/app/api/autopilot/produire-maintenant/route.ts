import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits } from '@/lib/credits/system';
import { politiqueDeLUtilisateur } from '@/lib/facturation/politique';
import { creneauImmediat } from '@/lib/autopilot/rules';
import { preparePosts, slotKey } from '@/lib/autopilot/engine';
import { pickTopics } from '@/lib/autopilot/topics';
import {
  produireUnMontage, sujetsRecents, creneauxExistants, configDepuisLigne, devisMontage,
} from '@/lib/autopilot/produire';
import { lancerJumeauMontage } from '@/lib/autopilot/jumeau-async';
import { aUneSourceVisuelle, avatarActifConfig, etatSourcesServeur } from '@/lib/autopilot/sources';
import { noterProgression, effacerProgression, noterResultat, effacerResultat } from '@/lib/autopilot/progression';

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
 * Le premier verrou vit en mémoire : il est exact pour UN processus — ce
 * que l'application est aujourd'hui (un conteneur). Plusieurs réplicas
 * n'auraient que les verrous 2 et 3, qui empêchent le double DÉBIT mais pas,
 * dans la fenêtre entre deux lectures, un double RENDU.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Utilisateurs dont une production manuelle est en cours, dans ce processus. */
const enVol = new Set<string>();

/** Préfixe des jetons manuels : jamais confondus avec un créneau du cron. */
const PREFIXE_MANUEL = 'manuel:';

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
  return NextResponse.json({
    success: true,
    politique,
    cout: devis.total,
    detail: { rendu: devis.rendu, avatar: devis.avatar, affiche: devis.affiche },
    solde,
    enCours: enVol.has(userId),
  });
}

export async function POST() {
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
  effacerResultat(userId);
  let delegue = false;
  try {
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
    const jeton = `${PREFIXE_MANUEL}${slotKey(userId, date, time)}`;

    // ── Verrou 2 : le créneau n'a pas déjà été produit ──────────────────
    const dejaFaits = await creneauxExistants(userId);
    if (dejaFaits.has(jeton)) {
      return NextResponse.json(
        { success: false, error: 'Un brouillon vient déjà d’être produit pour ce créneau.', code: 'deja-produit' },
        { status: 409 },
      );
    }

    // ── Le sujet, comme le cron : différent des derniers brouillons ─────
    const recents = await sujetsRecents(userId);
    const [topic] = pickTopics({
      count: 1,
      exclude: recents,
      // À la minute et non au jour : deux essais manuels dans la journée ne
      // doivent pas retomber sur le même sujet.
      seed: Math.floor(now / 60_000),
      pool: config.topics.length ? config.topics : undefined,
    });

    // ── Brouillon FORCÉ ─────────────────────────────────────────────────
    // `mode: review` → statut `draft` (`statusForMode`) ; `platforms: []` →
    // aucun réseau. Les deux sont posés sur la configuration transmise ET
    // sur le post : `toPostRow` lit le statut sur l'une, les réseaux sur
    // l'autre, et les métadonnées (`autopilotMode`) sur la première.
    const configBrouillon = { ...config, mode: 'review' as const, platforms: [] as string[] };
    const [prepare] = preparePosts({ config: configBrouillon, topic, count: 1, now });
    const post = { ...prepare, scheduledDate: date, scheduledTime: time, platforms: [] as string[] };

    // Verrou 3 : `jobId` DÉTERMINISTE pour le créneau — la référence de
    // débit `autopilote:<jobId>` l'est donc aussi.
    const jobId = `autopilote-manuel-${userId}-${date}-${time.replace(':', '')}`;
    console.log(`[Autopilote/Manuel] ${userId} — sujet : ${topic}, créneau ${date} ${time}`);

    // ── JUMEAU : lancement ASYNCHRONE, sans navigateur ──────────────────
    // La génération D-ID prend des minutes ; on ne bloque pas la requête (300 s).
    // On LANCE la génération et on met le montage en file — le finaliseur (cron)
    // le rendra dès que la vidéo est prête. Le montage arrive dans le Calendrier
    // quelques minutes plus tard, même si l'onglet est fermé.
    if (avatarActifConfig(configBrouillon)) {
      const lancement = await lancerJumeauMontage({
        userId,
        config: configBrouillon,
        post,
        rang: 0,
        now,
        jobId,
        slotKey: jeton,
        metadataSupplement: { production: 'manuelle' },
        journal: '[Autopilote/Manuel]',
      });
      if (!lancement.ok) {
        // Moteur indisponible / crédits / texte : rien n'est monté, on le dit.
        const statut = lancement.motif === 'credits_insuffisants' ? 402 : 400;
        return NextResponse.json(
          { success: false, error: lancement.message, code: `jumeau-${lancement.motif}` },
          { status: statut },
        );
      }
      return NextResponse.json({
        success: true,
        jumeau: 'en_preparation',
        message: 'Votre jumeau se prépare. Le montage arrivera dans le Calendrier dans quelques minutes — vous pouvez fermer cette page.',
        calendrierUrl: '/dashboard/calendar',
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
    noterProgression(userId, 'analyse', 0);
    delegue = true;
    void produireUnMontage({
      onProgression: (etape, avancement) => noterProgression(userId, etape, avancement),
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
      metadataSupplement: { production: 'manuelle' },
    }).then((rendu) => {
      noterResultat(userId, {
        success: true,
        postId: rendu.postId,
        // Le Calendrier ne lit pas de paramètre d'URL : le lien mène à la page,
        // et la date dit où regarder.
        calendrierUrl: '/dashboard/calendar',
        scheduledDate: date,
        scheduledTime: time,
        timezone: config.runTimezone,
        status: 'draft',
        platforms: [],
        avertissements: rendu.avertissements,
        cout: coutRendu,
        debite: rendu.debite,
        videoUrl: rendu.videoUrl,
        thumbnailUrl: rendu.thumbnailUrl,
        title: post.title,
      });
    }).catch((err) => {
      console.error('[Autopilote/Manuel]', err instanceof Error ? err.message : err);
      noterResultat(userId, { success: false, error: 'Production impossible. Rien n’a été débité.' });
    }).finally(() => {
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
