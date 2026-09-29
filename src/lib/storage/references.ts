import { supabaseAdmin } from '@/lib/db/supabase';
import { storageKey, DRAFT_RUSH_TTL_MS, PAGE_LECTURE, LIGNES_MAX, tableAbsente } from '@/lib/storage/cleanup';

/**
 * Les médias qu'un contenu UTILISE — et qu'on n'a donc pas le droit de
 * supprimer depuis la Médiathèque.
 *
 * ⚠️ POURQUOI CE MODULE EXISTE. `POST /api/media/delete` ne vérifiait que le
 * préfixe `<userId>/` : un utilisateur pouvait supprimer le rendu, le rush ou
 * l'affiche d'un post brouillon, programmé ou publié. Le post devenait un 404,
 * la publication échouait, et rien ne revenait. Le cron de nettoyage, lui,
 * protégeait ces fichiers depuis longtemps — la suppression manuelle était le
 * seul chemin qui ne demandait rien.
 *
 * Même contrat que `cleanup.ts` : **`null` dès qu'une source est illisible**,
 * jamais un ensemble vide. Un ensemble vide se lirait « rien à protéger » et
 * laisserait supprimer. Refuser une suppression se rattrape ; un fichier
 * supprimé ne revient pas.
 *
 * Les comparaisons se font sur la CLÉ `<bucket>/<chemin>` — jamais sur l'URL,
 * dont l'hôte varie (staging / prod, www / apex, anciennes URL Supabase).
 */

/** Statuts de post dont les médias sont protégés (mêmes que le cron). */
export const STATUTS_CONTENU_PROTEGE = ['scheduled', 'published', 'draft'] as const;

/** Message de refus, montré tel quel par la Médiathèque et la page Média. */
export const MESSAGE_MEDIA_UTILISE =
  'Ce fichier est utilisé par un contenu (brouillon/programmé/publié) : supprimez d\'abord le contenu.';

/** Pourquoi une clé est protégée — sert au journal et au message. */
export type MotifProtection = 'post' | 'autopilote' | 'brouillon' | 'tournage';

/**
 * Les clés d'une URL : la forme brute ET, si elle diffère, la forme décodée.
 *
 * Une URL persistée peut porter `%20` là où la liste de stockage rend un
 * espace. Garder les deux formes ne peut que protéger PLUS.
 */
export function clesDepuisUrl(url: unknown): string[] {
  if (typeof url !== 'string') return [];
  const brute = storageKey(url);
  if (!brute) return [];
  const out = [brute];
  try {
    const decodee = decodeURIComponent(brute);
    if (decodee !== brute) out.push(decodee);
  } catch {
    // Échappement invalide : la forme brute suffit.
  }
  return out;
}

/**
 * Toutes les chaînes d'une valeur JSON qui désignent notre stockage, à
 * n'importe quelle profondeur.
 *
 * ⚠️ VOLONTAIREMENT PLUS LARGE QUE `collectStorageUrlsFromPost`. Celle-ci sert
 * à la SUPPRESSION en cascade d'un post et écarte exprès le logo (partagé
 * entre posts). Ici on PROTÈGE : le logo, les icônes de cartes, les fonds, les
 * éléments libres cassent tout autant le post s'ils disparaissent. Une liste
 * de champs oublie toujours le champ de demain ; un parcours complet non.
 */
export function urlsStockageProfondes(valeur: unknown, profondeur = 0, out: string[] = []): string[] {
  if (profondeur > 12 || valeur == null) return out;
  if (typeof valeur === 'string') {
    if (valeur.includes('/storage/v1/object/')) out.push(valeur);
    return out;
  }
  if (Array.isArray(valeur)) {
    for (const v of valeur) urlsStockageProfondes(v, profondeur + 1, out);
    return out;
  }
  if (typeof valeur === 'object') {
    for (const v of Object.values(valeur as Record<string, unknown>)) {
      urlsStockageProfondes(v, profondeur + 1, out);
    }
  }
  return out;
}

/** Les clés qu'un post référence : `media_url` + toute URL de sa metadata. */
export function clesReferenceesParPost(post: { media_url?: unknown; metadata?: unknown }): string[] {
  const out: string[] = [];
  out.push(...clesDepuisUrl(post.media_url));
  for (const u of urlsStockageProfondes(post.metadata)) out.push(...clesDepuisUrl(u));
  return out;
}

/**
 * Lit toutes les lignes d'un utilisateur, par tranches (voir `lireTout` dans
 * `cleanup.ts` : sans `.range()`, PostgREST tronque en silence au-delà de
 * `db-max-rows`, et une lecture tronquée, ici, laisse supprimer).
 */
