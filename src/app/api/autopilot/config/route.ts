import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { sanitizeConfig, DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * Configuration de l'Autopilote.
 *
 * `GET` rend la configuration de l'utilisateur, ou celle par defaut — un
 * compte qui n'a jamais rien regle doit voir un ecran coherent, pas une
 * erreur.
 *
 * `PUT` la remplace. La validation passe par `sanitizeConfig`, le MEME code
 * que celui qui relit la base : une valeur refusee a l'ecriture ne peut donc
 * pas etre acceptee a la lecture, ni l'inverse.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Colonnes de la base ↔ champs de l'ecran. */
function fromRow(row: Record<string, unknown> | null): AutopilotConfig {
  if (!row) return DEFAULT_CONFIG;
  return sanitizeConfig({
    enabled: row.enabled,
    mode: row.mode,
    cadence: row.cadence,
    countPerCycle: row.count_per_cycle,
    platforms: row.platforms,
    creditFloor: row.credit_floor,
    rushUrls: row.rush_urls,
    lastRunAt: row.last_run_at,
    lastRushUrl: row.last_rush_url,
    voiceEnabled: row.voice_enabled,
    topics: row.topics,
    runHour: row.run_hour,
    runTimezone: row.run_timezone,
    // ── L'identite constante ────────────────────────────────────────────
    // Colonnes ABSENTES tant que `2026-08-07-autopilot-branding.sql` n'est
    // pas appliquee : `sanitizeConfig` retombe alors sur les defauts, qui
    // sont les valeurs jusqu'ici en dur. L'ecran reste coherent.
    cardGradientStart: row.card_gradient_start,
    cardGradientEnd: row.card_gradient_end,
    titleColor: row.title_color,
    cardsShowPoster: row.cards_show_poster,
    musicUrl: row.music_url,
    voiceId: row.voice_id,
    keepRushAudio: row.keep_rush_audio,
    musicVolume: row.music_volume,
    voiceVolume: row.voice_volume,
    rushVolume: row.rush_volume,
  });
}

let storeProbe: { ready: boolean; at: number } | null = null;
const STORE_PROBE_TTL_MS = 60_000;

/** La table existe-t-elle ? Memoise, comme les autres sondes du depot. */
async function storeReady(): Promise<boolean> {
  const now = Date.now();
  if (storeProbe?.ready) return true;
  if (storeProbe && now - storeProbe.at < STORE_PROBE_TTL_MS) return false;
  let ready = false;
  try {
    const { error } = await supabaseAdmin.from('autopilot_config').select('id').limit(1);
    ready = !error;
    if (error) {
      console.error(
        `[Autopilote] Table autopilot_config indisponible (${error.message}) — configuration DESACTIVEE. `
        + 'Appliquer migrations/2026-08-04-autopilot-config.sql puis '
        + '`docker kill -s SIGUSR1 studiio-postgrest`.',
      );
    }
  } catch (err) {
    console.error('[Autopilote] Sonde autopilot_config impossible :', err);
  }
  storeProbe = { ready, at: now };
  return ready;
}

let brandingProbe: { ready: boolean; at: number } | null = null;

/**
 * Les colonnes d'identite constante existent-elles ?
 *
 * ⚠️ SONDE DISTINCTE DE CELLE DE LA TABLE, et ce n'est pas du zele. La table
 * `autopilot_config` existe depuis le 4 aout ; les colonnes de branding
 * arrivent le 7. Entre les deux deploiements — ou si l'exploitant applique une
 * migration et pas l'autre — ecrire `card_gradient_start` ferait echouer
 * l'upsert ENTIER : l'utilisateur ne pourrait plus rien enregistrer, pas meme
 * sa cadence, pour une colonne qu'il n'a peut-etre jamais touchee.
 *
 * Tant qu'elles manquent, on ecrit le reste et on le DIT (`brandingReady`),
 * plutot que de refuser ou de faire croire que c'est enregistre.
 */
async function brandingReady(): Promise<boolean> {
  const now = Date.now();
  if (brandingProbe?.ready) return true;
  if (brandingProbe && now - brandingProbe.at < STORE_PROBE_TTL_MS) return false;
  let ready = false;
  try {
    const { error } = await supabaseAdmin
      .from('autopilot_config')
      .select('card_gradient_start')
      .limit(1);
    ready = !error;
    if (error) {
      console.error(
        `[Autopilote] Colonnes d'identite absentes (${error.message}) — couleurs, musique, `
        + 'voix et mixeur NON enregistres. Appliquer '
        + 'migrations/2026-08-07-autopilot-branding.sql puis '
        + '`docker kill -s SIGUSR1 studiio-postgrest`.',
      );
    }
  } catch (err) {
    console.error('[Autopilote] Sonde des colonnes d\'identite impossible :', err);
  }
  brandingProbe = { ready, at: now };
  return ready;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await storeReady())) {
      // Pas une erreur : l'ecran s'affiche en lecture seule et dit ce qui
      // manque, au lieu de laisser un formulaire qui n'enregistrerait rien.
      return NextResponse.json({
        success: true, ready: false, brandingReady: false, config: DEFAULT_CONFIG,
      });
    }
    const { data } = await supabaseAdmin
      .from('autopilot_config')
      .select('*')
      .eq('user_id', session.user.id)
      .limit(1);
    return NextResponse.json({
      success: true,
      ready: true,
      brandingReady: await brandingReady(),
      config: fromRow((data?.[0] as Record<string, unknown>) ?? null),
    });
  } catch (err) {
    console.error('[Autopilote] lecture :', err instanceof Error ? err.message : err);
    return NextResponse.json({
      success: true, ready: false, brandingReady: false, config: DEFAULT_CONFIG,
    });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await storeReady())) {
      return NextResponse.json(
        {
          success: false,
          error: 'L’Autopilote n’est pas encore disponible : la migration autopilot_config n’a pas été appliquée.',
        },
        { status: 503 },
      );
    }

    const propre = sanitizeConfig(await req.json().catch(() => ({})));
    const avecIdentite = await brandingReady();
    const { error } = await supabaseAdmin
      .from('autopilot_config')
      .upsert(
        {
          user_id: session.user.id,
          enabled: propre.enabled,
          mode: propre.mode,
          cadence: propre.cadence,
          count_per_cycle: propre.countPerCycle,
          platforms: propre.platforms,
          credit_floor: propre.creditFloor,
          voice_enabled: propre.voiceEnabled,
          topics: propre.topics,
          run_hour: propre.runHour,
          run_timezone: propre.runTimezone,
          rush_urls: propre.rushUrls,
          // L'identite constante — heritee par TOUTES les futures videos.
          // Omise tant que la migration du 7 aout n'est pas appliquee : voir
          // `brandingReady`.
          ...(avecIdentite ? {
            card_gradient_start: propre.cardGradientStart,
            card_gradient_end: propre.cardGradientEnd,
            title_color: propre.titleColor,
            cards_show_poster: propre.cardsShowPoster,
            music_url: propre.musicUrl,
            voice_id: propre.voiceId,
            keep_rush_audio: propre.keepRushAudio,
            music_volume: propre.musicVolume,
            voice_volume: propre.voiceVolume,
            rush_volume: propre.rushVolume,
          } : null),
          // `last_run_at` et `last_rush_url` appartiennent au MOTEUR : les
          // laisser ecrire par l'ecran permettrait de relancer une generation
          // en boucle en remettant la date a zero.
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      );
    if (error) {
      console.error('[Autopilote] ecriture :', error.message);
      return NextResponse.json({ success: false, error: 'Enregistrement impossible.' }, { status: 500 });
    }
    return NextResponse.json({ success: true, brandingReady: avecIdentite, config: propre });
  } catch (err) {
    console.error('[Autopilote] ecriture :', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Enregistrement impossible.' }, { status: 500 });
  }
}
