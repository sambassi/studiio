/**
 * M2-a — Fiches de contenu côté SERVEUR : indices réels + cache DURABLE.
 *
 * Où vit la fiche : `media/fiches-contenu/<userId>/analyse/<sha1>.<taille>.v1.json`
 *   - `<userId>` est celui de la SESSION (jamais une valeur du client) ;
 *   - `<sha1>` = empreinte de `bucket/clé` de l'objet, `<taille>` = sa taille
 *     relue chez MinIO : un fichier remplacé (autre taille) a une autre fiche ;
 *   - le segment `analyse` place la fiche dans le namespace PRIVÉ des
 *     analyses : le relais public la refuse (404, `cleDansNamespaceAnalyse`)
 *     et aucune lecture « au nom d'un compte » ne l'atteint
 *     (`cibleLisibleParCompte`). Seul ce module la lit, avec la clé qu'il
 *     dérive lui-même ;
 *   - hors des dossiers `<userId>/` : aucun envoi navigateur ne peut l'écrire,
 *     et la rétention temporaire l'épargne (`estFichierDurable`).
 *
 * Lecture AVANT tout calcul : la 2e ouverture relit la fiche, ne recalcule
 * rien. Toute panne (MinIO absent, délai, JSON invalide) → fiche calculée en
 * mémoire, jamais d'erreur visible, jamais de blocage. Aucun appel réseau
 * hors MinIO, aucun fournisseur IA.
 */
import { createHash } from 'crypto';
import { classerUrlLecture } from '@/lib/creer/analyse-rush-serveur';
import {
  ficheContenuRush,
  ficheContenuValide,
  completerParole,
  type FicheContenuRush,
  type IndicesContenu,
} from '@/lib/creer/fiche-contenu';

export const BUCKET_FICHES = 'media';
export const PREFIXE_FICHES = 'fiches-contenu';
/** Délai d'UNE requête MinIO (petits objets JSON). */
export const DELAI_MINIO_FICHE_MS = 2500;
const TAILLE_JSON_MAX = 64 * 1024;

/** Absent : l'objet n'existe pas (distinct d'une panne, qui lève). */
export const ABSENT = Symbol('absent');

export interface StockageFiches {
  /** Taille de l'objet, `ABSENT` s'il n'existe pas ; lève sur panne. */
  taille(bucket: string, cle: string): Promise<number | typeof ABSENT>;
  /** JSON de l'objet, `ABSENT` s'il n'existe pas ; lève sur panne. */
  lireJson(bucket: string, cle: string): Promise<unknown | typeof ABSENT>;
  ecrireJson(bucket: string, cle: string, valeur: unknown): Promise<void>;
}

const estAbsent = (e: unknown) => {
  const code = (e as { code?: string })?.code ?? '';
  const message = e instanceof Error ? e.message : String(e);
  return code === 'NoSuchKey' || code === 'NotFound' || /not found|does not exist|NoSuchKey/i.test(message);
};

/** Le stockage réel : MinIO en direct, chaque requête bornée. */
export function stockageFichesMinio(): StockageFiches {
  const borne = { timeoutMs: DELAI_MINIO_FICHE_MS };
  return {
    async taille(bucket, cle) {
      const { clientMinio } = await import('@/lib/storage/minio-client');
      try {
        const s = await clientMinio(borne).statObject(bucket, cle);
        return typeof s?.size === 'number' ? s.size : ABSENT;
      } catch (e) {
        if (estAbsent(e)) return ABSENT;
        throw e;
      }
    },
    async lireJson(bucket, cle) {
      const { lecteurMinio } = await import('@/lib/storage/minio-client');
      let flux: NodeJS.ReadableStream;
      try {
        flux = await lecteurMinio(borne).getObject(bucket, cle);
      } catch (e) {
        if (estAbsent(e)) return ABSENT;
        throw e;
      }
      const morceaux: Buffer[] = [];
      let total = 0;
      for await (const m of flux as AsyncIterable<Buffer | string>) {
        const b = typeof m === 'string' ? Buffer.from(m) : m;
        total += b.length;
        if (total > TAILLE_JSON_MAX) throw new Error('fiche trop grande');
        morceaux.push(b);
      }
      return JSON.parse(Buffer.concat(morceaux).toString('utf8'));
    },
    async ecrireJson(bucket, cle, valeur) {
      const { clientMinio } = await import('@/lib/storage/minio-client');
      const corps = Buffer.from(JSON.stringify(valeur));
      await clientMinio(borne).putObject(bucket, cle, corps, corps.length, { 'Content-Type': 'application/json' });
    },
  };
}

/** Clé de la fiche d'un objet. Pure ; `userId` = celui de la session. */
export function cleFicheContenu(userId: string, bucket: string, cleObjet: string, taille: number, version: 1 | 2 = 1): string {
  const empreinte = createHash('sha1').update(`${bucket}/${cleObjet}`).digest('hex');
  return `${PREFIXE_FICHES}/${userId}/analyse/${empreinte}.${Math.max(0, Math.floor(taille))}.v${version}.json`;
}

/**
 * M2-b — Le registre de consentement à l'analyse IA du compte. Même espace
 * privé que les fiches (`fiches-contenu/<userId>/analyse/…`) : refusé par le
 * relais public, illisible au nom d'un autre compte, et PURGÉ avec le reste
 * du compte par la suppression RGPD (`prefixesStockageDuCompte`).
 */
export function cleConsentementIA(userId: string): string {
  return `${PREFIXE_FICHES}/${userId}/analyse/consentement-ia.json`;
}

