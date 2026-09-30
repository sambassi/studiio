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
import { planMontage, dureeCibleMontage, dureePlan, plagesDuPlan, type AnalyseRush, type PlagesUtilisees } from '@/lib/creer/smart-montage';
import { rushsDuPlan, type RushSegment } from '@/lib/creer/multi-rush';
import { analyserRushServeurCache } from '@/lib/creer/analyse-rush-serveur';
import type { EtapeProduction } from '@/lib/autopilot/progression';

/** Nombre maximal de rushes réunis dans un smart montage Autopilote. */
export const RUSHS_MONTAGE_MAX = 3;

/**
 * Rushes qui rejoignent celui du créneau : les suivants de la banque, par
 * rotation à partir du rang — deux montages voisins ne réunissent pas les
 * mêmes. Pure, testable.
 */
export function rushsCompagnons(banque: ReadonlyArray<string>, principal: string, rang: number, n: number): string[] {
  const autres = Array.from(new Set(banque.filter((u) => typeof u === 'string' && u && u !== principal)));
  if (autres.length === 0 || n <= 0) return [];
  const depart = ((rang % autres.length) + autres.length) % autres.length;
  const out: string[] = [];
  for (let k = 0; k < Math.min(n, autres.length); k++) out.push(autres[(depart + k) % autres.length]);
  return out;
}

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
  /** Ce que l'utilisateur doit savoir de CE montage (musique perdue, son absent…). */
  avertissements: string[];
}

