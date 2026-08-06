import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits } from '@/lib/credits/system';
import { sendEmailSilent } from '@/lib/email/resend';
import { sanitizeConfig, decideRun, type SkipReason } from '@/lib/autopilot/rules';
import { preparePosts, toPostRow, slotKey } from '@/lib/autopilot/engine';
import { buildAutopilotDesign, buildAutopilotMetadata, AUTOPILOT_FORMAT } from '@/lib/autopilot/design';
import { renderAndUpload } from '@/lib/autopilot/render';
import { pickPosterUrl, probeRushSeconds } from '@/lib/autopilot/poster';
import { buildAutopilotVoices } from '@/lib/autopilot/voice';
import { pickTopics } from '@/lib/autopilot/topics';
import { deductCredits, getVideoRenderCost } from '@/lib/credits/system';

/**
 * Moteur de l'Autopilote — un passage par appel.
 *
 * Calque sur `/api/cron/publish` : meme authentification par
 * `Authorization: Bearer $CRON_SECRET`, meme forme de rapport.
 *
 * ⚠️ IL REND LA VIDEO, depuis que la composition Remotion existe. Chaque
 * montage est rendu sous Chromium sans tete, televerse, puis depose avec son
 * media. Le statut suit le mode : `review` -> brouillon, `auto` -> programme.
 *
 * ⚠️ CHAQUE MONTAGE EST ISOLE. Un rendu peut echouer — Chromium qui ne
 * demarre pas, un rush illisible, un televersement refuse. Un echec ne doit
 * emporter ni les autres montages du cycle, ni les autres comptes : chaque
 * item a son `try`, et le cycle continue.
 *
 * ⚠️ CE PASSAGE NE PUBLIE RIEN. Il prepare des posts ; c'est
 * `/api/cron/publish` qui publie, et seulement ceux qui sont `scheduled`.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Cout d'un montage, en credits.
 *
 * L'Autopilote produit du vertical : c'est donc le tarif « reel », le meme
 * que celui d'un rendu manuel. Il sert a DEUX choses — borner le nombre de
 * montages du cycle, et debiter apres chaque rendu reussi.
 */
const COST_PER_VIDEO = getVideoRenderCost('reel');

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
  /** Montages rendus, televerses et deposes. */
  prepares: number;
  /** Montages perdus en route — le detail est dans les journaux. */
  echecs?: number;
  /** Creneaux deja produits, ignores pour ne pas doubler. */
  doublons?: number;
  saute?: SkipReason;
}

/**
 * Sujets des derniers montages de l'Autopilote.
 *
 * Sert a ne pas reproposer un theme dont un brouillon traine encore : deux
 * vidéos sur le meme sujet dans le meme Calendrier se remarquent.
 */
async function sujetsRecents(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('scheduled_posts')
    .select('title, metadata')
    .eq('user_id', userId)
    .eq('agent_generated', true)
    .order('created_at', { ascending: false })
    .limit(12);
  const out: string[] = [];
  for (const ligne of (data ?? []) as Array<Record<string, unknown>>) {
    const meta = (ligne.metadata ?? {}) as Record<string, unknown>;
    if (meta.source !== 'autopilote') continue;
    if (typeof ligne.title === 'string' && ligne.title) out.push(ligne.title);
  }
  return out;
}

/**
 * Creneaux deja produits pour cet utilisateur.
 *
 * IDEMPOTENCE : la cadence empeche deja deux cycles rapproches, mais elle ne
 * protege de rien si `last_run_at` n'a pas pu etre ecrit APRES l'insertion
 * des posts — et c'est l'ordre reel des operations. On relit donc les
 * creneaux existants avant d'inserer.
 */