const NOM_STOCK_PEXELS = /^stock-pexels-(video|photo)-[A-Za-z0-9_-]+\.(mp4|jpg)$/;

/** Attribution stock d'un fichier de la Médiathèque du compte, ou `null`. */
function lireAttribution(brut: unknown): IndicesContenu['pexels'] {
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return null;
  const a = brut as Record<string, unknown>;
  if (a.provider !== 'pexels') return null;
  const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null);
  return { description: txt(a.description, 300), requete: txt(a.requete, 120), sourceUrl: txt(a.sourceUrl, 512) };
}

export interface OptionsFiche {
  stockage?: StockageFiches;
  /** Énergie audio DÉJÀ mesurée de ce rush (parole), si connue. */
  energieAudio?: number[] | null;
  /** Recalculer et réécrire même si une fiche existe (import : l'attribution vient d'être écrite). */
  recalculer?: boolean;
  /** Journal de test : compte les calculs. */
  onCalcul?: () => void;
}

export interface ResultatFiche {
  fiche: FicheContenuRush;
  depuisCache: boolean;
}

/**
 * La fiche d'un rush, AU NOM de `userId` (session). `null` si l'URL est
 * refusée pour ce compte (objet d'un autre compte, namespace privé…) : rien
 * n'est lu, rien n'est dit.
 */
export async function ficheContenuServeur(url: string, userId: string, o: OptionsFiche = {}): Promise<ResultatFiche | null> {
  if (typeof url !== 'string' || !url || typeof userId !== 'string' || !userId || userId.includes('/')) return null;
  const classe = classerUrlLecture(url, userId);
  if (classe.genre === 'refus') return null;
  const nomUrl = (() => { try { return decodeURIComponent((url.split(/[?#]/)[0].split('/').pop() ?? '')); } catch { return ''; } })();
  const calculer = (indices: IndicesContenu) => { o.onCalcul?.(); return ficheContenuRush({ ...indices, energieAudio: o.energieAudio ?? null }); };

  // Média hors de notre stockage : son nom seul, en mémoire (aucune lecture distante).
  if (classe.genre === 'externe') return { fiche: calculer({ nomFichier: nomUrl }), depuisCache: false };

  const { bucket, cle } = classe;
  const nom = cle.split('/').pop() ?? '';
  let stockage: StockageFiches;
  try { stockage = o.stockage ?? stockageFichesMinio(); } catch { return { fiche: calculer({ nomFichier: nom }), depuisCache: false }; }

  let cleFiche: string | null = null;
  try {
    const t = await stockage.taille(bucket, cle);
    if (t !== ABSENT) cleFiche = cleFicheContenu(userId, bucket, cle, t);
  } catch { cleFiche = null; }

  if (cleFiche && !o.recalculer) {
    try {
      const relue = await stockage.lireJson(BUCKET_FICHES, cleFiche);
      if (relue !== ABSENT && ficheContenuValide(relue)) {
        return { fiche: completerParole(relue, o.energieAudio), depuisCache: true };
      }
    } catch { /* cache illisible : on calcule */ }
  }

  // Indices : l'attribution Pexels d'un fichier de la Médiathèque de CE compte.
  let pexels: IndicesContenu['pexels'] = null;
  let indicesComplets = true;
  if (bucket === 'media' && NOM_STOCK_PEXELS.test(nom) && cle === `${userId}/library/${nom}`) {
    try {
      const a = await stockage.lireJson('media', `stock-attributions/${userId}/${nom}.json`);
      pexels = a === ABSENT ? null : lireAttribution(a);
    } catch {
      indicesComplets = false; // panne : la fiche ne doit pas être figée sans l'attribution
    }
  }
  const fiche = calculer({ pexels, nomFichier: nom });
  if (cleFiche && indicesComplets) {
    try { await stockage.ecrireJson(BUCKET_FICHES, cleFiche, fiche); } catch { /* jamais bloquant */ }
  }
  return { fiche, depuisCache: false };
}

/**
 * Fiches de plusieurs rushes, une à la fois (charge MinIO minimale), sous un
 * délai global : passé `delaiMs`, les fiches manquantes valent `null`.
 * Jamais d'exception.
 */
export async function fichesContenuServeur(
  urls: ReadonlyArray<string>,
  userId: string,
  o: { stockage?: StockageFiches; energies?: ReadonlyMap<string, number[]>; delaiMs?: number; onCalcul?: () => void } = {},
): Promise<Array<{ url: string; fiche: FicheContenuRush | null; depuisCache: boolean }>> {
  const uniques = [...new Set(urls.filter((u) => typeof u === 'string' && u))];
  const out = new Map<string, { fiche: FicheContenuRush | null; depuisCache: boolean }>();
  const travail = (async () => {
    for (const u of uniques) {
      try {
        const r = await ficheContenuServeur(u, userId, { stockage: o.stockage, energieAudio: o.energies?.get(u) ?? null, onCalcul: o.onCalcul });
        out.set(u, r ? { fiche: r.fiche, depuisCache: r.depuisCache } : { fiche: null, depuisCache: false });
      } catch {
        out.set(u, { fiche: null, depuisCache: false });
      }
    }
  })();
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([travail, new Promise<void>((r) => { minuterie = setTimeout(r, o.delaiMs ?? 4000); })]);
  if (minuterie) clearTimeout(minuterie);
  return uniques.map((url) => ({ url, ...(out.get(url) ?? { fiche: null, depuisCache: false }) }));
}
