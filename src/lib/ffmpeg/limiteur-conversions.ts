/**
 * Plafonds de `POST /api/convert/to-mp4` : combien de conversions tournent à
 * la fois, et quelle taille de source on accepte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une conversion = un téléchargement sur le disque temporaire + un ffmpeg
 * `-threads 0 -preset ultrafast` (il prend TOUS les cœurs) + la sortie lue
 * entière en mémoire avant dépôt. Sans plafond, un compte connecté pouvait en
 * lancer N en parallèle et saturer le VPS (4 CPU / 7,7 Go, PARTAGÉS avec
 * d'autres applications).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES CHIFFRES
 * ─────────────────────────────────────────────────────────────────────────
 *
 * - 1 conversion à la fois PAR COMPTE : l'export Bureau et le Calendrier
 *   n'en lancent qu'une par clic, et attendent la réponse.
 * - 2 conversions à la fois PAR PROCESSUS : deux ffmpeg `-threads 0` se
 *   partagent les 4 cœurs (chacun ralentit, aucun ne s'emballe) ; mémoire au
 *   pire ≈ 2 × (sortie ≤ source 300 Mo + ffmpeg ~300 Mo) ≈ 1,2 Go sur 7,7 Go.
 *   À 1, deux utilisateurs qui exportent à la même minute se gêneraient ;
 *   à 3+, les autres applications du VPS n'auraient plus de CPU.
 * - Source ≤ 300 Mio : le Bureau enregistre en WebM à 12 Mbit/s vidéo
 *   (`video-composer.ts`, MediaRecorder `videoBitsPerSecond: 12_000_000`)
 *   + ~128 kbit/s audio ≈ 1,52 Mo/s. 3 min (format court le plus long visé)
 *   × 1,52 Mo/s × 1,1 (conteneur, pics VBR) ≈ 300 Mo ≈ 286 Mio. La borne
 *   générique du stockage (512 Mio) reste celle des autres usages.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE COMPTEUR N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un compteur EN MÉMOIRE DU PROCESSUS, sans Redis ni base : la prod n'a
 * qu'une instance applicative. Pendant un déploiement progressif (deux
 * conteneurs quelques minutes), le plafond est au plus doublé — acceptable.
 * Il est rangé sur `globalThis` pour qu'un double chargement du module dans
 * le même processus (HMR, bundles distincts) partage le MÊME compteur.
 *
 * Le jeton se libère quand le gestionnaire de route se termine (`finally`) :
 * succès, erreur, délai dépassé. Si le client abandonne (`req.signal`),
 * ffmpeg est TUÉ (signal transmis à `execFile`) et le jeton revient dès que
 * le processus est réellement terminé — jamais avant : tant qu'un travail
 * tourne, il garde son jeton. Un téléchargement en cours, lui, va à sa fin
 * (borné à 120 s) puis la route s'arrête sans lancer ffmpeg.
 *
 * Le cron de publication a sa propre conversion (`api/cron/publish`) et
 * n'est PAS soumis à ce limiteur : il est appelé par le planificateur, une
 * publication à la fois, pas par un navigateur.
 */

export const CONVERSIONS_MAX_PAR_COMPTE = 1;
export const CONVERSIONS_MAX_PROCESSUS = 2;
/** Indication `Retry-After`, en secondes. Une conversion type dure 30 s à 3 min. */
export const RETRY_AFTER_CONVERSION_S = 30;
/** Taille maximale PAR DÉFAUT d'une SOURCE de conversion, en octets (voir plus haut). */
export const TAILLE_MAX_SOURCE_CONVERSION = 300 * 1024 * 1024;

/**
 * Réglage serveur du plafond : `STUDIIO_CONVERSION_MAX_OCTETS` (entier,
 * en octets). Acceptée seulement dans [1 Mio, 512 Mio] :
 * - plancher 1 Mio : en dessous, aucun export réel ne passerait — c'est une
 *   faute de frappe, pas un réglage ;
 * - plafond 512 Mio : c'est la borne du relais de téléversement
 *   (`TAILLE_MAXIMALE`, `rendus/cible-upload.ts`) — au-delà, la source ne
 *   pourrait même pas être déposée, et la sortie lue en mémoire doublerait.
 * Absente, vide, non entière, hors bornes → 300 Mio. JAMAIS « illimité ».
 */