async function creneauxExistants(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('scheduled_posts')
    .select('scheduled_date, scheduled_time, metadata')
    .eq('user_id', userId)
    .eq('agent_generated', true);
  const out = new Set<string>();
  for (const ligne of (data ?? []) as Array<Record<string, unknown>>) {
    const meta = (ligne.metadata ?? {}) as Record<string, unknown>;
    if (meta.source !== 'autopilote') continue;
    // Le jeton s'il existe ; sinon on le reconstruit, pour couvrir les posts
    // deposes avant son introduction.
    out.add(
      typeof meta.slotKey === 'string'
        ? meta.slotKey
        : slotKey(userId, String(ligne.scheduled_date ?? ''), String(ligne.scheduled_time ?? '')),
    );
  }
  return out;
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
        voiceEnabled: ligne.voice_enabled,
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

      // ⚠️ UN SUJET PAR MONTAGE, ET DIFFERENT DES DERNIERS. L'ancien code
      // lisait `objectives.target_audience` — une seule valeur par compte —
      // et produisait donc toujours la meme video : le titre, les cartes, le
      // CTA et jusqu'a la photo d'affiche en decoulent.
      const recents = await sujetsRecents(userId);
      const topics = pickTopics({
        count: decision.count,
        exclude: recents,
        // La graine tourne avec le jour : deux cycles qui trouvent les memes
        // exclusions ne repartent pas sur le meme sujet.
        seed: Math.floor(now / 86_400_000),
      });
      console.log(`[Autopilote/Cron] ${userId} — sujets : ${topics.join(', ')}`);

      const posts = preparePosts({ config, topic: topics, count: decision.count, now });
      const dejaFaits = await creneauxExistants(userId);

      let reussis = 0;
      let echecs = 0;
      let doublons = 0;
      let dernierRush = config.lastRushUrl;

      for (const post of posts) {
        const jeton = slotKey(userId, post.scheduledDate, post.scheduledTime);
        if (dejaFaits.has(jeton)) {
          // Creneau deja produit : ni rendu, ni credit, ni post.
          doublons += 1;
          continue;
        }

        // ── Un montage, isole ────────────────────────────────────────────
        // Chromium peut refuser de demarrer, un rush etre illisible, un
        // televersement echouer. Rien de tout cela ne doit emporter le reste
        // du cycle.
        try {
          // Les deux sondages RESEAU, avant la fabrique de design qui reste
          // pure. Aucun des deux ne peut faire echouer le cycle : ils rendent
          // `null` et le montage sort comme avant.
          const [posterUrl, rushSeconds] = await Promise.all([
            // La variante fait tourner le tirage : deux montages du meme
            // theme n'ont pas la meme affiche.
            pickPosterUrl(post.title, posts.indexOf(post) + Math.floor(now / 3_600_000)),
            post.rushUrl ? probeRushSeconds(post.rushUrl) : Promise.resolve(null),
          ]);
          const jobId = `autopilote-${userId}-${post.scheduledDate}-${Date.now()}`;
          // La voix AVANT le design : ce sont ses durees qui calent les
          // sequences. Un echec de TTS rend `{}` et le montage sort muet.
          //
          // ⚠️ ET SEULEMENT SI ELLE A ETE DEMANDEE. ElevenLabs facture a
          // l'usage : sans ce garde, chaque montage declencherait quatre
          // syntheses payantes chez des utilisateurs qui n'ont rien demande.
          const voices = config.voiceEnabled
            ? await buildAutopilotVoices({ userId, jobId, post })
            : {};
          const design = buildAutopilotDesign(post, { posterUrl, rushSeconds, voices });
          const { videoUrl, thumbnailUrl, durationFrames } = await renderAndUpload({ userId, jobId, design });

          const metadata = buildAutopilotMetadata({
            post, design, videoUrl, thumbnailUrl, mode: config.mode,
          });
          const { error: insertError } = await supabaseAdmin
            .from('scheduled_posts')
            .insert(toPostRow({ userId, post, config, videoUrl, metadata }));
          if (insertError) throw new Error(`insertion du post : ${insertError.message}`);

          // Debit APRES coup, comme le chemin manuel : la video est en ligne
          // et le post existe. Debiter avant ferait payer un rendu qui peut
          // encore echouer.
          try {
            await deductCredits(userId, COST_PER_VIDEO, 'render');
          } catch (e) {
            // Le montage est livre : on ne le retire pas pour un debit
            // manque. On le dit fort, c'est tout.
            console.error(
              `[Autopilote/Cron] debit manque pour ${userId} (${COST_PER_VIDEO} credits) :`,
              e instanceof Error ? e.message : e,
            );
          }

          dejaFaits.add(jeton);
          dernierRush = post.rushUrl ?? dernierRush;
          reussis += 1;
          console.log(
            `[Autopilote/Cron] ${userId} — montage ${post.scheduledDate} rendu `
            + `(${durationFrames} images, ${AUTOPILOT_FORMAT}`
            + `, affiche ${posterUrl ? 'oui' : 'non'}`
            + `, rush ${rushSeconds ? `${rushSeconds.toFixed(1)}s` : 'non sonde'}`
            + `, voix ${config.voiceEnabled ? `${Object.keys(voices).length}/4` : 'desactivee'}`
            + `) : ${videoUrl}`,
          );
        } catch (err) {
          echecs += 1;
          console.error(
            `[Autopilote/Cron] ${userId} — montage ${post.scheduledDate} echoue :`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // `last_run_at` n'avance que si QUELQUE CHOSE a ete produit : un cycle
      // entierement rate doit pouvoir etre rattrape au passage suivant,
      // plutot que saute d'une cadence entiere.
      if (reussis > 0) {
        await supabaseAdmin
          .from('autopilot_config')
          .update({
            last_run_at: new Date(now).toISOString(),
            // Le dernier rush reellement utilise : la rotation repartira du
            // suivant. Un rush dont le rendu a echoue ne compte pas.
            last_rush_url: dernierRush,
            updated_at: new Date(now).toISOString(),
          })
          .eq('user_id', userId);
      }

      rapport.push({
        userId,
        prepares: reussis,
        ...(echecs ? { echecs } : null),
        ...(doublons ? { doublons } : null),
      });
    }

    const total = rapport.reduce((n, r) => n + r.prepares, 0);
    const rates = rapport.reduce((n, r) => n + (r.echecs ?? 0), 0);
    console.log(
      `[Autopilote/Cron] ${rapport.length} compte(s) examine(s), `
      + `${total} montage(s) rendu(s), ${rates} echec(s)`,
    );
    return NextResponse.json({
      success: true,
      comptes: rapport.length,
      rendus: total,
      echecs: rates,
      rapport,
    });
  } catch (err) {
    console.error('[Autopilote/Cron]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Passage impossible.' }, { status: 500 });
  }
}
