import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { moteurDepuisConfig, repliDepuisConfig } from '@/lib/autopilot/automatique/contrat';
import {
  nouveauJeton, reclamerCreneau, conclureCreneau,
} from '@/lib/autopilot/automatique/creneau';
import { choisirRushMontable } from '@/lib/autopilot/automatique/rush-banque';
import { monterAvecM3 } from '@/lib/autopilot/automatique/chaine-serveur';
import { montageDepuisStyle, audioDepuisStyle } from '@/lib/autopilot/textStyle';
import { formatValide } from '@/lib/autopilot/analyse/montage-contrat';
import { getUserCredits } from '@/lib/credits/system';
import { sendEmailSilent } from '@/lib/email/resend';
import { sanitizeConfig, decideRun, type SkipReason } from '@/lib/autopilot/rules';
import { preparePosts, toPostRow, slotKey } from '@/lib/autopilot/engine';
import { buildAutopilotDesign, buildAutopilotMetadata, AUTOPILOT_FORMAT } from '@/lib/autopilot/design';
import { renderAndUpload } from '@/lib/autopilot/render';
import {
  pickPosterUrl, pickCustomPoster, probeRushSeconds, rushEncorePresent,
} from '@/lib/autopilot/poster';
import { notifyOnce, NOTIFICATION_KINDS } from '@/lib/notifications/store';
import { buildAutopilotVoices } from '@/lib/autopilot/voice';
import { pickTopics } from '@/lib/autopilot/topics';
import { deductCredits, getVideoRenderCost } from '@/lib/credits/system';
import { referenceOperation } from '@/lib/credits/atomique';

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
        topics: ligne.topics,
        runHour: ligne.run_hour,
        runTimezone: ligne.run_timezone,
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
    /* Les rushes deja montes par M3 dans CE cycle : sans eux, deux montages
       du meme cycle repartiraient du meme rush et se ressembleraient. */
    const rushesM3Utilises = new Set<string>();
    let m3Reussis = 0; let m3Ignores = 0; let m3Echecs = 0;

      for (const post of posts) {
        const jeton = slotKey(userId, post.scheduledDate, post.scheduledTime);
        if (dejaFaits.has(jeton)) {
          // Creneau deja produit : ni rendu, ni credit, ni post.
          doublons += 1;
          continue;
        }

        /* ══ LE VERROU, AVANT LA PREMIERE DEPENSE ═══════════════════════
           ⚠️ `dejaFaits` CI-DESSUS N'EST PAS UN VERROU — c'est une lecture,
           faite une fois par compte, comparee en JavaScript. Deux crons qui
           se croisent y lisent tous les deux « creneau libre », puis
           analysent tous les deux, appellent Sonnet tous les deux, encodent
           tous les deux et debitent tous les deux. Il reste utile comme
           raccourci (il evite un aller-retour), mais la SECURITE vient
           d'ici : la base tranche, en une instruction.

           Et le verrou est pris ICI, avant l'aiguillage : le placer plus bas
           laisserait le doublon payer l'analyse avant de decouvrir qu'il
           n'avait pas la main. */
        const jetonCreneau = nouveauJeton();
        const creneau = await reclamerCreneau(userId, jeton, jetonCreneau);
        if (creneau.issue !== 'reclame') {
          /* Aucun de ces cas n'est une erreur : un autre worker travaille, ou
             a deja fini. Compter cela comme un echec ferait sonner une alarme
             a chaque cycle sur une installation a plusieurs workers. */
          if (creneau.issue === 'deja_terminee') dejaFaits.add(jeton);
          doublons += 1;
          if (creneau.issue === 'socle_absent') {
            /* ⚠️ ON NE PRODUIT PAS SANS VERROU. Tant que la migration n'est
               pas appliquee, produire quand meme reintroduirait exactement le
               defaut que ce lot ferme — en silence, et le jour du
               deploiement. */
            console.warn('[autopilote][creneau] verrou indisponible : cycle ignore');
          }
          continue;
        }

        // ── Un montage, isole ────────────────────────────────────────────
        // Chromium peut refuser de demarrer, un rush etre illisible, un
        // televersement echouer. Rien de tout cela ne doit emporter le reste
        // du cycle.
        let creneauConclu = false;
        try {
          /* ══ L'AIGUILLAGE DES DEUX MOTEURS ══════════════════════════════
             ⚠️ ICI, ET PAS AILLEURS. A cet instant tout ce qui dit QUOI
             produire est connu — `post`, `config`, `userId`, `jeton` — et
             rien n'a encore ete fabrique. C'est la seule frontiere ou l'on
             peut changer de moteur sans dupliquer une decision.

             Le defaut est `legacy_template` : un compte qui n'a rien demande
             recoit exactement ce qu'il recevait hier. */
          if (moteurDepuisConfig(config.designStyle) === 'm3') {
            const montage = montageDepuisStyle(config.designStyle);
            const choix = await choisirRushMontable(userId, rushesM3Utilises);
            /* ⚠️ LE FORMAT EST UNE CHAINE LIBRE COTE REGLAGES, et le contrat
               du moteur n'en accepte que trois. On le VALIDE au lieu de le
               forcer : un `as` ferait entrer « portrait » dans un vocabulaire
               ferme, et l'erreur ressortirait au rendu, trois minutes plus
               loin, sous un motif qui ne dirait pas ca. */
            const issue = choix === null
              ? { sorte: 'ignore' as const, motif: 'aucun_rush_analyse' as const }
              : !formatValide(montage.format)
                ? { sorte: 'echec' as const, motif: 'plan_impossible' as const,
                  detail: 'format inconnu' }
                : await monterAvecM3({
                userId,
                  rushId: choix.rushId,
                  analysisId: choix.analysisId,
                  candidateSetId: choix.candidateSetId,
                  format: montage.format,
                  dureeCibleSecondes: montage.dureeSecondes,
                  // La MEME recette que le parcours manuel : musique,
                  // volumes, son du rush, et la coupe du blanc initial.
                  recette: audioDepuisStyle(config.designStyle),
                });

            if (issue.sorte === 'reussi') {
              rushesM3Utilises.add(issue.rushId);
              const videoUrl = `/api/autopilot/rendus-montage/${issue.renduId}/fichier`;
              const { error: erreurM3 } = await supabaseAdmin
                .from('scheduled_posts')
                .insert(toPostRow({
                  userId, post, config, videoUrl,
                  metadata: {
                    source: 'autopilote',
                    /* ⚠️ LE MOTEUR EST ECRIT DANS LE POST. Sans lui, on ne
                       pourrait plus dire d'ou vient une video — et comparer
                       les deux moteurs est TOUT l'interet de cette
                       passerelle. */
                    moteur: 'm3',
                    slotKey: jeton,
                    renduId: issue.renduId,
                    montagePlanId: issue.planId,
                    rushId: issue.rushId,
                    videoUrl,
                    dureeSecondes: issue.dureeSecondes,
                    pendingRender: false,
                    serverRendered: true,
                  },
                }));
              if (erreurM3) throw new Error(`insertion du post M3 : ${erreurM3.message}`);
              dejaFaits.add(jeton);
              reussis += 1;
              m3Reussis += 1;
              await conclureCreneau(userId, jeton, jetonCreneau, 'terminee',
                { renduId: issue.renduId });
              creneauConclu = true;
              try {
                await deductCredits(userId, COST_PER_VIDEO, 'render',
                  referenceOperation('autopilote', `m3-${issue.renduId}`));
              } catch (err) {
                console.error('[autopilote][m3] debit impossible', err);
              }
              continue;
            }

            /* ⚠️ AUCUN REPLI SILENCIEUX. Retomber sur le gabarit sans le dire
               produirait des videos d'un moteur en croyant les avoir de
               l'autre, et rendrait la comparaison impossible. Le repli est un
               CHOIX explicite, et il ne couvre que « ignore » — un echec
               reste un echec, on ne le maquille pas en video. */
            if (issue.sorte === 'echec') {
              m3Echecs += 1;
              console.warn(`[autopilote][m3] echec ${issue.motif} user=${userId}`);
              echecs += 1;
              continue;
            }
            m3Ignores += 1;
            if (repliDepuisConfig(config.designStyle) !== 'template_si_ignore') continue;
          }

          // ── Le rush existe-t-il encore ? ───────────────────────────────
          // Un rush supprime — retention du stockage, menage de
          // l'utilisateur — reste ecrit dans `rush_urls`. Sans ce controle,
          // le rendu echoue trois minutes plus tard sur une erreur de
          // Chromium, et l'adresse morte ressort au cycle suivant. Le rush
          // est LACHE pour ce montage (qui sort en titre/cartes/CTA, un
          // montage valide) et l'adresse est mise de cote pour etre retiree.
          let rushUrl = post.rushUrl;
          if (rushUrl && !(await rushEncorePresent(rushUrl))) {
            console.warn(`[Autopilote/Cron] ${userId} — rush introuvable, ignore : ${rushUrl}`);
            rushesMorts.add(rushUrl);
            rushUrl = null;
          }
          const postUtilise = rushUrl === post.rushUrl ? post : { ...post, rushUrl };

          // Les deux sondages RESEAU, avant la fabrique de design qui reste
          // pure. Aucun des deux ne peut faire echouer le cycle : ils rendent
          // `null` et le montage sort comme avant.
          // ⚠️ LA BANQUE DE L'UTILISATEUR PASSE AVANT PEXELS — mais SEULEMENT
          // si elle contient quelque chose. Un mode « mes photos » sur une
          // banque vide retomberait sinon sur un montage sans affiche, alors
          // que la recherche par theme, elle, en produit toujours une.
          const rang = posts.indexOf(post);
          const afficheCustom: string | null = config.posterMode === 'custom' && config.posterUrls.length > 0
            ? pickCustomPoster(config.posterUrls, dernierePosterUrl, rang)
            : null;
          const [posterUrl, rushSeconds] = await Promise.all([
            // La variante fait tourner le tirage : deux montages du meme
            // theme n'ont pas la meme affiche.
            afficheCustom
              ? Promise.resolve(afficheCustom)
              : pickPosterUrl(post.title, rang + Math.floor(now / 3_600_000)),
            rushUrl ? probeRushSeconds(rushUrl) : Promise.resolve(null),
          ]);
          if (afficheCustom) dernierePosterUrl = afficheCustom;
          const jobId = `autopilote-${userId}-${post.scheduledDate}-${Date.now()}`;
          // La voix AVANT le design : ce sont ses durees qui calent les
          // sequences. Un echec de TTS rend `{}` et le montage sort muet.
          //
          // ⚠️ ET SEULEMENT SI ELLE A ETE DEMANDEE. ElevenLabs facture a
          // l'usage : sans ce garde, chaque montage declencherait quatre
          // syntheses payantes chez des utilisateurs qui n'ont rien demande.
          //
          // La voix CLONEE du compte, la meme sur toutes les sequences de
          // toutes les videos : c'est le point de l'identite constante. Sans
          // choix, la voix par defaut du serveur.
          const voices = config.voiceEnabled
            ? await buildAutopilotVoices({ userId, jobId, post: postUtilise, voiceId: config.voiceId })
            : {};
          // `config` porte l'identite CONSTANTE — couleurs, fond des cartes,
          // musique, niveaux du mixeur, son du rush. L'affiche, les textes et
          // le rush, eux, varient et arrivent par `post` et `posterUrl`.
          const design = buildAutopilotDesign(postUtilise, {
            posterUrl, rushSeconds, voices, config,
          });
          const { videoUrl, thumbnailUrl, durationFrames } = await renderAndUpload({ userId, jobId, design });

          const metadata = buildAutopilotMetadata({
            post: postUtilise, design, videoUrl, thumbnailUrl, mode: config.mode,
          });
          const { error: insertError } = await supabaseAdmin
            .from('scheduled_posts')
            .insert(toPostRow({ userId, post: postUtilise, config, videoUrl, metadata }));
          if (insertError) throw new Error(`insertion du post : ${insertError.message}`);
          await conclureCreneau(userId, jeton, jetonCreneau, 'terminee');
          creneauConclu = true;

          // Debit APRES coup, comme le chemin manuel : la video est en ligne
          // et le post existe. Debiter avant ferait payer un rendu qui peut
          // encore echouer.
          try {
            // Reference stable : le `jobId` de l'autopilote. Une relance du
            // cron sur le meme job ne debite pas une seconde fois — c'est
            // exactement le cas que l'ancien debit non idempotent laissait
            // passer, et un cron se relance.
            await deductCredits(
              userId, COST_PER_VIDEO, 'render',
              referenceOperation('autopilote', jobId),
            );
          } catch (e) {
            // Le montage est livre : on ne le retire pas pour un debit
            // manque. On le dit fort, c'est tout.
            console.error(
              `[Autopilote/Cron] debit manque pour ${userId} (${COST_PER_VIDEO} credits) :`,
              e instanceof Error ? e.message : e,
            );
          }

          dejaFaits.add(jeton);
          dernierRush = rushUrl ?? dernierRush;
          reussis += 1;
          console.log(
            `[Autopilote/Cron] ${userId} — montage ${post.scheduledDate} rendu `
            + `(${durationFrames} images, ${AUTOPILOT_FORMAT}`
            + `, affiche ${posterUrl ? 'oui' : 'non'}`
            + `, cartes ${config.cardsShowPoster ? 'sur affiche' : 'sur couleurs'}`
            + `, rush ${rushSeconds ? `${rushSeconds.toFixed(1)}s` : 'non sonde'}`
            + `, son du rush ${config.keepRushAudio ? `${Math.round(config.rushVolume * 100)}%` : 'coupe'}`
            + `, musique ${config.musicUrl ? `${Math.round(config.musicVolume * 100)}%` : 'aucune'}`
            + `, voix ${config.voiceEnabled ? `${Object.keys(voices).length}/4` : 'desactivee'}`
            + `) : ${videoUrl}`,
          );
        } catch (err) {
          echecs += 1;
          console.error(
            `[Autopilote/Cron] ${userId} — montage ${post.scheduledDate} echoue :`,
            err instanceof Error ? err.message : err,
          );
        } finally {
          /* ⚠️ LE CRENEAU EST TOUJOURS RENDU, QUEL QUE SOIT LE CHEMIN.
             Sans ce `finally`, un `continue` du milieu — M3 qui ignore, un
             format inconnu, une exception — laisserait le creneau tenu
             jusqu'a l'expiration du bail. Il serait REPRENABLE, jamais
             perdu, mais le compte attendrait des minutes pour rien.

             « echouee » et non « terminee » : le travail n'a pas abouti, et
             le prochain cycle doit pouvoir reprendre ce creneau tout de
             suite. La trace, elle, reste — on ne supprime pas la ligne. */
          if (!creneauConclu) {
            try {
              await conclureCreneau(userId, jeton, jetonCreneau, 'echouee',
                { motifEchec: 'cycle_interrompu' });
            } catch (e) {
              console.error('[autopilote][creneau] liberation impossible',
                e instanceof Error ? e.message : e);
            }
          }
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
        /* ⚠️ CE QUE M3 A FAIT, DIT SEPAREMENT. Un cycle ou M3 ignore tout et
           ou le gabarit produit trois videos afficherait sinon « 3 prepares »
           — un rapport vrai et trompeur. Et « ignore » n'est pas « echec » :
           un compte sans rush analyse n'a rien casse, il n'a rien a monter.
           Les confondre ferait sonner une alarme a chaque cycle, et l'alarme
           finirait ignoree le jour ou quelque chose casse vraiment. */
        ...(m3Reussis ? { m3Reussis } : null),
        ...(m3Ignores ? { m3Ignores } : null),
        ...(m3Echecs ? { m3Echecs } : null),
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