export const VARIABLE_TAILLE_MAX_CONVERSION = 'STUDIIO_CONVERSION_MAX_OCTETS';
export const TAILLE_MAX_CONVERSION_PLANCHER = 1 * 1024 * 1024;
export const TAILLE_MAX_CONVERSION_PLAFOND = 512 * 1024 * 1024;

export function tailleMaxSourceConversion(
  env: Record<string, string | undefined> = process.env,
): number {
  const brut = env[VARIABLE_TAILLE_MAX_CONVERSION]?.trim();
  if (!brut || !/^\d+$/.test(brut)) return TAILLE_MAX_SOURCE_CONVERSION;
  const n = Number(brut);
  if (!Number.isSafeInteger(n) || n < TAILLE_MAX_CONVERSION_PLANCHER || n > TAILLE_MAX_CONVERSION_PLAFOND) {
    return TAILLE_MAX_SOURCE_CONVERSION;
  }
  return n;
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * COMBIEN DE TEMPS LE NAVIGATEUR DOIT ATTENDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Pire cas serveur = téléchargement (120 s, `DELAI_TELECHARGEMENT_MS`) +
 * échelle ffmpeg (240 + 180 + 120 s, `DUREE_MAX_ECHELLE_MS`) + dépôt
 * (120 s, `DELAI_DEPOT_MS`) = 780 s. Le client attend AU-DELÀ (+ 60 s) :
 * il ne renonce donc jamais avant la fin réelle du travail, et ne relance
 * jamais une conversion que le serveur fait encore (ce qui lui vaudrait un
 * 429). Choisi plutôt que de raccourcir l'échelle : aucune conversion
 * légitime n'est tuée, et le cron (même échelle) n'est pas touché.
 * Un test garde ces trois délais synchronisés avec leurs sources.
 */
export const DELAI_DEPOT_MS = 120_000;
export const PIRE_CAS_SERVEUR_CONVERSION_MS = 120_000 + 540_000 + DELAI_DEPOT_MS;
export const ATTENTE_CLIENT_CONVERSION_MS = PIRE_CAS_SERVEUR_CONVERSION_MS + 60_000;

export const MESSAGE_CONVERSION_EN_COURS =
  'Une conversion est déjà en cours sur votre compte. Patientez quelques instants, puis réessayez.';
export const MESSAGE_SERVEUR_OCCUPE =
  'Le serveur convertit déjà d\'autres vidéos. Réessayez dans quelques instants.';

export type JetonConversion =
  | { ok: true; liberer: () => void }
  | { ok: false; motif: 'compte' | 'global' };

export interface LimiteurConversions {
  acquerir(userId: string): JetonConversion;
  /** Lecture seule, pour les tests et le diagnostic. */
  etat(): { global: number; comptes: number };
}

export function creerLimiteurConversions(
  { maxParCompte, maxGlobal }: { maxParCompte: number; maxGlobal: number },
): LimiteurConversions {
  const parCompte = new Map<string, number>();
  let global = 0;

  return {
    acquerir(userId: string): JetonConversion {
      const actuel = parCompte.get(userId) ?? 0;
      // Le compte d'abord : son propre double-clic doit lire « déjà en cours ».
      if (actuel >= maxParCompte) return { ok: false, motif: 'compte' };
      if (global >= maxGlobal) return { ok: false, motif: 'global' };

      parCompte.set(userId, actuel + 1);
      global += 1;

      let libere = false;
      return {
        ok: true,
        // Idempotent : un double appel ne rend jamais le jeton d'un autre.
        liberer: () => {
          if (libere) return;
          libere = true;
          global = Math.max(0, global - 1);
          const n = (parCompte.get(userId) ?? 1) - 1;
          if (n <= 0) parCompte.delete(userId);
          else parCompte.set(userId, n);
        },
      };
    },
    etat: () => ({ global, comptes: parCompte.size }),
  };
}

const CLE_GLOBALE = Symbol.for('studiio.limiteurConversionsMp4');
type AvecLimiteur = typeof globalThis & { [CLE_GLOBALE]?: LimiteurConversions };

/** LE limiteur du processus, partagé par tous les appels de la route. */
export function limiteurConversions(): LimiteurConversions {
  const g = globalThis as AvecLimiteur;
  if (!g[CLE_GLOBALE]) {
    g[CLE_GLOBALE] = creerLimiteurConversions({
      maxParCompte: CONVERSIONS_MAX_PAR_COMPTE,
      maxGlobal: CONVERSIONS_MAX_PROCESSUS,
    });
  }
  return g[CLE_GLOBALE];
}
