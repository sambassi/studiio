import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits } from '@/lib/credits/system';
import { sendEmailSilent } from '@/lib/email/resend';
import { sanitizeConfig, decideRun, type SkipReason } from '@/lib/autopilot/rules';
import { preparePosts, slotKey } from '@/lib/autopilot/engine';
import { notifyOnce, NOTIFICATION_KINDS } from '@/lib/notifications/store';
import { pickTopics } from '@/lib/autopilot/topics';
import {
  produireUnMontage, sujetsRecents, creneauxExistants, COST_PER_VIDEO,
} from '@/lib/autopilot/produire';
import {
  lancerJumeauMontage, creneauxJumeauEnAttente, finaliserJumeauxPrets,
} from '@/lib/autopilot/jumeau-async';

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
 * ⚠️ LE MONTAGE LUI-MEME — rush, affiche, voix, design, rendu, depot, debit —
 * vit dans `lib/autopilot/produire.ts` (`produireUnMontage`), partage avec
 * « Produire un brouillon maintenant ». Ce fichier garde ce qui est propre
 * au CYCLE : la decision, les sujets, les creneaux, les doublons, le retrait
 * des rushes morts, l'avance de cadence. `COST_PER_VIDEO` (tarif « reel »,
 * `getVideoRenderCost('reel')`) vient du meme module : un seul prix, borne le
 * cycle ET debite.
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

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Où l'utilisateur va regler ce qui bloque. */
const LIEN_AUTOPILOTE = '/dashboard/creer?panneau=autopilote';

/** Ce qu'on annonce, par cause. Un seul texte pour la cloche ET pour l'email. */
const MESSAGES: Partial<Record<SkipReason, {
  kind: string;
  subject: string;
  title: string;
  body: string;
}>> = {
  credits: {
    kind: NOTIFICATION_KINDS.autopiloteCredits,
    subject: 'Autopilote en pause — crédits insuffisants',
    title: 'Autopilote en pause : crédits insuffisants',
    body: 'Votre solde est descendu au seuil que vous avez fixé. '
      + 'Rechargez vos crédits ou abaissez le seuil pour qu’il reprenne.',
  },
  'sans-rush': {
    kind: NOTIFICATION_KINDS.autopiloteSansRush,
    subject: 'Autopilote en attente — ajoutez des rushes',
    title: 'Autopilote en pause : ajoutez des rushes',
    body: 'Votre Autopilote est actif mais sa banque de rushes est vide. '
      + 'Ajoutez-y au moins une vidéo pour qu’il puisse produire.',
  },
};

/**
 * Previent l'utilisateur — dans l'application ET par email.
 *
 * ⚠️ L'ANTI-DOUBLON EST CE QUI REND CETTE FONCTION UTILISABLE, et il corrige
 * un defaut qui existait deja. Le declencheur passe TOUTES LES HEURES, et
 * `decideRun` rend `sans-rush` AVANT le test d'heure de depart : un compte a
 * la banque vide recevait donc VINGT-QUATRE emails par jour. L'email ne part
 * plus que quand la notification a reellement ete creee — une seule decision,
 * un seul anti-doublon. Deux conditions paralleles auraient fini par ne plus
 * dire la meme chose.
 *
 * L'email reste best-effort et vient EN PLUS de la cloche : tous les
 * utilisateurs ne rouvrent pas l'application tous les jours.
 */