async function lireToutUtilisateur(
  table: string,
  colonnes: string,
  userId: string,
  tolererAbsence: boolean,
  affiner?: (q: any) => any,
): Promise<Record<string, unknown>[] | null> {
  const out: Record<string, unknown>[] = [];
  for (let debut = 0; ; debut += PAGE_LECTURE) {
    let q: any = supabaseAdmin.from(table).select(colonnes).eq('user_id', userId);
    if (affiner) q = affiner(q);
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await q
      .order('id', { ascending: true })
      .range(debut, debut + PAGE_LECTURE - 1);
    if (error) {
      if (tolererAbsence && tableAbsente(error)) return [];
      console.error(`[MEDIA-REFS] ${table} illisible :`, error.message);
      return null;
    }
    const lot = (data ?? []) as Record<string, unknown>[];
    out.push(...lot);
    if (lot.length < PAGE_LECTURE) return out;
    if (out.length > LIGNES_MAX) {
      console.error(`[MEDIA-REFS] ${table} depasse ${LIGNES_MAX} lignes — lecture abandonnee`);
      return null;
    }
  }
}

/**
 * Toutes les clés qu'un utilisateur a le devoir de garder, avec leur motif.
 *
 * Sources (les mêmes que le cron, restreintes au compte) :
 *   - ses posts `draft` / `scheduled` / `published` ;
 *   - sa banque de rushes Autopilote — ACTIVE OU NON : un Autopilote remis en
 *     marche ne doit pas retrouver sa banque vidée ;
 *   - ses rushes de brouillon Créer récents (même fenêtre que le cron) ;
 *   - ses rushes de tournage et vignettes d'analyse.
 *
 * `null` = au moins une source illisible : l'appelant ne supprime RIEN.
 */
export async function referencesUtilisateur(userId: string): Promise<Map<string, MotifProtection> | null> {
  const refs = new Map<string, MotifProtection>();
  const ajouter = (cle: string, motif: MotifProtection) => { if (!refs.has(cle)) refs.set(cle, motif); };

  try {
    // ── Posts ────────────────────────────────────────────────────────────
    const posts = await lireToutUtilisateur(
      'scheduled_posts', 'id, media_url, metadata', userId, false,
      (q) => q.in('status', [...STATUTS_CONTENU_PROTEGE]),
    );
    if (!posts) return null;
    for (const p of posts) for (const k of clesReferenceesParPost(p)) ajouter(k, 'post');

    // ── Banque Autopilote ────────────────────────────────────────────────
    const { data: configs, error: errConfig } = await supabaseAdmin
      .from('autopilot_config')
      .select('rush_urls')
      .eq('user_id', userId);
    if (errConfig) {
      console.error('[MEDIA-REFS] banque Autopilote illisible :', errConfig.message);
      return null;
    }
    for (const c of configs ?? []) {
      const rushes = (c as { rush_urls?: unknown }).rush_urls;
      if (!Array.isArray(rushes)) continue;
      for (const u of rushes) for (const k of clesDepuisUrl(u)) ajouter(k, 'autopilote');
    }

    // ── Rushes de brouillon Créer ────────────────────────────────────────
    const seuil = new Date(Date.now() - DRAFT_RUSH_TTL_MS).toISOString();
    const { data: brouillons, error: errBrouillon } = await supabaseAdmin
      .from('creer_draft_rushes')
      .select('object_key')
      .eq('user_id', userId)
      .gt('updated_at', seuil);
    if (errBrouillon) {
      console.error('[MEDIA-REFS] rushes de brouillon illisibles :', errBrouillon.message);
      return null;
    }
    for (const b of brouillons ?? []) {
      const k = (b as { object_key?: unknown }).object_key;
      if (typeof k === 'string' && k.length > 0) ajouter(k, 'brouillon');
    }

    // ── Tournage : rushes indexés et vignettes d'analyse ─────────────────
    const rushes = await lireToutUtilisateur('rushes', 'id, bucket, cle_objet', userId, true);
    if (!rushes) return null;
    for (const r of rushes) {
      if (typeof r.bucket === 'string' && typeof r.cle_objet === 'string') {
        ajouter(`${r.bucket}/${r.cle_objet}`, 'tournage');
      }
    }
    const analyses = await lireToutUtilisateur('rush_analyses', 'id, vignettes', userId, true);
    if (!analyses) return null;
    for (const a of analyses) {
      if (!Array.isArray(a.vignettes)) continue;
      for (const v of a.vignettes) {
        if (!v || typeof v !== 'object') continue;
        const g = v as { bucket?: unknown; cle?: unknown };
        if (typeof g.bucket === 'string' && typeof g.cle === 'string') ajouter(`${g.bucket}/${g.cle}`, 'tournage');
      }
    }
  } catch (err) {
    console.error('[MEDIA-REFS] références illisibles :', err);
    return null;
  }

  return refs;
}

/** Le motif qui protège `<bucket>/<chemin>`, ou `null` s'il est libre. */
export function motifProtection(
  bucket: string,
  path: string,
  refs: Map<string, MotifProtection>,
): MotifProtection | null {
  const cle = `${bucket}/${path}`;
  const direct = refs.get(cle);
  if (direct) return direct;
  try {
    const decodee = decodeURIComponent(cle);
    if (decodee !== cle) return refs.get(decodee) ?? null;
  } catch {
    // Chemin non décodable : la forme brute a déjà été testée.
  }
  return null;
}