/** Avertissements lisibles d'un montage. Pure, testable. */
export function avertissementsMontage(m: {
  musiqueIntrouvable: boolean; audioSilencieux: boolean; voixRepliEdge: boolean; montageSimple: boolean;
}): string[] {
  const out: string[] = [];
  if (m.musiqueIntrouvable) out.push('Musique introuvable dans le stockage : la vidéo est sortie sans musique. Rechoisissez-la dans l’Autopilote.');
  if (m.voixRepliEdge) out.push('Voix clonée indisponible : la voix off standard (gratuite) a été utilisée.');
  if (m.montageSimple) out.push('Analyse intelligente indisponible — montage simple utilisé.');
  if (m.audioSilencieux) out.push('Le fichier final ne contient aucun son audible (ni musique, ni voix, ni son des rushes).');
  return out;
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
  /** Progression réelle par étape (production manuelle). Absent : rien ne change. */
  onProgression?: (etape: EtapeProduction, avancement?: number) => void;
  /** Plages déjà montées dans ce cycle (cron) : complétées par ce montage. */
  plagesCycle?: PlagesUtilisees;
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

  // ── La musique existe-t-elle encore ? ──────────────────────────────────
  // Même règle que le rush, même sonde. L'adresse vit dans `autopilot_config`
  // (et, figée, dans la file du jumeau) mais le fichier peut avoir disparu du
  // stockage. Remotion échouait alors en 404 au téléchargement, AVANT toute
  // image : aucun montage, et le finaliseur du jumeau relançait le même rendu
  // voué à l'échec à chaque passe. La musique est un habillage : le montage
  // sort SANS elle, et on l'ÉCRIT dans les métadonnées — jamais en silence.
  // Réseau muet ou 405 : la sonde répond « présent », comme pour le rush.
  let configUtilisee = config;
  let musiqueIntrouvable = false;
  if (config.musicUrl && !(await rushEncorePresent(config.musicUrl))) {
    console.warn(`${journal} ${userId} — musique introuvable, montage sans musique : ${config.musicUrl}`);
    configUtilisee = { ...config, musicUrl: null };
    musiqueIntrouvable = true;
  }

  // ── SMART MONTAGE V2 : plusieurs rushes de la banque, montés par le MÊME
  // moteur que Créer (`planMontage`). Le rush du créneau ouvre la liste ;
  // jusqu'à deux autres rushes de la banque le rejoignent, par rotation.
  // Un seul rush dans la banque : chemin mono-rush d'avant, à l'identique.
  // L'ANALYSE (technique, indépendante du thème) se fait ici, en parallèle
  // et en cache ; le PLAN vient après la voix, dont il doit couvrir la durée.
  const chrono = { debut: Date.now(), preparation: 0, analyse: 0, selection: 0, rendu: 0, envoi: 0 };
  const analysesRushs: AnalyseRush[] = [];
  const analysesEchouees: string[] = [];
  let disponible = 0;
  let secondesParRush = new Map<string, number | null>();
  if (rushUrl && !jumeauActif) {
    const t0 = Date.now();
    const autres = rushsCompagnons(config.rushUrls, rushUrl, rang, RUSHS_MONTAGE_MAX - 1);
    const presents = await Promise.all(autres.map((u) => rushEncorePresent(u)));
    const liste = [rushUrl, ...autres.filter((_, i) => presents[i])];
    if (liste.length > 1) {
      const secondes = await Promise.all(liste.map((u) => probeRushSeconds(u)));
      secondesParRush = new Map(liste.map((u, i) => [u, secondes[i]]));
      disponible = secondes.reduce<number>((t, x) => t + (x ?? 0), 0);
      chrono.preparation = Date.now() - t0;
      input.onProgression?.('analyse', 0.1);
      const t1 = Date.now();
      // UN rush après l'autre : en parallèle, trois décodages se disputaient
      // le processeur du serveur et TOUS dépassaient leur délai (test réel
      // du 30/09 : RUSH_ANALYSIS_MS=120041, aucun plan). Un rush en échec
      // n'empêche pas le montage des autres.
      for (const [i, u] of liste.entries()) {
        const r = await analyserRushServeurCache(u, secondes[i]);
        if (r) analysesRushs.push(r);
        else analysesEchouees.push(u.split('/').pop() ?? u);
        input.onProgression?.('analyse', (i + 1) / liste.length);
      }
      chrono.analyse = Date.now() - t1;
    }
  }

  input.onProgression?.('preparation', 0);
  // Les sondages RÉSEAU des durées, avant la fabrique de design qui reste pure.
  const [rushSeconds, jumeauSeconds] = await Promise.all([
    rushUrl ? (secondesParRush.has(rushUrl) ? Promise.resolve(secondesParRush.get(rushUrl) ?? null) : probeRushSeconds(rushUrl)) : Promise.resolve(null),
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
  // ── PLAN (smart montage V2) : pertinence selon le thème / brief / textes,
  // plages déjà montées dans ce cycle évitées, durée couvrant la voix de la
  // séquence « Vidéo » sans dépasser la matière disponible.
  let planMontageRushs: RushSegment[] | null = null;
  let montageSimpleMotif: string | null = null;
  if (analysesRushs.length > 0 || secondesParRush.size > 1) {
    const t2 = Date.now();
    const voixVideo = (voices as Record<string, { seconds?: number } | undefined>).video?.seconds ?? 0;
    const cible = Math.min(disponible, Math.max(dureeCibleMontage(disponible), Math.ceil(voixVideo)));
    planMontageRushs = planMontage(analysesRushs, cible, {
      contexte: {
        theme: post.title,
        sujet: post.content?.subtitle ?? null,
        objectif: [postUtilise.brief?.objectif, postUtilise.brief?.message].filter(Boolean).join(' ') || null,
        texte: (post.content?.cards ?? []).map((c) => `${c.title ?? ''} ${c.description ?? ''}`).join(' ') || null,
      },
      plagesExclues: input.plagesCycle ?? null,
    });
    chrono.selection = Date.now() - t2;
    if (!planMontageRushs) {
      montageSimpleMotif = 'analyse intelligente indisponible';
      console.warn(`${journal} ${userId} — Analyse intelligente indisponible — montage simple utilisé`);
    } else {
      if (input.plagesCycle) plagesDuPlan(planMontageRushs, input.plagesCycle);
      console.log(`${journal} ${userId} — smart montage : ${planMontageRushs.length} extraits, ${dureePlan(planMontageRushs)}s`);
    }
  }

  const designBase = buildAutopilotDesign(postUtilise, {
    posterUrl, rushSeconds, voices, config: configUtilisee,
    jumeau: jumeauActif ? { videoUrl: input.jumeauVideoUrl as string, seconds: jumeauSeconds ?? 0 } : null,
  });
  // Smart montage : la séquence « Vidéo » porte le plan d'extraits ; sa durée
  // est celle du plan (jamais plus courte que la voix de la séquence).
  // Le plan couvre déjà la voix (cible) : la séquence dure EXACTEMENT le plan,
  // rien n'est étiré (un extrait étiré rejouerait la matière d'un autre).
  const design = planMontageRushs
    ? {
      ...designBase,
      montage: planMontageRushs,
      rushs: rushsDuPlan(planMontageRushs),
      videoDuration: dureePlan(planMontageRushs),
    }
    : designBase;
  input.onProgression?.('composition', 0);
  const t3 = Date.now();
  let t4 = 0;
  const { videoUrl, thumbnailUrl, durationFrames, audio } = await renderAndUpload({
    userId, jobId, design,
    onComposition: (f) => input.onProgression?.('composition', f),
    onEnvoi: () => { t4 = Date.now(); input.onProgression?.('envoi', 0); },
  });
  chrono.rendu = (t4 || Date.now()) - t3;
  chrono.envoi = t4 ? Date.now() - t4 : 0;
  const mesures = {
    RUSH_PREPARATION_MS: chrono.preparation,
    RUSH_ANALYSIS_MS: chrono.analyse,
    SMART_SELECTION_MS: chrono.selection,
    REMOTION_RENDER_MS: chrono.rendu,
    FINAL_UPLOAD_MS: chrono.envoi,
    TOTAL_MS: Date.now() - chrono.debut,
  };
  console.log(`${journal} ${userId} — mesures ${JSON.stringify(mesures)}`);
  input.onProgression?.('finalisation', 0);

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
    // Smart montage : le plan relu par le Calendrier (régénération, Modifier),
    // et les rushes réellement montés.
    ...(planMontageRushs
      ? { rushSegments: planMontageRushs, rushUrls: rushsDuPlan(planMontageRushs).map((r) => r.url) }
      : null),
    // Analyse impossible : montage simple — jamais en silence.
    ...(montageSimpleMotif ? { montageSimple: true, montageSimpleMotif } : null),
    // Rushes dont l'analyse a échoué (délai, fichier illisible) : dit.
    ...(analysesEchouees.length ? { analysesEchouees } : null),
    // Voix gratuite (Edge) utilisée faute d'ElevenLabs : dit, jamais caché.
    ...(Object.values(voices).some((v) => v?.repli === 'edge') ? { voixRepliEdge: true } : null),
    // Durées par étape (diagnostic performance, temporaire).
    mesuresRendu: mesures,
    // Le fichier FINAL a-t-il du son ? Mesuré sur le MP4 (ffmpeg), pas supposé.
    ...(audio ? { audioFinal: audio } : null),
    ...(audio && audio.silencieux ? { audioSilencieux: true } : null),
        // Même exigence pour la musique configurée mais disparue du stockage.
    ...(musiqueIntrouvable ? { musiqueIgnoree: true, musiqueIgnoreeMotif: 'musique introuvable' } : null),
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
    + `, musique ${configUtilisee.musicUrl ? `${Math.round(config.musicVolume * 100)}%` : 'aucune'}`
    + `, voix ${config.voiceEnabled ? `${Object.keys(voices).length}/4` : 'desactivee'}`
    + `) : ${videoUrl}`,
  );

  return {
    videoUrl, thumbnailUrl, durationFrames, posterUrl, rushSeconds, rushUrl, rushMort,
    afficheCustom, voices, postId, debite,
    avertissements: avertissementsMontage({
      musiqueIntrouvable,
      audioSilencieux: !!audio?.silencieux,
      voixRepliEdge: Object.values(voices).some((v) => v?.repli === 'edge'),
      montageSimple: !!montageSimpleMotif,
    }),
  };
}
