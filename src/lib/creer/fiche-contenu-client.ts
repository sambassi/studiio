/**
 * M2-a — Fiches de contenu côté NAVIGATEUR (Créer) : un appel à
 * `/api/creer/fiches-contenu`, borné, jamais d'exception. La fiche est
 * calculée (ou relue du cache) par le SERVEUR, au nom de la session.
 *
 * Consultatif : le résultat n'entre que dans `metadata.decisionMontage`,
 * jamais dans le plan ni dans le rendu.
 */
import { ficheContenuValide, type FicheContenuRush } from '@/lib/creer/fiche-contenu';

export type FichesParUrl = Map<string, FicheContenuRush>;

export async function chargerFichesContenu(urls: ReadonlyArray<string>, delaiMs = 8000): Promise<FichesParUrl> {
  const out: FichesParUrl = new Map();
  const liste = [...new Set(urls.filter((u) => typeof u === 'string' && u && !u.startsWith('blob:')))].slice(0, 12);
  if (!liste.length) return out;
  const q = new URLSearchParams();
  for (const u of liste) q.append('url', u);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const minuterie = setTimeout(() => ctrl?.abort(), delaiMs);
  try {
    const res = await fetch(`/api/creer/fiches-contenu?${q.toString()}`, { signal: ctrl?.signal, cache: 'no-store' });
    const j = await res.json().catch(() => null) as { success?: boolean; fiches?: Array<{ url?: unknown; fiche?: unknown }> } | null;
    if (!res.ok || !j?.success || !Array.isArray(j.fiches)) return out;
    for (const f of j.fiches) {
      if (typeof f?.url === 'string' && liste.includes(f.url) && ficheContenuValide(f.fiche)) out.set(f.url, f.fiche);
    }
  } catch {
    /* réseau, délai : aucune fiche, rien de bloqué */
  } finally {
    clearTimeout(minuterie);
  }
  return out;
}

/** Attend une promesse au plus `delaiMs`, sinon `repli`. Jamais d'exception. */
export async function auPlus<T>(p: Promise<T> | null | undefined, delaiMs: number, repli: T): Promise<T> {
  if (!p) return repli;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.catch(() => repli), new Promise<T>((r) => { minuterie = setTimeout(() => r(repli), delaiMs); })]);
  } finally {
    if (minuterie) clearTimeout(minuterie);
  }
}
