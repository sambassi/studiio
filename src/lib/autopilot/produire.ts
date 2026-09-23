import { supabaseAdmin } from '@/lib/db/supabase';
import { deductCredits, getVideoRenderCost } from '@/lib/credits/system';
import { referenceOperation } from '@/lib/credits/atomique';
import { toPostRow, slotKey, type PreparedPost } from '@/lib/autopilot/engine';
import { sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import { buildAutopilotDesign, buildAutopilotMetadata, AUTOPILOT_FORMAT } from '@/lib/autopilot/design';
import { renderAndUpload } from '@/lib/autopilot/render';
import {
  pickPosterUrl, pickCustomPoster, probeRushSeconds, rushEncorePresent,
} from '@/lib/autopilot/poster';
import { buildAutopilotVoices, type VoixParSequence } from '@/lib/autopilot/voice';
import { genererAfficheReference } from '@/lib/ai/affiche-reference';

/**
 * Coût d'une affiche générée à partir d'une photo de référence, en crédits.
 * ⚠️ LE MÊME que l'action « generate-bg » de `/api/ai/image` (5) : générer une
 * affiche coûte pareil, qu'on parte d'un texte (Créer) ou d'une photo (ici).
 */
const COST_AFFICHE_REFERENCE = 5;

/**
 * Produire UN montage d'Autopilote — la pièce commune au cron et à la
 * production manuelle.
 *
 * ⚠️ EXTRAIT DU CRON, PAS RÉÉCRIT. Ce bloc vivait dans
 * `/api/cron/autopilot` ; « Produire un brouillon maintenant » a besoin du
 * même enchaînement — rush, affiche, voix, design, rendu, dépôt, débit — et
 * une seconde copie aurait fini par diverger sur l'un des huit points. Le
 * cron garde tout ce qui est propre au CYCLE : la décision, les sujets, les
 * créneaux, les doublons, le retrait des rushes morts, l'avance de cadence.
 *
 * ⚠️ CE MODULE NE PUBLIE RIEN. Il dépose un post ; la publication est
 * l'affaire du cron de publication, et seulement pour les posts `scheduled`.
 *
 * ⚠️ IL NE DÉCIDE PAS DU STATUT. Le statut suit `config.mode`
 * (`toPostRow` → `statusForMode`) et les réseaux suivent `post.platforms` :
 * la production manuelle force les deux en amont (`review`, `[]`), le cron
 * transmet la configuration telle quelle.
 */

/**
 * Coût d'un montage, en crédits.
 *
 * L'Autopilote produit du vertical : c'est donc le tarif « reel », le même
 * que celui d'un rendu manuel. Il sert à DEUX choses — borner le nombre de
 * montages du cycle, et débiter après chaque rendu réussi. UNE constante,
 * lue par le cron ET par la production manuelle : deux lectures auraient pu
 * annoncer un prix et en débiter un autre.
 */
export const COST_PER_VIDEO = getVideoRenderCost('reel');

/**
 * `snake_case` → `camelCase`, pour relire une ligne de `autopilot_config`.
 *
 * ⚠️ TOUTES LES COLONNES SUIVENT CETTE RÈGLE — `count_per_cycle` →
 * `countPerCycle`, `publish_time` → `publishTime`, `start_date` →
 * `startDate` — et `sanitizeConfig` ignore ce qu'il ne connaît pas. Une
 * colonne ajoutée demain (et sa migration) arrive donc ici sans qu'on
 * retouche une table de correspondance : c'est ce qui évite une TROISIÈME
 * copie de la liste que le cron et la route de configuration tiennent
 * encore à la main.
 */
export function configDepuisLigne(ligne: Record<string, unknown> | null | undefined): AutopilotConfig {
  const camel: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ligne ?? {})) {
    camel[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return sanitizeConfig(camel);
}

/**
 * Sujets des derniers montages de l'Autopilote.
 *
 * Sert à ne pas reproposer un thème dont un brouillon traîne encore : deux
 * vidéos sur le même sujet dans le même Calendrier se remarquent.
 */
export async function sujetsRecents(userId: string): Promise<string[]> {
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
 * Créneaux déjà produits pour cet utilisateur.
 *
 * IDEMPOTENCE : la cadence empêche déjà deux cycles rapprochés, mais elle ne
 * protège de rien si `last_run_at` n'a pas pu être écrit APRÈS l'insertion
 * des posts — et c'est l'ordre réel des opérations. On relit donc les
 * créneaux existants avant d'insérer. Les jetons manuels (`manuel:…`) y
 * figurent aussi : une seconde production dans le même créneau est refusée
 * de la même façon.
 */
export async function creneauxExistants(userId: string): Promise<Set<string>> {
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
    // déposés avant son introduction.
    out.add(
      typeof meta.slotKey === 'string'
        ? meta.slotKey
        : slotKey(userId, String(ligne.scheduled_date ?? ''), String(ligne.scheduled_time ?? '')),
    );
  }
  return out;
}

export interface MontageProduit {
  videoUrl: string;
  thumbnailUrl: string | null;
  durationFrames: number;
  posterUrl: string | null;
  rushSeconds: number | null;
  /** Le rush RÉELLEMENT utilisé — `null` s'il a été lâché ou s'il n'y en avait pas. */
  rushUrl: string | null;
  /** Rush référencé dans la banque mais introuvable au stockage, lâché pour ce montage. */
  rushMort: string | null;
  /** L'affiche piochée dans la banque de l'utilisateur, si c'est le cas. */
  afficheCustom: string | null;
  voices: VoixParSequence;
  /** Identifiant du post déposé, quand la base le rend. */
  postId: string | null;
  /** Le débit a-t-il été enregistré ? Faux = montage livré, débit manqué (journalisé). */
  debite: boolean;
}

/**
 * Rend UN montage, le dépose, le débite.
 *
 * L'ordre est celui du chemin manuel : rendu, puis dépôt, puis débit. Débiter
 * avant ferait payer un rendu qui peut encore échouer ; et un débit manqué
 * ne retire pas un montage livré — il est dit fort, c'est tout.
 *
 * Lève sur tout échec AVANT le débit (rush illisible, Chromium, stockage,
 * insertion) : l'appelant décide ce qu'il en fait — le cron isole chaque
 * montage, la production manuelle répond une erreur.
 */
export async function produireUnMontage(input: {
  userId: string;
  config: AutopilotConfig;
  post: PreparedPost;
  /** Rang du montage dans le cycle — fait tourner l'affiche. */
  rang: number;
  now: number;
  /** Identifiant de job : nomme les fichiers, et la référence de débit. */
  jobId: string;
  /** Dernière affiche piochée dans la banque, pour ne pas la répéter. */
  dernierePosterUrl?: string | null;
  /**
   * Jeton de créneau à écrire dans les métadonnées. Absent : celui du cycle
   * (`slotKey(userId, date, heure)`), comme avant.
   */
  slotKey?: string;
  /** Métadonnées supplémentaires, fusionnées APRÈS celles du montage. */
  metadataSupplement?: Record<string, unknown>;
  /** Préfixe des journaux — `[Autopilote/Cron]`, `[Autopilote/Manuel]`. */
  journal?: string;
  /**
   * Prévenu DÈS qu'un rush est reconnu mort — avant le rendu, qui peut
   * encore échouer. Le cron retire l'adresse de la banque même si ce
   * montage-là n'aboutit pas : c'était déjà le cas, et un rendu raté ne
   * ressuscite pas un fichier absent.
   */
  onRushMort?: (url: string) => void;
  /** Prévenu dès qu'une affiche de la banque est piochée — même règle. */
  onAfficheCustom?: (url: string) => void;
  /**
   * Vidéo du JUMEAU numérique, DÉJÀ générée et re-hébergée (avatar animé sur
   * la voix clonée du compte), à monter comme séquence « Vidéo ».
   *
   * ⚠️ L'APPELANT L'A VALIDÉE. Cette valeur ne vient jamais crue du
   * navigateur : la route qui produit ce montage confirme, en base
   * (`avatar_generations`), que cette URL est bien une génération TERMINÉE
   * appartenant à ce compte, avant de la passer ici — sinon on monterait la
   * vidéo d'un autre, ou une adresse forgée.
   *
   * Présente, elle REMPLACE le rush pour ce montage : elle porte déjà la voix
   * clonée, donc aucune voix off par séquence n'est synthétisée (ni coût
   * ElevenLabs, ni répétition, ni deux voix), et son audio est conservé. Le
   * jumeau est facturé à SA génération (AVATAR_VIDEO_COST, en amont), pas ici :
   * ce montage ne débite que le rendu, comme tout montage.
   */
  jumeauVideoUrl?: string | null;
}): Promise<MontageProduit> {
  const {
    userId, config, post, rang, now, jobId, dernierePosterUrl = null, journal = '[Autopilote]',
  } = input;

  // Le jumeau tient la séquence « Vidéo » : on n'utilise alors AUCUN rush pour
  // ce montage — l'avatar est la vidéo, et la seule voix.
  const jumeauActif = typeof input.jumeauVideoUrl === 'string' && input.jumeauVideoUrl.length > 0;

  // ── Le rush existe-t-il encore ? ───────────────────────────────────────
  // Un rush supprimé — rétention du stockage, ménage de l'utilisateur —
  // reste écrit dans `rush_urls`. Sans ce contrôle, le rendu échoue trois
  // minutes plus tard sur une erreur de Chromium, et l'adresse morte
  // ressort au cycle suivant. Le rush est LÂCHÉ pour ce montage (qui sort en
  // titre/cartes/CTA, un montage valide) et signalé à l'appelant, qui le
  // retire de la banque.
  //
  // ⚠️ IGNORÉ QUAND LE JUMEAU EST MONTÉ : ce montage-là ne porte pas de rush,
  // donc rien à sonder ni à déclarer mort.
  let rushUrl = jumeauActif ? null : post.rushUrl;
  let rushMort: string | null = null;
  if (rushUrl && !(await rushEncorePresent(rushUrl))) {
    console.warn(`${journal} ${userId} — rush introuvable, ignoré : ${rushUrl}`);
    rushMort = rushUrl;
    input.onRushMort?.(rushUrl);
    rushUrl = null;
  }
  const postUtilise = rushUrl === post.rushUrl ? post : { ...post, rushUrl };

  // Les sondages RÉSEAU des durées, avant la fabrique de design qui reste pure.
  const [rushSeconds, jumeauSeconds] = await Promise.all([
    rushUrl ? probeRushSeconds(rushUrl) : Promise.resolve(null),
    // La durée du jumeau cale la séquence « Vidéo » : la parole doit tenir
    // entière. Illisible (`null`) → durée par défaut, posée à la fabrique du design.
    jumeauActif ? probeRushSeconds(input.jumeauVideoUrl as string) : Promise.resolve(null),
  ]);

  // ── L'AFFICHE : automatique (Pexels), mes photos, ou mes photos EN RÉFÉRENCE IA ──
  // ⚠️ LA BANQUE DE L'UTILISATEUR PASSE AVANT PEXELS — mais seulement si elle
  // contient quelque chose (sinon, retour à la recherche par thème).
  let posterUrl: string | null = null;
  let posterMeta: Record<string, unknown> = {};
  // La photo SOURCE de l'utilisateur réellement employée (custom, ou référence
  // de l'affiche IA), pour le journal/retour — `null` en mode automatique.
  let afficheCustom: string | null = null;
  /** Affiche IA réellement produite : débitée seulement si le montage est livré. */
  let afficheIaADebiter = false;
  const aDesPhotos = config.posterUrls.length > 0;

  if (config.posterMode === 'reference' && aDesPhotos) {
    // UNE de mes photos sert de RÉFÉRENCE : l'IA en fait une affiche qui
    // préserve mon visage/mes vêtements. La rotation porte sur la photo SOURCE,
    // pour que deux montages ne repartent pas de la même.
    const reference = pickCustomPoster(config.posterUrls, dernierePosterUrl, rang);
    if (reference) {
      afficheCustom = reference;
      input.onAfficheCustom?.(reference);
      const prompt = [
        'cinematic promotional poster, keep the subject (face, clothes) from the reference photo',
        post.title,
        postUtilise.brief?.message,
      ].filter(Boolean).join(', ').slice(0, 500);
      const gen = await genererAfficheReference({
        userId, jobId, referenceUrl: reference, prompt, aspectRatio: AUTOPILOT_FORMAT,
      });
      if (gen.ok) {
        posterUrl = gen.url;
        // Débitée plus bas, AVEC le rendu — pas ici : un rendu raté ensuite
        // laissait 5 crédits pris pour une vidéo qui n'existe pas, alors que
        // « Produire maintenant » répondait « Rien n'a été débité ».
        afficheIaADebiter = true;
      } else {
        // ── PAS DE PEXELS EN SILENCE ──────────────────────────────────────
        // L'IA a échoué : on garde MA photo telle quelle (mon contenu) en
        // affiche, et on l'ÉCRIT dans les métadonnées. Jamais une banque
        // d'images à ma place — exigence utilisateur.
        console.warn(`${journal} ${userId} — affiche IA échouée, photo gardée : ${gen.motif}`);
        posterUrl = reference;
        posterMeta = { posterReferenceEchec: true, posterReferenceMotif: gen.motif };
      }
    }
  } else if (config.posterMode === 'custom' && aDesPhotos) {
    posterUrl = pickCustomPoster(config.posterUrls, dernierePosterUrl, rang);
    if (posterUrl) { afficheCustom = posterUrl; input.onAfficheCustom?.(posterUrl); }
  } else {
    // Automatique : recherche par thème (Pexels). La variante fait tourner le
    // tirage — deux montages du même thème n'ont pas la même affiche.
    posterUrl = await pickPosterUrl(post.title, rang + Math.floor(now / 3_600_000));
  }

  // La voix AVANT le design : ce sont ses durées qui calent les séquences.
  // Un échec de TTS rend `{}` et le montage sort muet.
  //
  // ⚠️ ET SEULEMENT SI ELLE A ÉTÉ DEMANDÉE. ElevenLabs facture à l'usage :
  // sans ce garde, chaque montage déclencherait quatre synthèses payantes
  // chez des utilisateurs qui n'ont rien demandé.
  //
  // La voix CLONÉE du compte, la même sur toutes les séquences de toutes les
  // vidéos : c'est le point de l'identité constante. Sans choix, la voix par
  // défaut du serveur.
  //
  // ⚠️ AUCUNE VOIX OFF QUAND LE JUMEAU EST MONTÉ. La vidéo du jumeau porte
  // déjà la voix clonée : synthétiser en plus les séquences ferait une
  // seconde voix (superposée sur la séquence vidéo, répétée sur les autres)
  // et un coût ElevenLabs inutile. Le jumeau est la seule voix.
  const voices: VoixParSequence = (config.voiceEnabled && !jumeauActif)
    ? await buildAutopilotVoices({ userId, jobId, post: postUtilise, voiceId: config.voiceId })
    : {};
  // `config` porte l'identité CONSTANTE — couleurs, fond des cartes, musique,
  // niveaux du mixeur, son du rush. L'affiche, les textes et le rush, eux,
  // varient et arrivent par `post` et `posterUrl`. Le jumeau, s'il est monté,
  // tient la séquence « Vidéo » à la place du rush.
  const design = buildAutopilotDesign(postUtilise, {
    posterUrl, rushSeconds, voices, config,
    jumeau: jumeauActif ? { videoUrl: input.jumeauVideoUrl as string, seconds: jumeauSeconds ?? 0 } : null,
  });
  const { videoUrl, thumbnailUrl, durationFrames } = await renderAndUpload({ userId, jobId, design });

  const metadata = {
    ...buildAutopilotMetadata({
      post: postUtilise, design, videoUrl, thumbnailUrl, mode: config.mode,
      // Le fuseau de l'utilisateur : sans lui, le cron de publication lirait
      // l'heure programmée comme une heure de Paris.
      timezone: config.runTimezone,
    }),
    // ── PAS DE REMPLACEMENT SILENCIEUX ─────────────────────────────────────
    // L'utilisateur avait un rush pour ce montage (`post.rushUrl`), mais il a
    // expiré du stockage : le montage sort SANS séquence vidéo. On l'ÉCRIT
    // dans les métadonnées plutôt que de laisser croire que « mes rushes »
    // ont été honorés — exigence utilisateur : ne pas remplacer ses rushes en
    // silence, expliquer le problème. Le Calendrier/récap lit `rushIgnore`
    // pour l'afficher. `rushMort` n'est posé QUE quand un rush existait et
    // s'est révélé absent (404/410) : la condition « il avait des rushes » est
    // donc déjà remplie.
    ...(rushMort ? { rushIgnore: true, rushIgnoreMotif: 'rush expiré' } : null),
    // Le montage porte le JUMEAU en séquence « Vidéo » : le Calendrier/récap
    // le lit pour l'annoncer, et pour ne pas proposer une régénération
    // navigateur qui écraserait la vidéo de l'avatar.
    ...(jumeauActif ? { jumeau: true } : null),
    // Affiche IA à partir d'une photo de référence : si elle a échoué, la photo
    // de l'utilisateur a été gardée telle quelle — on l'ÉCRIT (jamais silencieux).
    ...posterMeta,
    ...(input.metadataSupplement ?? null),
  };
  const { data: insere, error: insertError } = await supabaseAdmin
    .from('scheduled_posts')
    .insert(toPostRow({
      userId, post: postUtilise, config, videoUrl, metadata, slotKey: input.slotKey,
    }))
    .select('id');
  if (insertError) throw new Error(`insertion du post : ${insertError.message}`);
  const premiere = Array.isArray(insere) ? (insere[0] as { id?: unknown } | undefined) : undefined;
  const postId = typeof premiere?.id === 'string' ? premiere.id : null;

  // Débit APRÈS coup, comme le chemin manuel : la vidéo est en ligne et le
  // post existe. Débiter avant ferait payer un rendu qui peut encore échouer.
  let debite = true;
  try {
    // Référence stable : le `jobId`. Une relance sur le même job ne débite
    // pas une seconde fois — c'est exactement le cas que l'ancien débit non
    // idempotent laissait passer, et un cron se relance.
    await deductCredits(
      userId, COST_PER_VIDEO, 'render',
      referenceOperation('autopilote', jobId),
    );
  } catch (e) {
    // Le montage est livré : on ne le retire pas pour un débit manqué. On le
    // dit fort, c'est tout.
    debite = false;
    console.error(
      `${journal} debit manque pour ${userId} (${COST_PER_VIDEO} credits) :`,
      e instanceof Error ? e.message : e,
    );
  }

  // L'affiche IA, même règle : après le dépôt, best-effort, référence stable
  // par `jobId` — un créneau rejoué ne la débite pas deux fois.
  if (afficheIaADebiter) {
    try {
      await deductCredits(userId, COST_AFFICHE_REFERENCE, 'ai', referenceOperation('autopilote-affiche', jobId));
    } catch (e) {
      console.error(`${journal} ${userId} — débit affiche IA manqué (${COST_AFFICHE_REFERENCE} crédits) :`, e instanceof Error ? e.message : e);
    }
  }

  console.log(
    `${journal} ${userId} — montage ${post.scheduledDate} rendu `
    + `(${durationFrames} images, ${AUTOPILOT_FORMAT}`
    + `, affiche ${posterUrl ? 'oui' : 'non'}`
    + `, cartes ${config.cardsShowPoster ? 'sur affiche' : 'sur couleurs'}`
    + `, rush ${rushSeconds ? `${rushSeconds.toFixed(1)}s` : 'non sonde'}`
    + `, son du rush ${config.keepRushAudio ? `${Math.round(config.rushVolume * 100)}%` : 'coupe'}`
    + `, musique ${config.musicUrl ? `${Math.round(config.musicVolume * 100)}%` : 'aucune'}`
    + `, voix ${config.voiceEnabled ? `${Object.keys(voices).length}/4` : 'desactivee'}`
    + `) : ${videoUrl}`,
  );

  return {
    videoUrl, thumbnailUrl, durationFrames, posterUrl, rushSeconds, rushUrl, rushMort,
    afficheCustom, voices, postId, debite,
  };
}
