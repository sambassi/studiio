/**
 * StockMediaService — recherche, cache, classement, sélection.
 *
 * ⚠️ JAMAIS BLOQUANT. Un fournisseur qui refuse, dépasse son quota ou ne
 * répond pas devient un `echec` dans le résultat ; les autres résultats
 * restent, et aucune fonction d'ici ne lève d'exception vers l'appelant. Le
 * stock est un COMPLÉMENT, jamais une dépendance critique.
 *
 * ⚠️ CACHE LÉGER EN MÉMOIRE (pas de migration). Dix recherches identiques pour
 * une même séquence n'interrogent le fournisseur qu'une fois ; deux demandes
 * simultanées partagent la même promesse. Seuls les succès sont gardés.
 *
 * ⚠️ MÉTADONNÉES SEULEMENT. La recherche ne télécharge aucun fichier HD :
 * vignettes et aperçus pour la grille ; le fichier n'est rapatrié qu'à la
 * sélection réelle (`/api/stock/importer`).
 */
import {
  ErreurFournisseurStock,
  dependancesParDefaut,
  rechercherPexels,
  rechercherUnsplash,
  type DependancesStock,
  type ParametresAdaptateur,
} from './fournisseurs';
import { motsCles, motsDe } from './requetes';
import {
  CAPACITES_FOURNISSEUR,
  orientationDuFormat,
  type EchecStock,
  type FormatStock,
  type FournisseurStock,
  type MediaStock,
  type OrientationStock,
  type ResultatRechercheStock,
  type TypeStock,
} from './types';

// ─────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────

export const CACHE_STOCK_TTL_MS = 15 * 60 * 1000;
const CACHE_STOCK_MAX = 300;

export class CacheStock {
  private entrees = new Map<string, { expire: number; valeur: Promise<MediaStock[]> }>();
  constructor(private readonly maintenant: () => number = () => Date.now()) {}

  obtenir(cle: string, charger: () => Promise<MediaStock[]>): Promise<MediaStock[]> {
    const t = this.maintenant();
    const e = this.entrees.get(cle);
    if (e && e.expire > t) return e.valeur;
    const valeur = charger();
    this.entrees.set(cle, { expire: t + CACHE_STOCK_TTL_MS, valeur });
    // Un échec n'est jamais gardé : la prochaine demande réessaie.
    valeur.catch(() => { if (this.entrees.get(cle)?.valeur === valeur) this.entrees.delete(cle); });
    if (this.entrees.size > CACHE_STOCK_MAX) {
      const plusVieille = this.entrees.keys().next().value;
      if (plusVieille !== undefined) this.entrees.delete(plusVieille);
    }
    return valeur;
  }

  vider(): void { this.entrees.clear(); }
}

/** Le cache du processus — partagé par Créer et l'Autopilote. */
export const cacheStockPartage = new CacheStock();

export function cleCache(provider: FournisseurStock, p: ParametresAdaptateur): string {
  return [provider, p.type, p.orientation, p.page, p.parPage, motsDe(p.requete).join(' ')].join('|');
}

// ─────────────────────────────────────────────────────────────────────────
// Classement
// ─────────────────────────────────────────────────────────────────────────

export interface CritereClassement {
  format: FormatStock;
  type: TypeStock;
  /** Mots de la recherche : un média dont la description les reprend passe devant. */
  requete?: string;
  /** Médias déjà utilisés / proposés : jamais répétés. */
  exclus?: ReadonlySet<string>;
}

function scoreOrientation(o: OrientationStock, voulue: OrientationStock): number {
  if (o === voulue) return 3;
  if (o === 'square' || voulue === 'square') return 1;
  return 0;
}

export function scoreMedia(m: MediaStock, c: CritereClassement): number {
  let s = scoreOrientation(m.orientation, orientationDuFormat(c.format));
  if (m.type !== c.type) s -= 4;
  const cles = motsCles(c.requete ?? '');
  if (cles.length) {
    const desc = new Set(motsDe(m.description));
    s += Math.min(3, cles.filter((k) => desc.has(k) || desc.has(`${k}s`) || desc.has(k.replace(/e$/, 'ing'))).length);
  }
  if (m.type === 'video' && m.dureeSecondes != null) {
    if (m.dureeSecondes < 3) s -= 2;
    else if (m.dureeSecondes <= 40) s += 1;
  }
  if (Math.min(m.largeur, m.hauteur) >= 720) s += 0.5;
  return s;
}

/**
 * Classe sans rien exclure d'autre que les doublons et les médias déjà pris :
 * un média paysage reste proposé en 9:16 (le recadrage #540 l'adapte), il
 * passe simplement après les verticaux.
 */
