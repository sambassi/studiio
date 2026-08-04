import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits } from '@/lib/credits/system';
import { sendEmailSilent } from '@/lib/email/resend';
import { sanitizeConfig, decideRun, type SkipReason } from '@/lib/autopilot/rules';
import { preparePosts, toPostRow } from '@/lib/autopilot/engine';

/**
 * Moteur de l'Autopilote — un passage par appel.
 *
 * Calque sur `/api/cron/publish` : meme authentification par
 * `Authorization: Bearer $CRON_SECRET`, meme forme de rapport.
 *
 * ⚠️ IL NE COMPOSE PAS LA VIDEO. Voir l'en-tete de `lib/autopilot/engine` :
 * le compositeur est un compositeur de NAVIGATEUR, et les cartes sont une
 * photographie du DOM de l'apercu. Le moteur prepare tout le reste et depose
 * le post en brouillon ; la composition se fait a l'ouverture.
 *
 * Il ne debite donc AUCUN credit : rien n'a ete rendu, et la composition
 * debitera a son tour.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Cout indicatif d'un montage — sert au calcul du plancher, pas a debiter. */
const COST_PER_VIDEO = 10;

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Previent l'utilisateur quand le moteur s'arrete pour une raison qu'il peut lever. */
function notifier(email: string | null | undefined, reason: SkipReason): void {
  if (!email) return;
  const messages: Partial<Record<SkipReason, { subject: string; body: string }>> = {
    credits: {
      subject: 'Autopilote en pause — crédits insuffisants',
      body: 'Votre Autopilote s’est arrêté : votre solde est descendu au seuil que vous avez fixé. '
        + 'Rechargez vos crédits ou abaissez le seuil pour qu’il reprenne.',
    },
    'sans-rush': {
      subject: 'Autopilote en attente — ajoutez des rushes',
      body: 'Votre Autopilote est actif mais sa banque de rushes est vide. '
        + 'Ajoutez-y au moins une vidéo pour qu’il puisse produire.',
    },
  };
  const m = messages[reason];
  if (!m) return;
  // Fire-and-forget : un envoi d'email ne doit jamais retarder le passage
  // suivant, ni le faire echouer.
  sendEmailSilent({
    to: email,
    subject: m.subject,
    html: `<p>${m.body}</p>`,
  });
}

interface RapportUtilisateur {
  userId: string;
  prepares: number;
  saute?: SkipReason;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const rapport: RapportUtilisateur[] = [];

  try {
    const { data: lignes, error } = await supabaseAdmin
      .from('autopilot_config')
      .select('*')
      .eq('enabled', true);

    if (error) {
      console.error('[Autopilote/Cron] lecture des configurations :', error.message);
      return NextResponse.json(
        {
          success: false,
          error: 'Configuration indisponible — la migration autopilot_config est-elle appliquée ?',
        },
        { status: 503 },
      );
    }

    for (const ligne of lignes ?? []) {
      const userId = String((ligne as Record<string, unknown>).user_id ?? '');
      if (!userId) continue;

      const config = sanitizeConfig({
        enabled: ligne.enabled,
        mode: ligne.mode,
        cadence: ligne.cadence,
        countPerCycle: ligne.count_per_cycle,
        platforms: ligne.platforms,
        creditFloor: ligne.credit_floor,
        rushUrls: ligne.rush_urls,
        lastRunAt: ligne.last_run_at,
        lastRushUrl: ligne.last_rush_url,
      });

      const credits = await getUserCredits(userId).catch(() => 0);
      const decision = decideRun({ config, credits, costPerVideo: COST_PER_VIDEO, now });

      if (!decision.run) {
        // « pas encore » est le cas NORMAL entre deux cycles : on ne
        // previent que sur ce que l'utilisateur peut lever.
        if (decision.reason === 'credits' || decision.reason === 'sans-rush') {
          const { data: u } = await supabaseAdmin
            .from('users').select('email').eq('id', userId).limit(1);
          notifier((u?.[0] as { email?: string } | undefined)?.email, decision.reason);
        }
        rapport.push({ userId, prepares: 0, saute: decision.reason });
        continue;
      }

      // Le sujet vient des objectifs de l'utilisateur, sinon d'un repli.
      const { data: objectifs } = await supabaseAdmin
        .from('objectives').select('*').eq('user_id', userId).limit(1);
      const topic = String(
        (objectifs?.[0] as Record<string, unknown> | undefined)?.target_audience
        || (objectifs?.[0] as Record<string, unknown> | undefined)?.platform
        || 'motivation quotidienne',
      );

      const posts = preparePosts({ config, topic, count: decision.count, now });
      const lignesPost = posts.map((p) => toPostRow(userId, p, config));

      const { error: insertError } = await supabaseAdmin.from('scheduled_posts').insert(lignesPost);
      if (insertError) {
        console.error('[Autopilote/Cron] insertion des posts :', insertError.message);
        // `last_run_at` n'est PAS avance : un echec d'ecriture doit pouvoir
        // etre rattrape au passage suivant, pas saute d'un cycle entier.
        rapport.push({ userId, prepares: 0 });
        continue;
      }

      await supabaseAdmin
        .from('autopilot_config')
        .update({
          last_run_at: new Date(now).toISOString(),
          // Le dernier rush du cycle : la rotation repartira du suivant.
          last_rush_url: posts[posts.length - 1]?.rushUrl ?? config.lastRushUrl,
          updated_at: new Date(now).toISOString(),
        })
        .eq('user_id', userId);

      rapport.push({ userId, prepares: posts.length });
    }

    const total = rapport.reduce((n, r) => n + r.prepares, 0);
    console.log(`[Autopilote/Cron] ${rapport.length} compte(s) examine(s), ${total} montage(s) prepare(s)`);
    return NextResponse.json({
      success: true,
      comptes: rapport.length,
      prepares: total,
      // Les montages attendent leur composition, faite au navigateur.
      pendingRender: total > 0,
      rapport,
    });
  } catch (err) {
    console.error('[Autopilote/Cron]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Passage impossible.' }, { status: 500 });
  }
}
