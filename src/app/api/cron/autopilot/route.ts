import { NextRequest, NextResponse } from 'next/server';
import type { PlagesUtilisees } from '@/lib/creer/smart-montage';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits } from '@/lib/credits/system';
import { sendEmailSilent } from '@/lib/email/resend';
import { sanitizeConfig, decideRun, type SkipReason } from '@/lib/autopilot/rules';
import { avatarActifConfig } from '@/lib/autopilot/sources';
import { preparePosts, slotKey } from '@/lib/autopilot/engine';
import { notifyOnce, NOTIFICATION_KINDS } from '@/lib/notifications/store';
import { pickTopics } from '@/lib/autopilot/topics';
import { prixDe } from '@/lib/tarifs/serveur';
import {
  produireUnMontage, sujetsRecents, creneauxExistants, coutMontage, coutAfficheDuDevis,
} from '@/lib/autopilot/produire';
import {
  lancerJumeauMontage, creneauxJumeauEnAttente, finaliserJumeauxPrets,
} from '@/lib/autopilot/jumeau-async';
import { doitPasserLeRush, rushReussi } from '@/lib/autopilot/echec-rush';

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
 * des rushes morts, l'avance de cadence. `coutMontage()` (tarif « reel » de
 * la grille centrale) vient du meme module : lu une fois par compte, il borne
 * le cycle ET il est transmis a `produireUnMontage`, qui debite ce nombre.
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

/**
 * Famille de notification « montage(s) non produit(s) ».
 *
 * Ecrite ici plutot que dans `NOTIFICATION_KINDS` : `notifyOnce` accepte une
 * chaine libre, et l'anti-doublon (une par jour) porte sur cette valeur.
 */
const KIND_AUTOPILOTE_ECHEC = 'autopilote-echec';

/**
 * Le texte d'un cycle rate — une seule source pour la cloche ET l'email.
 *
 * ⚠️ IL NE PROMET QUE CE QUI EST VRAI. `produireUnMontage` leve AVANT tout
 * debit, et un jumeau non lance n'est pas facture : « aucun credit » est
 * exact. « Nouvel essai au prochain passage » ne l'est que si RIEN n'a ete
 * produit — c'est alors seulement que `last_run_at` n'avance pas.
 */
