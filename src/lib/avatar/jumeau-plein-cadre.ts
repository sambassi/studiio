/**
 * JUMEAU DÉJÀ STOCKÉ, BANDES INCRUSTÉES — la version PLEIN CADRE, sans
 * nouvelle génération.
 *
 * `retirerBandesIncrustees` (#555) corrige chaque NOUVELLE vidéo de jumeau au
 * rapatriement (`statut.ts`). Les jumeaux rapatriés AVANT gardent leurs bandes
 * dans le fichier, et chaque nouveau montage 9:16 les recopie. L'utilisateur
 * veut réutiliser SON jumeau actuel : ni nouvel appel fournisseur, ni crédit,
 * ni réentraînement.
 *
 * Ce module, appelé au moment de MONTER un jumeau stocké :
 *   - jumeau propre      → l'URL d'origine, rien n'est écrit ;
 *   - bandes incrustées  → une version DÉRIVÉE, recadrée localement (ffmpeg),
 *                          déposée à côté — l'original n'est jamais réécrit ;
 *   - déjà dérivée       → réutilisée (clé déterministe, aucun ffmpeg).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA CLÉ DÉRIVÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   source  : media/<userId>/avatar/<generationId>.mp4
 *   dérivée : media/<userId>/jumeaux-recadres/<9x16>/avatar/<generationId>.mp4
 *
 * - `<userId>/…` : MÊME espace que l'original. Le relais (#554,
 *   `lectureRelaisAutorisee`) la sert au propriétaire (session) ou sur jeton ;
 *   jamais à l'anonyme (`lectureAnonymeRelais` : seules les copies
 *   `externes/…` le sont). Lecture serveur au nom d'un autre compte : refusée
 *   (`cibleLisibleParCompte`, #546).
 * - Déterministe : aucune métadonnée, aucune migration — la présence de
 *   l'objet EST le cache.
 * - Se termine par `/avatar/<generationId>.mp4` : `generationDepuisRush`, le
 *   contrôle de version, la détection « la vidéo parle déjà » (pas de double
 *   narration) et la liste des médias la reconnaissent comme LE jumeau.
 *
 * Aucune dépendance au fournisseur (HeyGen, D-ID) ni aux crédits : ce module
 * ne les importe pas. Ne lève jamais — tout échec rend l'URL d'origine.
 */

import { mediaLisiblePar, objetDeUrlPublique } from '@/lib/creer/analyse-rush-serveur';
import { cibleLisibleParCompte } from '@/lib/storage/acces-objet';
import { retirerBandesIncrustees, type ResultatCadrage } from '@/lib/avatar/cadrage-jumeau';

export const BUCKET_JUMEAUX = 'media';
export const DOSSIER_JUMEAUX_RECADRES = 'jumeaux-recadres';
/** Au-delà, la vidéo n'est pas chargée en mémoire : l'original est gardé. */
export const TAILLE_MAX_JUMEAU = 200 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIXE_PUBLIC = '/storage/v1/object/public/';

/** Formats acceptés et leur segment de clé. */
const SEGMENTS_RATIO: Record<string, string> = { '9:16': '9x16', '16:9': '16x9', '1:1': '1x1', '4:5': '4x5' };

/** `9:16` / `reel` / `1080:1920` → `9:16` (forme réduite) ; `null` hors liste. Pure. */
export function ratioNormalise(format: unknown): string | null {
  if (format === 'reel') return '9:16';
  if (format === 'tv') return '16:9';
  if (typeof format !== 'string') return null;
  const m = /^\s*(\d{1,5})\s*[:x/]\s*(\d{1,5})\s*$/.exec(format);
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[2]);
  if (!(a > 0 && b > 0)) return null;
  const pgcd = (x: number, y: number): number => (y === 0 ? x : pgcd(y, x % y));
  const d = pgcd(a, b);
  const r = `${a / d}:${b / d}`;
  return r in SEGMENTS_RATIO ? r : null;
}