async function prevenir(
  userId: string,
  email: string | null | undefined,
  reason: SkipReason,
): Promise<void> {
  const m = MESSAGES[reason];
  if (!m) return;
  const { created } = await notifyOnce({
    userId,
    kind: m.kind,
    title: m.title,
    body: m.body,
    href: LIEN_AUTOPILOTE,
  });
  if (!created || !email) return;
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
  /** Rushes introuvables au stockage, retires de la banque. */
  rushesRetires?: number;
  saute?: SkipReason;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const rapport: RapportUtilisateur[] = [];

  // ── D'ABORD : finaliser les montages dont le jumeau est prêt ─────────────
  // Une génération D-ID lancée à une passe précédente a pu se terminer : on
  // rend ces montages maintenant (borné, pour tenir dans le budget de 300 s).
  // Best-effort — un échec ici n'emporte pas le reste du cycle.
  try {
    const fin = await finaliserJumeauxPrets({ max: 3 });
    if (fin.examines > 0) {
      console.log(`[Autopilote/Cron] jumeaux : ${fin.rendus} rendu(s), ${fin.encore} en cours, ${fin.echecs} échec(s)`);
    }
  } catch (e) {
    console.error('[Autopilote/Cron] finalisation des jumeaux :', e instanceof Error ? e.message : e);
  }

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
        topics: ligne.topics,
        runHour: ligne.run_hour,
        runTimezone: ligne.run_timezone,
        // Heure de PUBLICATION des posts produits, minutes comprises.
        // Colonne absente tant que la migration du 21 septembre n'est pas
        // appliquee : `sanitizeConfig` retombe sur 18:00, l'ancienne valeur
        // en dur.
        publishTime: ligne.publish_time,
        lastRunAt: ligne.last_run_at,
        lastRushUrl: ligne.last_rush_url,
        voiceEnabled: ligne.voice_enabled,
        // ── L'identite CONSTANTE du compte ────────────────────────────
        // Colonnes absentes tant que la migration du 7 aout n'est pas
        // appliquee : `sanitizeConfig` retombe alors sur les defauts, qui
        // sont les valeurs jusqu'ici en dur dans `buildAutopilotDesign`.
        cardGradientStart: ligne.card_gradient_start,
        cardGradientEnd: ligne.card_gradient_end,
        titleColor: ligne.title_color,
        cardsShowPoster: ligne.cards_show_poster,
        musicUrl: ligne.music_url,
        voiceId: ligne.voice_id,
        keepRushAudio: ligne.keep_rush_audio,
        musicVolume: ligne.music_volume,
        voiceVolume: ligne.voice_volume,
        rushVolume: ligne.rush_volume,
        // Police, taille, positions et icones — regles sur l'apercu, herites
        // par toutes les videos. Colonne absente : `sanitizeDesignStyle` rend
        // `{}` et le montage garde les defauts du Mode simple.
        designStyle: ligne.design_style,
        // Affiches de l'utilisateur. Colonnes absentes : `sanitizeConfig`
        // rend `[]` et `'auto'`, donc la recherche par theme — le
        // comportement d'avant.
        posterUrls: ligne.poster_urls,
        posterMode: ligne.poster_mode,
        // Le brief recurrent — objectif, message, public, CTA — transmis a
        // la narration de chaque montage (`voiceTexts`). Colonne absente
        // tant que `2026-09-21-autopilot-brief.sql` n'est pas appliquee :
        // `sanitizeBrief` rend `{}`, les textes sont ceux d'avant.
        brief: ligne.brief,
      });

      const credits = await getUserCredits(userId).catch(() => 0);
      const decision = decideRun({ config, credits, costPerVideo: COST_PER_VIDEO, now });

      if (!decision.run) {
        // « pas encore » est le cas NORMAL entre deux cycles : on ne
        // previent que sur ce que l'utilisateur peut lever.
        if (decision.reason === 'credits' || decision.reason === 'sans-rush') {
          const { data: u } = await supabaseAdmin
            .from('users').select('email').eq('id', userId).limit(1);
          await prevenir(userId, (u?.[0] as { email?: string } | undefined)?.email, decision.reason);
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
        // Les themes choisis par l'utilisateur, ou tous s'il n'a rien choisi.
        pool: config.topics.length ? config.topics : undefined,
      });
      console.log(`[Autopilote/Cron] ${userId} — sujets : ${topics.join(', ')}`);

      const posts = preparePosts({ config, topic: topics, count: decision.count, now });
      const dejaFaits = await creneauxExistants(userId);
      // Les créneaux déjà EN FILE pour leur jumeau comptent comme faits : sans
      // ça, chaque passe du cron relancerait une génération d'avatar (facturée)
      // tant que la précédente n'a pas fini de rendre.
      if (config.jumeauAvatar) {
        for (const s of await creneauxJumeauEnAttente(userId)) dejaFaits.add(s);
      }

      let reussis = 0;
      let echecs = 0;
      let doublons = 0;
      let dernierRush = config.lastRushUrl;
      /**
       * Derniere affiche piochee dans la banque de l'utilisateur.
       *
       * Locale au cycle, et non persistee : `autopilot_config` memorise deja
       * le dernier RUSH, et ajouter une colonne pour l'affiche demanderait
       * une migration de plus pour un gain marginal — dans un cycle, la
       * rotation suffit a ne pas repeter deux vidéos d'affilee.
       */
      let dernierePosterUrl: string | null = null;
      /**
       * Rushes reference dans la banque mais introuvables au stockage.
       *
       * ⚠️ ILS SONT RETIRES A LA FIN DU CYCLE, PAS SUR PLACE. Modifier
       * `rush_urls` en pleine boucle ferait diverger la banque de celle qui a
       * servi a repartir les montages (`preparePosts` a deja pioche), et la
       * rotation du cycle suivant repartirait d'un etat que personne n'a
       * calcule. On collecte, on retire une fois, a la fin.
       */
      const rushesMorts = new Set<string>();

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
          // ── JUMEAU : on LANCE, on ne rend pas ici ──────────────────────
          // La génération D-ID prend des minutes, la requête est bornée à
          // 300 s : on met le montage en file (`lancerJumeauMontage`), le
          // finaliseur le rendra à une passe suivante, dès la vidéo prête.
          // `jobId` DÉTERMINISTE par créneau : le débit du rendu (plus tard)
          // reste idempotent.
          if (config.jumeauAvatar) {
            const jobId = `autopilote-${userId}-${post.scheduledDate}-${post.scheduledTime.replace(':', '')}`;
            const lancement = await lancerJumeauMontage({
              userId, config, post, rang: posts.indexOf(post), now, jobId, slotKey: jeton,
              journal: '[Autopilote/Cron]',
            });
            if (!lancement.ok) {
              echecs += 1;
              console.error(`[Autopilote/Cron] ${userId} — jumeau non lancé (${lancement.motif}) : ${lancement.message}`);
            } else {
              dejaFaits.add(jeton);
              reussis += 1; // lancé : le finaliseur montera
            }
            continue;
          }

          // Tout le montage — rush encore present ?, affiche (banque de
          // l'utilisateur AVANT Pexels), voix si demandee, design, rendu
          // Remotion, depot du post, debit idempotent par `jobId` — vit dans
          // `produireUnMontage`, partage avec la production manuelle. Le
          // statut suit `config.mode`, les reseaux suivent `post.platforms` :
          // rien n'est force ici.
          const jobId = `autopilote-${userId}-${post.scheduledDate}-${Date.now()}`;
          const rendu = await produireUnMontage({
            userId, config, post, rang: posts.indexOf(post), now, jobId,
            dernierePosterUrl,
            journal: '[Autopilote/Cron]',
            // Un rush mort est mis de cote DES sa detection, meme si le rendu
            // echoue ensuite : l'adresse est retiree de la banque a la fin
            // du cycle.
            onRushMort: (url) => { rushesMorts.add(url); },
            onAfficheCustom: (url) => { dernierePosterUrl = url; },
          });
          const { rushUrl } = rendu;

          dejaFaits.add(jeton);
          dernierRush = rushUrl ?? dernierRush;
          reussis += 1;
        } catch (err) {
          echecs += 1;
          console.error(
            `[Autopilote/Cron] ${userId} — montage ${post.scheduledDate} echoue :`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // ── Rushes introuvables : on retire, et on le DIT ──────────────────
      // Laisser une adresse morte dans la banque ferait retomber dessus a
      // chaque cycle, et l'utilisateur verrait des montages amputes de leur
      // sequence video sans jamais savoir pourquoi.
      const banquePropre = config.rushUrls.filter((u) => !rushesMorts.has(u));
      if (rushesMorts.size > 0) {
        const { error: nettoyageError } = await supabaseAdmin
          .from('autopilot_config')
          .update({ rush_urls: banquePropre, updated_at: new Date(now).toISOString() })
          .eq('user_id', userId);
        if (nettoyageError) {
          console.error(
            `[Autopilote/Cron] ${userId} — retrait des rushes morts impossible :`,
            nettoyageError.message,
          );
        }
        const { data: u } = await supabaseAdmin
          .from('users').select('email').eq('id', userId).limit(1);
        const email = (u?.[0] as { email?: string } | undefined)?.email;
        const n = rushesMorts.size;
        const { created } = await notifyOnce({
          userId,
          kind: NOTIFICATION_KINDS.autopiloteRushIntrouvable,
          title: `${n} rush${n > 1 ? 'es' : ''} introuvable${n > 1 ? 's' : ''}`,
          body: banquePropre.length === 0
            ? 'Votre banque est maintenant vide : ajoutez au moins une vidéo pour que l’Autopilote reprenne.'
            : `${n} vidéo${n > 1 ? 's ont' : ' a'} disparu du stockage et ${n > 1 ? 'ont' : 'a'} été retirée${n > 1 ? 's' : ''} de votre banque.`,
          href: LIEN_AUTOPILOTE,
        });
        if (created && email) {
          sendEmailSilent({
            to: email,
            subject: 'Autopilote — des rushes ont disparu',
            html: `<p>${n} vidéo${n > 1 ? 's de votre banque de rushes ne sont plus disponibles et ont' : ' de votre banque de rushes n’est plus disponible et a'} été retirée${n > 1 ? 's' : ''}.`
              + (banquePropre.length === 0
                ? ' Votre banque est maintenant vide : l’Autopilote ne produira plus tant que vous n’aurez pas ajouté une vidéo.</p>'
                : '</p>'),
          });
        }
        console.warn(
          `[Autopilote/Cron] ${userId} — ${n} rush(es) retire(s) de la banque `
          + `(${banquePropre.length} restant(s))`,
        );
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
            // suivant. Un rush dont le rendu a echoue ne compte pas — et un
            // rush retire de la banque non plus, sinon `pickRush` repartirait
            // d'un `indexOf` a -1, donc toujours du premier.
            last_rush_url: dernierRush && !rushesMorts.has(dernierRush) ? dernierRush : null,
            updated_at: new Date(now).toISOString(),
          })
          .eq('user_id', userId);
      }

      rapport.push({
        userId,
        prepares: reussis,
        ...(echecs ? { echecs } : null),
        ...(doublons ? { doublons } : null),
        ...(rushesMorts.size ? { rushesRetires: rushesMorts.size } : null),
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
