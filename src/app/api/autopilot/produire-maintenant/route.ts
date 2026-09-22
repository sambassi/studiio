import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits } from '@/lib/credits/system';
import { politiqueDeLUtilisateur } from '@/lib/facturation/politique';
import { creneauImmediat } from '@/lib/autopilot/rules';
import { preparePosts, slotKey } from '@/lib/autopilot/engine';
import { pickTopics } from '@/lib/autopilot/topics';
import {
  produireUnMontage, sujetsRecents, creneauxExistants, configDepuisLigne, COST_PER_VIDEO,
} from '@/lib/autopilot/produire';

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
 * ⚠️ LE MÊME NOMBRE QUE LE DÉBIT. `COST_PER_VIDEO` est ce que
 * `produireUnMontage` retire ; l'annoncer depuis une autre source
 * (`/api/render/tarifs` lit `tarifs_rendu`, le tarif des rendus navigateur)
 * pourrait afficher un prix et en débiter un autre. La politique vient de
 * la base, comme partout : un administrateur voit « frais partenaires », pas
 * un nombre qu'on ne lui retirera pas.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const [{ politique }, solde] = await Promise.all([
    politiqueDeLUtilisateur(userId),
    getUserCredits(userId).catch(() => null),
  ]);
  return NextResponse.json({
    success: true,
    politique,
    cout: COST_PER_VIDEO,
    solde,
    enCours: enVol.has(userId),
  });
}

export async function POST(req?: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ── La vidéo du jumeau, si le navigateur en a produit une ───────────────
  // Le navigateur (qui SEUL peut attendre les 5-20 min d'une génération D-ID,
  // comme dans Créer) génère la vidéo du jumeau, PUIS appelle cette route avec
  // son URL. On ne la croit pas sur parole : elle est revalidée en base plus
  // bas. Corps illisible ou champ absent = montage ordinaire, comme avant.
  // `req` est optionnel : Next.js le fournit toujours, mais un appel direct
  // (tests) peut s'en passer — c'est alors un montage ordinaire.
  let jumeauVideoUrl: string | null = null;
  if (req) {
    try {
      const corps = await req.json().catch(() => null);
      const v = (corps as { jumeauVideoUrl?: unknown } | null)?.jumeauVideoUrl;
      if (typeof v === 'string' && v.trim()) jumeauVideoUrl = v.trim();
    } catch { /* pas de corps : montage ordinaire */ }
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

    // ── La vidéo du jumeau, REVALIDÉE en base ───────────────────────────
    // Jamais montée sur la seule parole du navigateur : on confirme que cette
    // URL est bien une génération d'avatar TERMINÉE de CE compte
    // (`avatar_generations`, re-hébergée par /api/avatar/status). Un lien
    // forgé, expiré, ou d'un autre compte ne passe pas — et rien n'est débité.
    let jumeauValide: string | null = null;
    if (jumeauVideoUrl) {
      const { data: gen } = await supabaseAdmin
        .from('avatar_generations')
        .select('id')
        .eq('user_id', userId)
        .eq('video_url', jumeauVideoUrl)
        .eq('status', 'completed')
        .limit(1);
      if (!gen || gen.length === 0) {
        return NextResponse.json(
          { success: false, error: 'La vidéo de votre jumeau n’a pas pu être vérifiée. Régénérez votre jumeau.', code: 'jumeau-invalide' },
          { status: 400 },
        );
      }
      jumeauValide = jumeauVideoUrl;
    }

    // ── Refus SANS DÉBIT ────────────────────────────────────────────────
    // Le jumeau tient la séquence « Vidéo » : un montage avec jumeau n'a PAS
    // besoin de rush. Le refus « sans rush » ne vaut donc que sans jumeau.
    if (!jumeauValide && config.rushUrls.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Aucun rush dans la banque : ajoutez au moins une vidéo.', code: 'sans-rush' },
        { status: 422 },
      );
    }
    const credits = await getUserCredits(userId).catch(() => 0);
    if (credits < COST_PER_VIDEO) {
      return NextResponse.json({
        success: false,
        error: `Crédits insuffisants : ce rendu coûte ${COST_PER_VIDEO} crédits, il vous en reste ${credits}.`,
        code: 'credits',
        cout: COST_PER_VIDEO,
        solde: credits,
        manque: COST_PER_VIDEO - credits,
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

    const rendu = await produireUnMontage({
      userId,
      config: configBrouillon,
      post,
      rang: 0,
      now,
      jobId,
      slotKey: jeton,
      journal: '[Autopilote/Manuel]',
      metadataSupplement: { production: 'manuelle' },
      // La vidéo du jumeau (revalidée) devient la séquence « Vidéo » et la
      // seule voix. Absente : montage ordinaire.
      jumeauVideoUrl: jumeauValide,
    });

    return NextResponse.json({
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
      cout: COST_PER_VIDEO,
      debite: rendu.debite,
      videoUrl: rendu.videoUrl,
      thumbnailUrl: rendu.thumbnailUrl,
      title: post.title,
      // Le montage porte-t-il le jumeau en séquence « Vidéo » ?
      jumeau: !!jumeauValide,
    });
  } catch (err) {
    console.error('[Autopilote/Manuel]', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, error: 'Production impossible. Rien n’a été débité.' },
      { status: 500 },
    );
  } finally {
    enVol.delete(userId);
  }
}
