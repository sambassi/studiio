import { supabaseAdmin } from '@/lib/db/supabase';
import { deductCredits } from '@/lib/credits/system';
import { prixDe } from '@/lib/tarifs/serveur';
import { referenceOperation } from '@/lib/credits/atomique';
import { toPostRow, slotKey, type PreparedPost } from '@/lib/autopilot/engine';
import { sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import { buildAutopilotDesign, buildAutopilotMetadata, AUTOPILOT_FORMAT } from '@/lib/autopilot/design';
import { renderAndUpload } from '@/lib/autopilot/render';
import { urlRenduPourRush } from '@/lib/render/proxy-rendu';
import {
  pickPosterUrl, pickCustomPoster, probeRushSeconds, rushEncorePresent,
} from '@/lib/autopilot/poster';
import { buildAutopilotVoices, type VoixParSequence } from '@/lib/autopilot/voice';
import { genererAfficheReference } from '@/lib/ai/affiche-reference';
import { planMontage, dureeCibleMontage, dureePlan, plagesDuPlan, profilMontageDuContexte, mesuresSegments, type AnalyseRush, type PlagesUtilisees } from '@/lib/creer/smart-montage';
import { rushsDuPlan, estUrlImage, type RushSegment } from '@/lib/creer/multi-rush';
import { analyserRushServeurCache, analyserMusiqueServeur, analyseNeutre } from '@/lib/creer/analyse-rush-serveur';
import { rythmeSurFenetre } from '@/lib/creer/rythme-musique';
import { planOverlays, profilEnSurimpression, type OverlaysMontage } from '@/lib/creer/overlays';
import { conseillerVideo, type RapportConseils } from '@/lib/creer/conseiller';
import { contexteMontageDepuis, rapportPlan } from '@/lib/creer/smart-montage-regles';
import { appliquerMiseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { zoneCalmeSortie } from '@/lib/creer/zone-calme';
import { raccourciNecessaire, type Raccourci } from '@/lib/creer/raccourci';
import { controleQualite } from '@/lib/creer/quality-gate';
import { avatarActifConfig, mediasDesSources, sourcesEffectives, urlStockAutorisee, type MediaStockRetenu } from '@/lib/autopilot/sources';
import { planMultiSources, BROLL_MAX_S, BROLL_VIDEO_S } from '@/lib/autopilot/plan-multi-sources';
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

/** Médias stock (vidéos, photos) pris au plus par montage multi-sources. */
export const STOCK_MONTAGE_MAX = 8;

/**
 * Le rush du créneau quand la clé `sources` est réglée : celui pioché s'il
 * appartient aux rushes personnels ACTIFS, sinon le suivant de cette banque,
 * sinon aucun (rushes désactivés, ou banque faite seulement de stock). Pur.
 */
export function rushDuCreneau(choisi: string | null, banque: ReadonlyArray<string>, rang: number): string | null {
  if (choisi && banque.includes(choisi)) return choisi;
  if (banque.length === 0) return null;
  return banque[((rang % banque.length) + banque.length) % banque.length];
}

/**
 * Coût d'une affiche générée à partir d'une photo de référence, en crédits —
 * le tarif `autopilot.poster_reference` de la grille centrale, lu au moment
 * du débit (5 sans configuration admin, le même que « generate-bg »).
 */
export function coutAfficheReference(): Promise<number> {
  return prixDe('autopilot.poster_reference');
}

/**
 * Ce que l'affiche de référence AJOUTE au devis d'un montage : son tarif quand
 * le mode « référence » est actif avec au moins une photo (la condition même
 * de `produireUnMontage`), 0 sinon. Sans elle, le devis annonçait le rendu
 * seul alors que le montage débitait rendu + affiche.
 */
export async function coutAfficheDuDevis(config: Pick<AutopilotConfig, 'posterMode' | 'posterUrls'>): Promise<number> {
  return config.posterMode === 'reference' && config.posterUrls.length > 0 ? coutAfficheReference() : 0;
}

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
 * L'Autopilote produit du vertical : c'est donc le tarif « reel » de la
 * grille centrale (`render.reel`, la table `tarifs_rendu` que lit aussi le
 * débit SQL des rendus manuels — 10 sans configuration). Il sert à DEUX
 * choses — borner le nombre de montages du cycle, et débiter après chaque
 * rendu réussi. UNE fonction, lue par le cron ET par la production
 * manuelle ; l'appelant qui a annoncé un prix le transmet à
 * `produireUnMontage` (`coutRendu`) : le nombre annoncé est le nombre débité.
 */
export function coutMontage(): Promise<number> {
  return prixDe('render.reel');
}

/**
 * LE DEVIS COMPLET d'un montage, poste par poste — la formule du prix lue
 * par le devis affiché (GET « Produire maintenant ») ET par le contrôle avant
 * lancement (POST). Le cron applique la même somme, poste par poste.
 *
 *   - `rendu`   : `render.reel`, débité par `produireUnMontage` (réf. `autopilote:<jobId>`) ;
 *   - `avatar`  : `avatar.jumeau` quand la vidéo du jumeau est montée, débité
 *                 UNE fois par `genererVideoJumeau` (réf. `jumeau:<generationId>`),
 *                 remboursé si la génération échoue ; 0 sinon ;
 *   - `affiche` : `autopilot.poster_reference` en mode référence (réf.
 *                 `autopilote-affiche:<jobId>`) ; 0 sinon.
 *
 * Aucun autre débit : la voix off n'est jamais synthétisée quand le jumeau
 * est monté (il porte la voix), et l'Autopilote ne facture pas l'audio à part.
 * ⚠️ Le GET annonçait rendu + affiche, SANS l'avatar, alors que le POST
 * contrôlait (et que le montage débitait) rendu + avatar + affiche.
 */
export async function devisMontage(
  config: Pick<AutopilotConfig, 'jumeauAvatar' | 'posterMode' | 'posterUrls'> & { designStyle?: AutopilotConfig['designStyle'] },
): Promise<{ rendu: number; avatar: number; affiche: number; total: number }> {
  // Multi-sources : le stock ne coûte rien (0 crédit, médias déjà retenus) ;
  // l'avatar n'est compté que s'il est réellement monté (`avatarActifConfig`).
  const [rendu, avatar, affiche] = await Promise.all([
    coutMontage(),
    avatarActifConfig({ rushUrls: [], jumeauAvatar: config.jumeauAvatar, designStyle: config.designStyle }) ? prixDe('avatar.jumeau') : Promise.resolve(0),
    coutAfficheDuDevis(config),
  ]);
  return { rendu, avatar, affiche, total: rendu + avatar + affiche };
}

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
  /** Une voix PERSONNELLE (clonée) était configurée — sinon on ne parle pas de « voix clonée ». */
  voixPersonnelle?: boolean;
}): string[] {
  const out: string[] = [];
  if (m.musiqueIntrouvable) out.push('Musique introuvable dans le stockage : la vidéo est sortie sans musique. Rechoisissez-la dans l’Autopilote.');
  if (m.voixRepliEdge) {
    out.push(m.voixPersonnelle
      ? 'Voix clonée indisponible : la voix off standard (gratuite) a été utilisée.'
      : 'Voix premium indisponible : la voix off standard (gratuite) a été utilisée.');
  }
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
   * jumeau est facturé à SA génération (tarif `avatar.jumeau`, en amont), pas ici :
   * ce montage ne débite que le rendu, comme tout montage.
   */
  jumeauVideoUrl?: string | null;
  /**
   * Le prix du rendu DÉJÀ lu par l'appelant (`coutMontage()`), pour débiter
   * exactement ce qui a été annoncé et contrôlé. Absent : lu au débit.
   */
  coutRendu?: number;
}): Promise<MontageProduit> {
  const {
    userId, config, post, rang, now, jobId, dernierePosterUrl = null, journal = '[Autopilote]',
  } = input;

  // Le jumeau tient la séquence « Vidéo » : on n'utilise alors AUCUN rush pour
  // ce montage — l'avatar est la vidéo, et la seule voix.
  const jumeauActif = typeof input.jumeauVideoUrl === 'string' && input.jumeauVideoUrl.length > 0;

  // ── MULTI-SOURCES (`sources.ts`) ───────────────────────────────────────
  // Rushes personnels, avatar et stock sont des sources COMBINABLES. Le plan
  // multi-sources ne s'applique que si la clé `designStyle.sources` est
  // réglée ET qu'une source s'ajoute à l'avatar (ou que du stock est retenu) :
  // sans elle, chaque chemin d'avant reste identique à l'octet près.
  const sourcesCfg = sourcesEffectives(config);
  const medias = mediasDesSources(config);
  const nbStock = medias.videosStock.length + medias.photosStock.length;
  const multiSources = sourcesCfg.explicite && (jumeauActif
    ? medias.rushesPersonnels.length + nbStock > 0
    : nbStock > 0);
  // La banque de rushes PERSONNELS (actives respectés) ; sans clé : la banque entière.
  const banqueRushs: string[] = sourcesCfg.explicite ? medias.rushesPersonnels : config.rushUrls;

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
  let rushUrl = jumeauActif && !multiSources
    ? null
    // Clé `sources` réglée : le rush du créneau doit appartenir aux rushes
    // personnels ACTIFS (sinon le suivant de la banque, ou aucun).
    : sourcesCfg.explicite ? rushDuCreneau(post.rushUrl, banqueRushs, rang) : post.rushUrl;
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
  /** Rushes personnels réunis pour ce montage (multi-sources). */
  let listeRushs: string[] = rushUrl ? [rushUrl] : [];
  if (rushUrl && (!jumeauActif || multiSources)) {
    const t0 = Date.now();
    const autres = rushsCompagnons(banqueRushs, rushUrl, rang, RUSHS_MONTAGE_MAX - 1);
    const presents = await Promise.all(autres.map((u) => rushEncorePresent(u)));
    const liste = [rushUrl, ...autres.filter((_, i) => presents[i])];
    listeRushs = liste;
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
        else {
          // Mesure impossible : le rush reste MONTABLE (mesures neutres) au
          // lieu de disparaître — sans lui, le plan retombait sur deux rushes
          // de 8 s (5,8 s, A → B → A → B). Dit dans les métadonnées.
          const s = secondes[i];
          if (s && s >= 1) analysesRushs.push(analyseNeutre(u, s));
          analysesEchouees.push(`${u.split('/').pop() ?? u}${s && s >= 1 ? ' (monté sans mesure)' : ''}`);
        }
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
  const designBase = buildAutopilotDesign(postUtilise, {
    posterUrl, rushSeconds, voices, config: configUtilisee,
    jumeau: jumeauActif ? { videoUrl: input.jumeauVideoUrl as string, seconds: jumeauSeconds ?? 0 } : null,
  });
  // Smart montage : la séquence « Vidéo » porte le plan d'extraits ; sa durée
  // est celle du plan (jamais plus courte que la voix de la séquence).
  // ── PLAN (smart montage V2) : pertinence selon le thème / brief / textes,
  // plages déjà montées dans ce cycle évitées, durée couvrant la voix de la
  // séquence « Vidéo » sans dépasser la matière disponible.
  let planMontageRushs: RushSegment[] | null = null;
  let montageSimpleMotif: string | null = null;
  let enSurimpression = false;
  let overlays: OverlaysMontage | null = null;
  // Conseiller : ce que le plan a utilisé (profil, temps de la musique).
  let profilVideo: ReturnType<typeof profilMontageDuContexte>['profil'] = 'STANDARD';
  let montageRapport: ReturnType<typeof rapportPlan> | null = null;
  // #504 : vidéo raccourcie faute de matière unique — personne à qui demander
  // ici : c'est DIT (journal + metadata), jamais caché.
  let montageRaccourci: Raccourci | null = null;
  let rythmeVideo: { beats: number[]; forts: number[]; drop: number | null } | null = null;
  let contexteConseil: { theme: string | null; objectif: string | null } = { theme: null, objectif: null };
  /** Multi-sources : pourquoi ce plan, et les médias stock lâchés (introuvables). */
  let explicationsSources: string[] = [];
  const mediasIgnores: string[] = [];
  let stockUtilise: MediaStockRetenu[] = [];
  if (multiSources) {
    const t2 = Date.now();
    // Les médias stock RETENUS (jamais cherchés ici) : sondés, un média mort est
    // LÂCHÉ — un média stock ne fait jamais échouer le montage.
    // Garde SSRF (défense en profondeur) : jamais de sonde ni de rendu d'une
    // URL hors de notre stockage / des CDN stock, même si la base en contient.
    const videosStock = medias.videosStock.filter((u) => urlStockAutorisee(u, 'video') || (mediasIgnores.push(u), false)).slice(0, STOCK_MONTAGE_MAX);
    const photosStock = medias.photosStock.filter((u) => urlStockAutorisee(u, 'photo') || (mediasIgnores.push(u), false)).slice(0, STOCK_MONTAGE_MAX);
    const [presV, presP] = await Promise.all([
      Promise.all(videosStock.map((u) => rushEncorePresent(u))),
      Promise.all(photosStock.map((u) => rushEncorePresent(u))),
    ]);
    const videosOk = videosStock.filter((u, i) => presV[i] || (mediasIgnores.push(u), false));
    const photosOk = photosStock.filter((u, i) => presP[i] || (mediasIgnores.push(u), false));
    if (mediasIgnores.length) console.warn(`${journal} ${userId} — ${mediasIgnores.length} média(s) stock introuvable(s), ignoré(s)`);
    const secondesStock = await Promise.all(videosOk.map((u) => probeRushSeconds(u)));
    const rushes = listeRushs.map((u) => ({ url: u, secondes: secondesParRush.has(u) ? secondesParRush.get(u) ?? null : (u === rushUrl ? rushSeconds : null) }));
    const stockVideos = videosOk.map((u, i) => ({ url: u, secondes: secondesStock[i] }));
    const secondesVoix = (cle: string) => (voices as Record<string, { seconds?: number } | undefined>)[cle]?.seconds ?? 0;
    const contexteMontage = contexteMontageDepuis({
      theme: post.title,
      titre: post.title,
      sousTitre: post.content?.subtitle ?? null,
      objectif: [postUtilise.brief?.objectif, postUtilise.brief?.message].filter(Boolean).join(' ') || null,
      cartes: post.content?.cards ?? [],
    });
    profilVideo = profilMontageDuContexte(contexteMontage).profil;
    contexteConseil = { theme: contexteMontage.theme ?? null, objectif: contexteMontage.objectif ?? null };
    let res: ReturnType<typeof planMultiSources>;
    if (jumeauActif) {
      // ── AVATAR + autres sources : la séquence dure la PAROLE de l'avatar,
      // textes en SURIMPRESSION (aucun raccord avant la vidéo : la voix et
      // l'image de l'avatar partent ensemble, à 0).
      const T = jumeauSeconds && jumeauSeconds > 0 ? jumeauSeconds : (designBase.videoDuration ?? 0);
      res = planMultiSources({
        avatar: { url: input.jumeauVideoUrl as string, secondes: T },
        rushes, analyses: analysesRushs, stockVideos, photos: photosOk,
        gabarit: sourcesCfg.sources.gabarit, cible: T,
        options: { contexte: contexteMontage, plagesExclues: input.plagesCycle ?? null },
      });
      enSurimpression = true;
      if (res.plan.length) {
        const o = planOverlays({
          duree: res.duree,
          profil: profilVideo,
          nbCartes: designBase.cards?.length ?? 0,
          finHook: res.plan[0]?.kind === 'avatar' ? res.plan[0].fin : null,
          voix: { video: res.duree },
        });
        // La voix de l'avatar est CONTINUE et part à 0, avec son image.
        overlays = { ...o, voix: { video: 0 } };
      }
    } else {
      // ── Rushes + stock, ou stock seul : la règle de durée du smart montage
      // (voix à porter, matière disponible) ; le stock comble ce qui manque.
      enSurimpression = profilEnSurimpression(profilVideo);
      const voixAPorter = enSurimpression
        ? ['titre', 'cartes', 'video', 'cta'].reduce((t, k) => t + (secondesVoix(k) ? secondesVoix(k) + 0.2 : 0), 0)
        : secondesVoix('video');
      // Même règle que le smart montage : ~30 s, la voix couverte, jamais plus
      // que la matière (une durée illisible compte pour un plan de coupe).
      const dispo = [...rushes, ...stockVideos].reduce((t, x) => t + (x.secondes ?? BROLL_VIDEO_S), 0) + photosOk.length * BROLL_MAX_S;
      const cible = Math.min(dispo, Math.max(dureeCibleMontage(dispo), Math.ceil(voixAPorter)));
      const rythme = configUtilisee.musicUrl ? await analyserMusiqueServeur(configUtilisee.musicUrl) : null;
      const debutVideo = enSurimpression ? 0 : (designBase.introDuration ?? 0) + (designBase.cardsDuration ?? 0);
      rythmeVideo = rythme ? rythmeSurFenetre(rythme, debutVideo, cible) : null;
      res = planMultiSources({
        rushes, analyses: analysesRushs, stockVideos, photos: photosOk,
        gabarit: sourcesCfg.sources.gabarit, cible,
        options: { rythme: rythmeVideo, contexte: contexteMontage, plagesExclues: input.plagesCycle ?? null },
      });
      if (res.plan.length && enSurimpression) {
        overlays = planOverlays({
          duree: res.duree,
          profil: profilVideo,
          nbCartes: designBase.cards?.length ?? 0,
          finHook: res.plan.filter((x) => x.phase === 'HOOK').at(-1)?.fin ?? null,
          voix: { titre: secondesVoix('titre'), cartes: secondesVoix('cartes'), video: secondesVoix('video'), cta: secondesVoix('cta') },
        });
      }
    }
    explicationsSources = res.explications;
    planMontageRushs = res.plan.length ? res.plan : null;
    if (!planMontageRushs) overlays = null;
    chrono.selection = Date.now() - t2;
    if (planMontageRushs) {
      const utilisees = new Set(planMontageRushs.map((x) => x.url));
      stockUtilise = sourcesCfg.sources.stock.filter((m) => utilisees.has(m.url));
      if (input.plagesCycle) plagesDuPlan(planMontageRushs.filter((x) => x.source === 'rush'), input.plagesCycle);
      console.log(`${journal} ${userId} — MULTI_SOURCES ${JSON.stringify({ plans: planMontageRushs.length, duree: dureePlan(planMontageRushs), avatar: jumeauActif, explications: res.explications })}`);
      const ms = mesuresSegments(planMontageRushs, analysesRushs);
      if (ms) montageRapport = rapportPlan(profilVideo, ms, rythmeVideo);
    }
  }
  if (!multiSources && (analysesRushs.length > 0 || secondesParRush.size > 1)) {
    const t2 = Date.now();
    const secondesVoix = (cle: string) => (voices as Record<string, { seconds?: number } | undefined>)[cle]?.seconds ?? 0;
    // MÊME préparation que Créer (`contexteMontageDepuis`) : même thème +
    // mêmes textes = même profil, mêmes pertinences.
    const contexteMontage = contexteMontageDepuis({
      theme: post.title,
      titre: post.title,
      sousTitre: post.content?.subtitle ?? null,
      objectif: [postUtilise.brief?.objectif, postUtilise.brief?.message].filter(Boolean).join(' ') || null,
      cartes: post.content?.cards ?? [],
    });
    // V3 : profils dynamiques = textes EN SURIMPRESSION, la vidéo est tout le
    // montage. Elle doit alors porter TOUTES les voix, l'une après l'autre.
    profilVideo = profilMontageDuContexte(contexteMontage).profil;
    contexteConseil = { theme: contexteMontage.theme ?? null, objectif: contexteMontage.objectif ?? null };
    enSurimpression = profilEnSurimpression(profilVideo);
    const voixAPorter = enSurimpression
      ? ['titre', 'cartes', 'video', 'cta'].reduce((t, k) => t + (secondesVoix(k) ? secondesVoix(k) + 0.2 : 0), 0)
      : secondesVoix('video');
    const cible = Math.min(disponible, Math.max(dureeCibleMontage(disponible), Math.ceil(voixAPorter)));
    // V3 : coupes calées sur le rythme de la musique, lue à partir du début
    // de la séquence « Vidéo » (0 en surimpression, après titre et cartes sinon).
    const rythme = configUtilisee.musicUrl ? await analyserMusiqueServeur(configUtilisee.musicUrl) : null;
    const debutVideo = enSurimpression ? 0 : (designBase.introDuration ?? 0) + (designBase.cardsDuration ?? 0);
    rythmeVideo = rythme ? rythmeSurFenetre(rythme, debutVideo, cible) : null;
    planMontageRushs = planMontage(analysesRushs, cible, {
      rythme: rythmeVideo,
      contexte: contexteMontage,
      plagesExclues: input.plagesCycle ?? null,
    });
    if (planMontageRushs) {
      montageRaccourci = raccourciNecessaire(cible, dureePlan(planMontageRushs), new Set(planMontageRushs.map((x) => x.url)).size);
      if (montageRaccourci) console.warn(`${journal} ${userId} — RACCOURCI ${JSON.stringify({ REQUESTED_DURATION: cible, FINAL_SAFE_DURATION: montageRaccourci.possible, RUSHS_SUPPLEMENTAIRES_RECOMMANDES: montageRaccourci.supplementaires })}`);
    }
    if (planMontageRushs && enSurimpression) {
      overlays = planOverlays({
        duree: dureePlan(planMontageRushs),
        profil: profilVideo,
        nbCartes: designBase.cards?.length ?? 0,
        finHook: planMontageRushs.filter((x) => x.phase === 'HOOK').at(-1)?.fin ?? null,
        voix: { titre: secondesVoix('titre'), cartes: secondesVoix('cartes'), video: secondesVoix('video'), cta: secondesVoix('cta') },
      });
    }
    chrono.selection = Date.now() - t2;
    if (!planMontageRushs) {
      montageSimpleMotif = 'analyse intelligente indisponible';
      console.warn(`${journal} ${userId} — Analyse intelligente indisponible — montage simple utilisé`);
    } else {
      if (input.plagesCycle) plagesDuPlan(planMontageRushs, input.plagesCycle);
      console.log(`${journal} ${userId} — smart montage : ${planMontageRushs.length} extraits, ${dureePlan(planMontageRushs)}s`);
      // Rapport du plan : les MÊMES mesures que Créer (`rapportPlan`).
      const ms = mesuresSegments(planMontageRushs, analysesRushs);
      if (ms) {
        montageRapport = rapportPlan(profilVideo, ms, rythmeVideo);
        console.log(`${journal} ${userId} — MONTAGE_PROFILE=${profilVideo} ${JSON.stringify(montageRapport)}`);
      }
    }
  }

  // Le plan couvre déjà la voix (cible) : la séquence dure EXACTEMENT le plan,
  // rien n'est étiré (un extrait étiré rejouerait la matière d'un autre).
  let design = planMontageRushs
    ? {
      ...designBase,
      montage: planMontageRushs,
      rushs: rushsDuPlan(multiSources ? planMontageRushs.filter((x) => x.kind !== 'image' && x.kind !== 'avatar') : planMontageRushs),
      videoDuration: dureePlan(planMontageRushs),
      // Surimpression : plus d'écran titre, cartes ni CTA — la vidéo continue
      // porte les textes (`overlays`). Les durées à 0 retirent ces séquences.
      ...(overlays ? { surimpressions: overlays, introDuration: 0, cardsDuration: 0, ctaDuration: 0 } : {}),
      // MULTI-SOURCES : la séquence « Vidéo » existe dès qu'un plan existe (stock
      // seul : le premier média) ; avec l'avatar, sa voix est une piste
      // CONTINUE (`sequenceVoiceUrls.video`) et le son des plans est coupé —
      // l'image de l'avatar, découpée, reste calée sur elle (`depuis === debut`).
      ...(multiSources ? { videoUrl: designBase.videoUrl ?? planMontageRushs[0].url } : {}),
      ...(multiSources && jumeauActif ? {
        videoUrl: input.jumeauVideoUrl as string,
        rushMuted: true,
        sequenceVoiceUrls: { video: input.jumeauVideoUrl as string },
      } : {}),
    }
    : designBase;
  // Surimpressions : position, taille et fond des textes — la MÊME mise en
  // page que Créer (`surimpressions-mise-en-page.ts`).
  // #502 : CTA dans la bande mesurée la plus calme des plans de sortie (même règle que Créer).
  const zoneCta = overlays?.cta && planMontageRushs ? zoneCalmeSortie(planMontageRushs, analysesRushs, overlays.cta[0]) : null;
  if (overlays) design = appliquerMiseEnPageSurimpression(design, profilVideo, { ctaBande: zoneCta?.bande });
  // QUALITY GATE (#504) — le MÊME contrôle que Créer. Sans utilisateur à qui
  // répondre, il est journalisé et écrit en métadonnées, jamais caché.
  const qualiteMontage = planMontageRushs
    ? controleQualite({
      profil: profilVideo,
      mesures: mesuresSegments(planMontageRushs, analysesRushs),
      rapport: montageRapport,
      overlays,
      cartes: postUtilise.content.cards ?? [],
      cta: { texte: design.ctaText ?? '', sousTexte: design.ctaSubText ?? null },
      ctaUtilisateur: postUtilise.brief?.cta ?? null,
      voixTitre: !!overlays?.voix?.titre,
      antiGels: true,
    })
    : null;
  if (qualiteMontage) console.log(`${journal} ${userId} — QUALITY_GATE ${JSON.stringify(Object.fromEntries(qualiteMontage.map((c) => [c.code, c.ok ? 'OK' : `KO ${c.detail}`])))}`);
  // ── PROXYS DE RENDU : un rush 4K / 60 i/s est rendu depuis sa copie
  // 1080p 30 i/s (créée une fois, en cache). Le plan et les métadonnées
  // gardent les URL ORIGINALES ; seule l'entrée du rendu change.
  const tProxy = Date.now();
  // Ni photo (aucun `parseMedia` sur une image) ni avatar (sa vidéo sert aussi
  // de piste de voix : même fichier pour l'image et le son).
  const urlsRush = Array.from(new Set([
    ...(design.montage ?? []).filter((s) => s.kind !== 'image' && s.kind !== 'avatar').map((s) => s.url),
    ...(design.rushs ?? []).map((r) => r.url),
    ...(design.videoUrl && !jumeauActif && !estUrlImage(design.videoUrl) ? [design.videoUrl] : []),
  ]));
  const proxys = new Map<string, string>();
  let proxysCrees = 0;
  let proxysReutilises = 0;
  for (const u of urlsRush) {
    const p = await urlRenduPourRush(u);
    if (p.proxy) { proxys.set(u, p.url); if (p.cree) proxysCrees += 1; else proxysReutilises += 1; }
  }
  const versRendu = (u: string) => proxys.get(u) ?? u;
  const designRendu = proxys.size === 0 ? design : {
    ...design,
    ...(design.videoUrl ? { videoUrl: versRendu(design.videoUrl) } : {}),
    ...(design.montage ? { montage: design.montage.map((s) => ({ ...s, url: versRendu(s.url) })) } : {}),
    ...(design.rushs ? { rushs: design.rushs.map((r) => ({ ...r, url: versRendu(r.url) })) } : {}),
  };
  const proxyMs = Date.now() - tProxy;

  input.onProgression?.('composition', 0);
  const t3 = Date.now();
  let t4 = 0;
  const { videoUrl, thumbnailUrl, durationFrames, audio, moteur, hybrideRaison, mesuresHybride, mesuresTextes } = await renderAndUpload({
    userId, jobId, design: designRendu,
    onComposition: (f) => input.onProgression?.('composition', f),
    onEnvoi: () => { t4 = Date.now(); input.onProgression?.('envoi', 0); },
  });
  chrono.rendu = (t4 || Date.now()) - t3;
  chrono.envoi = t4 ? Date.now() - t4 : 0;
  const mesures = {
    RUSH_PREPARATION_MS: chrono.preparation,
    RUSH_ANALYSIS_MS: chrono.analyse,
    SMART_SELECTION_MS: chrono.selection,
    RENDER_PROXY_MS: proxyMs,
    RENDER_PROXIES_CREES: proxysCrees,
    RENDER_PROXIES_REUTILISES: proxysReutilises,
    REMOTION_RENDER_MS: chrono.rendu,
    MOTEUR_RENDU: moteur ?? 'REMOTION',
    // Jamais de repli muet : la raison exacte (échec, ou non applicable).
    ...(hybrideRaison ? { HYBRID_FALLBACK_REASON: hybrideRaison } : {}),
    ...(mesuresHybride?.tentativeMs !== undefined ? { HYBRID_ATTEMPT_MS: mesuresHybride.tentativeMs } : {}),
    ...(mesuresHybride && mesuresHybride.tentativeMs === undefined ? {
      HYBRID_STILLS_MS: mesuresHybride.stillsMs,
      HYBRID_COPY_MS: mesuresHybride.copieMs,
      HYBRID_FFMPEG_MS: mesuresHybride.ffmpegMs,
    } : {}),
    FINAL_UPLOAD_MS: chrono.envoi,
    TOTAL_MS: Date.now() - chrono.debut,
  };
  console.log(`${journal} ${userId} — mesures ${JSON.stringify(mesures)}`);
  input.onProgression?.('finalisation', 0);

  // ── CONSEILS (lecture seule) : ne modifient rien, ne bloquent jamais ──
  let conseils: RapportConseils | null = null;
  try {
    conseils = conseillerVideo({
      profil: profilVideo,
      textes: {
        profil: profilVideo,
        theme: contexteConseil.theme,
        objectif: contexteConseil.objectif,
        titre: design.title ?? null,
        sousTitre: design.subtitle ?? null,
        cartes: (design.cards ?? []).map((c) => ({ titre: c.title ?? c.label ?? null, valeur: c.value ?? null })),
        cta: design.ctaText ?? null,
        fenetres: overlays ? { titre: overlays.titre, cartes: overlays.cartes, cta: overlays.cta } : null,
      },
      plan: planMontageRushs,
      analyses: analysesRushs,
      rythme: rythmeVideo,
      lisibilite: mesuresTextes ?? null,
    });
  } catch (err) {
    console.warn(`${journal} ${userId} — conseils impossibles :`, err instanceof Error ? err.message : err);
  }

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
    // MULTI-SOURCES : ce qui a été combiné, pourquoi, et les crédits des médias
    // stock montés (auteur, licence, lien — exigés par Pexels / Unsplash).
    ...(multiSources ? {
      // Les fichiers VIDÉO réellement montés (ni l'avatar, ni les photos).
      ...(planMontageRushs ? { rushUrls: rushsDuPlan(planMontageRushs.filter((x) => x.kind !== 'image' && x.kind !== 'avatar')).map((r) => r.url) } : null),
      multiSources: {
        avatar: jumeauActif,
        rushesPersonnels: (planMontageRushs ?? []).filter((x) => x.source === 'rush').length,
        stockVideos: (planMontageRushs ?? []).filter((x) => x.source === 'stock').length,
        photos: (planMontageRushs ?? []).filter((x) => x.kind === 'image').length,
        explications: explicationsSources,
      },
      ...(stockUtilise.length ? { stockCredits: stockUtilise.map(({ url, provider, auteur, sourceUrl, licence }) => ({ url, provider, auteur, sourceUrl, licence })) } : null),
      ...(mediasIgnores.length ? { stockIgnores: mediasIgnores } : null),
    } : null),
    // Analyse impossible : montage simple — jamais en silence.
    ...(montageSimpleMotif ? { montageSimple: true, montageSimpleMotif } : null),
    // Textes en surimpression sur la vidéo continue (V3) : relus au rendu.
    ...(overlays ? { surimpressions: overlays } : null),
    // Profil et mesures du plan — les mêmes champs que Créer.
    ...(planMontageRushs ? { profilMontage: profilVideo } : null),
    ...(montageRapport ? { montageRapport } : null),
    ...(qualiteMontage ? { qualiteMontage: qualiteMontage.map(({ code, ok, detail }) => ({ code, ok, detail })) } : null),
    ...(montageRaccourci ? { montageRaccourci: { demande: montageRaccourci.demande, possible: montageRaccourci.possible, rushsAAjouter: montageRaccourci.supplementaires, message: montageRaccourci.message } } : null),
    // Rushes dont l'analyse a échoué (délai, fichier illisible) : dit.
    ...(analysesEchouees.length ? { analysesEchouees } : null),
    // Voix gratuite (Edge) utilisée faute d'ElevenLabs : dit, jamais caché.
    ...(Object.values(voices).some((v) => v?.repli === 'edge') ? { voixRepliEdge: true } : null),
    // Ce que l'utilisateur doit savoir, LU par le Calendrier — un montage du
    // cron n'a personne pour voir l'écran « Produire maintenant ».
    ...(() => {
      const a = avertissementsMontage({
        musiqueIntrouvable, audioSilencieux: !!audio?.silencieux,
        voixRepliEdge: Object.values(voices).some((v) => v?.repli === 'edge'),
        montageSimple: !!montageSimpleMotif, voixPersonnelle: !!(config.voiceId ?? '').trim(),
      });
      return a.length ? { avertissements: a } : null;
    })(),
    // Durées par étape (diagnostic performance, temporaire).
    mesuresRendu: mesures,
    // « Conseils pour améliorer cette vidéo » : mesurés, rien n'est appliqué.
    ...(conseils ? { conseils } : null),
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
  const coutRendu = typeof input.coutRendu === 'number' ? input.coutRendu : await coutMontage();
  try {
    // Référence stable : le `jobId`. Une relance sur le même job ne débite
    // pas une seconde fois — c'est exactement le cas que l'ancien débit non
    // idempotent laissait passer, et un cron se relance.
    await deductCredits(
      userId, coutRendu, 'render',
      referenceOperation('autopilote', jobId),
    );
  } catch (e) {
    // Le montage est livré : on ne le retire pas pour un débit manqué. On le
    // dit fort, c'est tout.
    debite = false;
    console.error(
      `${journal} debit manque pour ${userId} (${coutRendu} credits) :`,
      e instanceof Error ? e.message : e,
    );
  }

  // L'affiche IA, même règle : après le dépôt, best-effort, référence stable
  // par `jobId` — un créneau rejoué ne la débite pas deux fois.
  if (afficheIaADebiter) {
    let coutAffiche: number | null = null;
    try {
      coutAffiche = await coutAfficheReference();
      await deductCredits(userId, coutAffiche, 'ai', referenceOperation('autopilote-affiche', jobId));
    } catch (e) {
      console.error(`${journal} ${userId} — débit affiche IA manqué (${coutAffiche ?? '?'} crédits) :`, e instanceof Error ? e.message : e);
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
      voixPersonnelle: !!(config.voiceId ?? '').trim(),
    }),
  };
}