/** Clé de la version plein cadre d'une génération. Pure. */
export function cleJumeauPleinCadre(userId: string, generationId: string, ratio: string): string {
  return `${userId}/${DOSSIER_JUMEAUX_RECADRES}/${SEGMENTS_RATIO[ratio]}/avatar/${generationId}.mp4`;
}

export type CibleJumeau =
  | { genre: 'refus' }
  | { genre: 'autre' }
  | { genre: 'source'; cle: string; generationId: string }
  | { genre: 'derivee'; cle: string };

/**
 * Que désigne cette URL, pour CE compte ? Pure.
 *   - `refus`   : média d'un autre compte, namespace privé, chemin tordu —
 *                 jamais lu, jamais signé (#546) ;
 *   - `autre`   : pas une vidéo de jumeau de notre stockage (rush, stock…) ;
 *   - `source`  : `<userId>/avatar/<uuid>.mp4` de CE compte ;
 *   - `derivee` : déjà une version plein cadre de CE compte.
 */
export function cibleJumeau(url: unknown, userId: unknown): CibleJumeau {
  if (typeof url !== 'string' || url.length === 0 || typeof userId !== 'string' || userId.length === 0) return { genre: 'refus' };
  if (!mediaLisiblePar(url, userId)) return { genre: 'refus' };
  const objet = objetDeUrlPublique(url.replace(/[?#].*$/s, ''));
  if (!objet || objet.bucket !== BUCKET_JUMEAUX) return { genre: 'autre' };
  if (!cibleLisibleParCompte(objet.bucket, objet.cle, userId)) return { genre: 'refus' };
  const s = objet.cle.split('/');
  const gen = /^(.+)\.mp4$/.exec(s[s.length - 1] ?? '')?.[1] ?? '';
  if (!UUID.test(gen) || s[0] !== userId) return { genre: 'autre' };
  if (s.length === 3 && s[1] === 'avatar') return { genre: 'source', cle: objet.cle, generationId: gen };
  if (s.length === 5 && s[1] === DOSSIER_JUMEAUX_RECADRES && Object.values(SEGMENTS_RATIO).includes(s[2]) && s[3] === 'avatar') {
    return { genre: 'derivee', cle: objet.cle };
  }
  return { genre: 'autre' };
}

/** L'URL de la clé dérivée, dans la MÊME forme (origine, relais) que la source. Pure. */
export function urlDerivee(urlSource: string, cleDerivee: string): string {
  const sans = urlSource.replace(/[?#].*$/s, '');
  const i = sans.indexOf(PREFIXE_PUBLIC);
  return `${sans.slice(0, i)}${PREFIXE_PUBLIC}${BUCKET_JUMEAUX}/${cleDerivee}`;
}

export interface DepotJumeaux {
  existe(bucket: string, cle: string): Promise<boolean>;
  /** Le fichier entier, ou `null` s'il dépasse `max` octets. */
  lire(bucket: string, cle: string, max: number): Promise<Buffer | null>;
  ecrire(bucket: string, cle: string, contenu: Buffer): Promise<void>;
}

async function depotParDefaut(): Promise<DepotJumeaux> {
  const { clientMinio, lecteurMinio } = await import('@/lib/storage/minio-client');
  return {
    existe: (b, c) => clientMinio({ timeoutMs: 10_000 }).statObject(b, c).then(() => true, () => false),
    async lire(b, c, max) {
      // Lecture INTERNE (MinIO en direct), jamais par le relais public.
      const { size } = await clientMinio({ timeoutMs: 10_000 }).statObject(b, c);
      if (!(size > 0) || size > max) return null;
      const flux = await lecteurMinio({ timeoutMs: 120_000 }).getObject(b, c);
      const morceaux: Buffer[] = [];
      let total = 0;
      for await (const m of flux as AsyncIterable<Buffer>) {
        total += m.length;
        if (total > max) { (flux as unknown as { destroy?: () => void }).destroy?.(); return null; }
        morceaux.push(Buffer.from(m));
      }
      return Buffer.concat(morceaux);
    },
    async ecrire(b, c, contenu) {
      await clientMinio().putObject(b, c, contenu, contenu.length, { 'Content-Type': 'video/mp4' });
    },
  };
}

/** Le dépôt interne (MinIO direct) — partagé avec la mesure de durée du jumeau (`duree-jumeau.ts`). */
export const depotJumeauxParDefaut = depotParDefaut;

export type StatutPleinCadre = 'refus' | 'autre' | 'original' | 'derive' | 'derive-existant' | 'deja-plein-cadre' | 'echec';

export interface ResultatPleinCadre {
  /** L'URL à monter ; `null` seulement sur refus. */
  url: string | null;
  statut: StatutPleinCadre;
}

export interface OptionsPleinCadre {
  depot?: DepotJumeaux;
  recadrer?: (buffer: Buffer, opts: { aspectRatio?: unknown }) => Promise<ResultatCadrage>;
}

/** Jumeaux vérifiés PROPRES (clé|ratio) : le contrôle ffmpeg n'est pas refait. Borné. */
const propres = new Set<string>();
const PROPRES_MAX = 1000;
/** Une seule correction par clé dérivée à la fois (deux montages simultanés). */
const enCours = new Map<string, Promise<ResultatPleinCadre>>();

/** Tests uniquement. */
export function oublierCachePleinCadre(): void { propres.clear(); enCours.clear(); }

/**
 * L'URL de jumeau à MONTER pour ce format, au nom de `userId`. Ne lève jamais.
 */
export async function jumeauPleinCadre(
  args: { url: string; userId: string; format: unknown },
  opts: OptionsPleinCadre = {},
): Promise<ResultatPleinCadre> {
  const { url, userId } = args;
  const cible = cibleJumeau(url, userId);
  if (cible.genre === 'refus') return { url: null, statut: 'refus' };
  if (cible.genre === 'autre') return { url, statut: 'autre' };
  if (cible.genre === 'derivee') return { url, statut: 'deja-plein-cadre' };
  const ratio = ratioNormalise(args.format);
  if (!ratio) return { url, statut: 'original' };
  const marque = `${cible.cle}|${ratio}`;
  if (propres.has(marque)) return { url, statut: 'original' };
  const cleDerivee = cleJumeauPleinCadre(userId, cible.generationId, ratio);
  const deja = enCours.get(cleDerivee);
  if (deja) return deja;
  const travail = (async (): Promise<ResultatPleinCadre> => {
    try {
      const depot = opts.depot ?? await depotParDefaut();
      if (await depot.existe(BUCKET_JUMEAUX, cleDerivee)) return { url: urlDerivee(url, cleDerivee), statut: 'derive-existant' };
      const source = await depot.lire(BUCKET_JUMEAUX, cible.cle, TAILLE_MAX_JUMEAU);
      if (!source || source.length === 0) return { url, statut: 'original' };
      const recadrer = opts.recadrer ?? retirerBandesIncrustees;
      const r = await recadrer(source, { aspectRatio: ratio });
      if (!r.corrige) {
        if (propres.size >= PROPRES_MAX) propres.clear();
        propres.add(marque);
        return { url, statut: 'original' };
      }
      await depot.ecrire(BUCKET_JUMEAUX, cleDerivee, r.buffer);
      console.log('[Jumeau][plein-cadre] version dérivée déposée', JSON.stringify({ generationId: cible.generationId, ratio }));
      return { url: urlDerivee(url, cleDerivee), statut: 'derive' };
    } catch (e) {
      console.warn('[Jumeau][plein-cadre] contrôle impossible, original gardé :', e instanceof Error ? e.message : e);
      return { url, statut: 'echec' };
    }
  })().finally(() => enCours.delete(cleDerivee));
  enCours.set(cleDerivee, travail);
  return travail;
}