function messageEchec(echecs: number, reussis: number): { title: string; body: string } {
  const pluriel = echecs > 1;
  return {
    title: `Autopilote : ${echecs} montage${pluriel ? 's' : ''} non produit${pluriel ? 's' : ''}`,
    body: `${pluriel ? 'Des montages n’ont' : 'Un montage n’a'} pas pu être rendu. Aucun crédit n’a été débité pour ${pluriel ? 'eux' : 'lui'}. `
      + (reussis > 0
        ? 'Les autres montages sont dans votre Calendrier. '
        : 'L’Autopilote réessaiera au prochain passage, avec le rush suivant de votre banque. ')
      + 'Vous pouvez aussi « Produire un brouillon maintenant ».',
  };
}

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
        // Date de début. ⚠️ ELLE MANQUAIT ICI : « Produire maintenant » la
        // lisait (`configDepuisLigne`), pas le cron — qui produisait donc
        // avant la date choisie et datait les posts de « demain ».
        startDate: ligne.start_date,
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
        // ── Le JUMEAU à l'image — choix EXPLICITE de l'utilisateur ────────
        // ⚠️ IL MANQUAIT ICI, et c'était tout le problème : `sanitizeConfig`
        // retombait sur `false`, si bien qu'un compte ayant coché « Monter la
        // vidéo de mon jumeau » était traité comme s'il ne l'avait pas fait —
        // la branche `lancerJumeauMontage` ci-dessous n'était jamais prise.
        // Colonne `not null default false` : aucun compte ne bascule sans
        // l'avoir coché, et `=== true` dans `sanitizeConfig` rejette tout le
        // reste.
        jumeauAvatar: ligne.jumeau_avatar,
        // Identité LOGIQUE choisie ; colonne absente avant la migration → défaut.
        jumeauAvatarId: ligne.avatar_id,
      });

      // Avec le jumeau, un montage coûte DEUX choses : la génération de
      // l'avatar (débitée à son lancement) PUIS le rendu (à la finalisation).
      // Le nombre de montages du cycle est borné par ce que le solde paie
      // réellement — même calcul que « Produire maintenant ». Et le jumeau
      // tient la séquence « Vidéo » : une banque de rushes vide ne bloque pas.
      const coutRendu = await coutMontage();
      const coutParMontage = (avatarActifConfig(config) ? (await prixDe('avatar.jumeau')) + coutRendu : coutRendu)
        + await coutAfficheDuDevis(config);
      const credits = await getUserCredits(userId).catch(() => 0);
      const decision = decideRun({
        config, credits, costPerVideo: coutParMontage, now, allowWithoutRush: avatarActifConfig(config),
      });

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
      if (avatarActifConfig(config)) {
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
      /** Plages de rushes déjà montées dans CE cycle (smart montage). */
      const plagesCycle: PlagesUtilisees = {};
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
        // `jobId` DÉTERMINISTE par créneau, jumeau ou non. Il nomme les
        // fichiers ET les références de débit (`autopilote:<jobId>`,
        // `autopilote-affiche:<jobId>`) : un créneau rejoué après un rendu
        // raté réécrit les mêmes fichiers et ne peut pas être débité deux
        // fois. Il portait `Date.now()` : chaque rejeu était un job neuf.
        const jobId = `autopilote-${userId}-${post.scheduledDate}-${post.scheduledTime.replace(':', '')}`;

        try {
          // ── JUMEAU : on LANCE, on ne rend pas ici ──────────────────────
          // La génération D-ID prend des minutes, la requête est bornée à
          // 300 s : on met le montage en file (`lancerJumeauMontage`), le
          // finaliseur le rendra à une passe suivante, dès la vidéo prête.
          if (avatarActifConfig(config)) {
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
          const rendu = await produireUnMontage({
            userId, config, post, rang: posts.indexOf(post), now, jobId,
            dernierePosterUrl,
            journal: '[Autopilote/Cron]',
            coutRendu,
            // Un rush mort est mis de cote DES sa detection, meme si le rendu
            // echoue ensuite : l'adresse est retiree de la banque a la fin
            // du cycle.
            onRushMort: (url) => { rushesMorts.add(url); },
            onAfficheCustom: (url) => { dernierePosterUrl = url; },
            // Smart montage : les extraits déjà montés dans ce cycle sont
            // évités par les vidéos suivantes (tant qu'il reste mieux).
            plagesCycle,
          });
          const { rushUrl } = rendu;

          dejaFaits.add(jeton);
          dernierRush = rushUrl ?? dernierRush;
          rushReussi(userId, rushUrl);
          reussis += 1;
        } catch (err) {
          echecs += 1;
          const message = err instanceof Error ? err.message : String(err);
          // ⚠️ LA ROTATION N'AVANCE SUR UN ECHEC QUE SI LE RUSH EN EST LA
          // CAUSE. Sans avancer jamais, un rush qui fait echouer le rendu
          // (fichier corrompu, codec refuse) etait repris a CHAQUE passage :
          // Autopilote bloque a vie. En avancant toujours, un crash passager
          // (Chromium, televersement, insertion) sautait un rush valide.
          // Critere (`lib/autopilot/echec-rush.ts`) : erreur qui accuse le
          // rush, OU trop d'echecs consecutifs sur lui. Sinon : transitoire,
          // rotation inchangee, meme rush au prochain essai.
          //
          // Un rush MORT (404) n'est jamais note : il est retire de la banque
          // en fin de cycle, et le noter ferait repartir `pickRush` du debut
          // (`indexOf` a -1). Le montage a alors ete tente SANS rush : son
          // echec n'est pas celui du rush.
          if (post.rushUrl && !rushesMorts.has(post.rushUrl)
            && doitPasserLeRush({ userId, rushUrl: post.rushUrl, message })) {
            dernierRush = post.rushUrl;
          }
          console.error(
            `[Autopilote/Cron] ${userId} — montage ${post.scheduledDate} echoue :`,
            message,
          );
        }
      }

      // ── Rushes introuvables : on retire, et on le DIT ──────────────────
      // Laisser une adresse morte dans la banque ferait retomber dessus a
      // chaque cycle, et l'utilisateur verrait des montages amputes de leur
      // sequence video sans jamais savoir pourquoi.
      let banquePropre = config.rushUrls.filter((u) => !rushesMorts.has(u));
      if (rushesMorts.size > 0) {
        // ⚠️ RELUE MAINTENANT, PAS AU DEBUT DU CYCLE. Entre les deux, plusieurs
        // rendus de quelques minutes : un rush ajoute par l'utilisateur
        // pendant ce temps etait EFFACE par l'ecriture de la banque lue au
        // depart. Lecture impossible : la banque du debut, comme avant.
        const { data: actuelle, error: relectureError } = await supabaseAdmin
          .from('autopilot_config')
          .select('rush_urls')
          .eq('user_id', userId)
          .limit(1);
        const relue = (actuelle?.[0] as { rush_urls?: unknown } | undefined)?.rush_urls;
        if (!relectureError && Array.isArray(relue)) {
          banquePropre = relue.filter((u): u is string => typeof u === 'string' && !rushesMorts.has(u));
        }
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
      //
      // `last_rush_url`, lui, avance sur un succes, ou sur un echec IMPUTABLE
      // au rush (voir le `catch` ci-dessus) : sans ca, un cycle entierement
      // rate sur un rush illisible repartait du meme rush, indefiniment.
      // Un rush retire de la banque n'est jamais ecrit, sinon `pickRush`
      // repartirait d'un `indexOf` a -1, donc toujours du premier : c'est
      // alors l'ancienne valeur qui reste.
      const rushAEcrire = dernierRush && !rushesMorts.has(dernierRush) ? dernierRush : null;
      if (reussis > 0 || rushAEcrire !== config.lastRushUrl) {
        await supabaseAdmin
          .from('autopilot_config')
          .update({
            ...(reussis > 0 ? { last_run_at: new Date(now).toISOString() } : null),
            last_rush_url: rushAEcrire,
            updated_at: new Date(now).toISOString(),
          })
          .eq('user_id', userId);
      }

      // ── Un montage rate se DIT ─────────────────────────────────────────
      // Il n'etait ecrit que dans les journaux du serveur : l'utilisateur
      // voyait un Calendrier vide sans savoir pourquoi. Une notification par
      // jour au plus (anti-doublon de `notifyOnce`), email best-effort
      // seulement si elle a ete creee. Jamais bloquant pour le cycle.
      if (echecs > 0) {
        try {
          const m = messageEchec(echecs, reussis);
          const { created } = await notifyOnce({
            userId, kind: KIND_AUTOPILOTE_ECHEC, title: m.title, body: m.body, href: LIEN_AUTOPILOTE,
          });
          if (created) {
            const { data: u } = await supabaseAdmin
              .from('users').select('email').eq('id', userId).limit(1);
            const email = (u?.[0] as { email?: string } | undefined)?.email;
            if (email) sendEmailSilent({ to: email, subject: m.title, html: `<p>${m.body}</p>` });
          }
        } catch (e) {
          console.error(`[Autopilote/Cron] ${userId} — notification d'echec impossible :`, e instanceof Error ? e.message : e);
        }
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