export function rankStockResults(medias: ReadonlyArray<MediaStock>, c: CritereClassement): MediaStock[] {
  const vus = new Set<string>();
  const uniques: Array<{ m: MediaStock; s: number; i: number }> = [];
  medias.forEach((m, i) => {
    if (vus.has(m.id) || c.exclus?.has(m.id)) return;
    vus.add(m.id);
    uniques.push({ m, s: scoreMedia(m, c), i });
  });
  return uniques.sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.m);
}

// ─────────────────────────────────────────────────────────────────────────
// Recherche
// ─────────────────────────────────────────────────────────────────────────

export interface DemandeRechercheStock {
  requete: string;
  type: TypeStock;
  format: FormatStock;
  fournisseurs?: FournisseurStock[];
  page?: number;
  parPage?: number;
  exclus?: ReadonlySet<string>;
}

export const MAX_PAR_PAGE_STOCK = 15;
export const MAX_LONGUEUR_REQUETE_STOCK = 80;

const ADAPTATEURS: Record<FournisseurStock, typeof rechercherPexels> = {
  pexels: rechercherPexels,
  unsplash: rechercherUnsplash,
};

function entrelacer<T>(listes: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...listes.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of listes) if (i < l.length) out.push(l[i]);
  return out;
}

export async function searchStockMedia(
  d: DemandeRechercheStock,
  deps: DependancesStock = dependancesParDefaut(),
  cache: CacheStock = cacheStockPartage,
): Promise<ResultatRechercheStock> {
  const requete = (d.requete || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LONGUEUR_REQUETE_STOCK);
  if (!requete) return { medias: [], echecs: [], requete };
  // Unsplash n'est jamais interrogé pour une vidéo.
  const fournisseurs = (d.fournisseurs?.length ? d.fournisseurs : (['pexels', 'unsplash'] as FournisseurStock[]))
    .filter((f, i, t) => t.indexOf(f) === i && CAPACITES_FOURNISSEUR[f]?.includes(d.type));
  const p: ParametresAdaptateur = {
    requete,
    type: d.type,
    orientation: orientationDuFormat(d.format),
    parPage: Math.min(Math.max(d.parPage ?? 12, 1), MAX_PAR_PAGE_STOCK),
    page: Math.max(1, Math.floor(d.page ?? 1)),
  };
  const reponses = await Promise.allSettled(
    fournisseurs.map((f) => cache.obtenir(cleCache(f, p), () => ADAPTATEURS[f](p, deps))),
  );
  const echecs: EchecStock[] = [];
  const listes: MediaStock[][] = [];
  reponses.forEach((r, i) => {
    if (r.status === 'fulfilled') listes.push(r.value);
    else echecs.push({ provider: fournisseurs[i], motif: r.reason instanceof ErreurFournisseurStock ? r.reason.motif : 'indisponible' });
  });
  const medias = rankStockResults(entrelacer(listes), { format: d.format, type: d.type, requete, exclus: d.exclus });
  return { medias, echecs, requete };
}

// ─────────────────────────────────────────────────────────────────────────
// Combler les manques
// ─────────────────────────────────────────────────────────────────────────

export interface ManqueAChercher {
  cle: string;
  type: TypeStock;
  searchQueries: string[];
}

export interface PropositionStock {
  cle: string;
  media: MediaStock | null;
  requete: string | null;
}

/**
 * Un média par manque — la première requête qui donne un résultat non encore
 * pris. Jamais d'exception : un fournisseur en panne laisse le manque vide
 * (`media: null`) et l'appelant continue avec les rushes qu'il a.
 */
export async function selectStockForMissingCoverage(
  manques: ReadonlyArray<ManqueAChercher>,
  format: FormatStock,
  chercher: (d: DemandeRechercheStock) => Promise<ResultatRechercheStock> = (d) => searchStockMedia(d),
): Promise<{ propositions: PropositionStock[]; echecs: EchecStock[] }> {
  const pris = new Set<string>();
  const echecs: EchecStock[] = [];
  const propositions: PropositionStock[] = [];
  for (const m of manques) {
    let choisi: PropositionStock = { cle: m.cle, media: null, requete: null };
    for (const requete of m.searchQueries) {
      let r: ResultatRechercheStock;
      try {
        r = await chercher({ requete, type: m.type, format, exclus: pris, parPage: 10 });
      } catch {
        r = { medias: [], echecs: [{ provider: 'pexels', motif: 'indisponible' }], requete };
      }
      for (const e of r.echecs) if (!echecs.some((x) => x.provider === e.provider)) echecs.push(e);
      const media = r.medias.find((x) => !pris.has(x.id) && x.type === m.type);
      if (media) {
        pris.add(media.id);
        choisi = { cle: m.cle, media, requete };
        break;
      }
    }
    propositions.push(choisi);
  }
  return { propositions, echecs };
}
