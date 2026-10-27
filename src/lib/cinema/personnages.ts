/**
 * PERSONNAGES ET LEURS REFERENCES — la memoire visuelle du film.
 *
 * Une reference est AJOUTEE, jamais ecrasee. L'incident du 2026-10-09 sur les
 * avatars a montre ce que coute une identite qu'on remplace en place : des
 * rendus deja faits se mettent a designer une apparence qui n'existe plus, et
 * rien ne le signale. Ici, remplacer une apparence cree une VERSION ; les
 * scenes deja produites gardent la trace de celle qu'elles ont utilisee
 * (`PlanCinema.referencesUtilisees`) et leur empreinte change, ce qui les
 * marque « a reproduire » au lieu de les laisser mentir.
 *
 * ⚠️ CE MODULE NE PROMET AUCUNE COHERENCE VISUELLE EN GENERATION IA. Il
 * conserve et reutilise des references ; que deux plans generes a partir de la
 * meme reference se ressemblent reste a prouver, fournisseur par fournisseur.
 */
import type { Personnage, ReferencePersonnage } from '@/lib/cinema/types';

export interface EntreePersonnage {
  nom: string;
  role?: string;
  voix?: string;
  description?: string;
  urlImage?: string | null;
}

/** Voix par defaut du casting : les deux voix francaises verifiees du projet. */
export const VOIX_PAR_DEFAUT = ['fr-FR-DeniseNeural', 'fr-FR-HenriNeural'] as const;
/** Voix du narrateur quand une replique n'appartient a personne. */
export const VOIX_NARRATEUR = 'fr-FR-VivienneMultilingualNeural';

export function creerPersonnage(
  entree: EntreePersonnage,
  index = 0,
  maintenant: () => Date = () => new Date(),
): Personnage {
  const id = identifiantDe(entree.nom, index);
  const reference: ReferencePersonnage | null = entree.description || entree.urlImage
    ? {
        id: `${id}-ref-1`,
        version: 1,
        description: (entree.description ?? '').trim(),
        urlImage: entree.urlImage ?? null,
        creeeLe: maintenant().toISOString(),
      }
    : null;
  return {
    id,
    nom: entree.nom.trim(),
    role: (entree.role ?? '').trim() || 'personnage',
    voix: entree.voix ?? VOIX_PAR_DEFAUT[index % VOIX_PAR_DEFAUT.length],
    references: reference ? [reference] : [],
    referenceActiveId: reference?.id ?? null,
  };
}

/** Identifiant stable, derive du nom — deux castings identiques donnent les memes ids. */
export function identifiantDe(nom: string, index: number): string {
  const base = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base ? `pers-${base}` : `pers-${index + 1}`;
}

/**
 * Ajoute une version de reference et l'active. L'ancienne reste dans la liste :
 * c'est elle que les plans deja rendus continuent de nommer.
 */
export function ajouterReference(
  personnage: Personnage,
  apparence: { description?: string; urlImage?: string | null },
  maintenant: () => Date = () => new Date(),
): Personnage {
  const version = (personnage.references.at(-1)?.version ?? 0) + 1;
  const reference: ReferencePersonnage = {
    id: `${personnage.id}-ref-${version}`,
    version,
    description: (apparence.description ?? personnage.references.at(-1)?.description ?? '').trim(),
    urlImage: apparence.urlImage ?? null,
    creeeLe: maintenant().toISOString(),
  };
  return {
    ...personnage,
    references: [...personnage.references, reference],
    referenceActiveId: reference.id,
  };
}

/** La reference active d'un personnage, ou la derniere connue. */
export function referenceActive(personnage: Personnage): ReferencePersonnage | null {
  return personnage.references.find((r) => r.id === personnage.referenceActiveId)
    ?? personnage.references.at(-1)
    ?? null;
}

/** Revenir a une version anterieure : une activation, pas une suppression. */
export function activerReference(personnage: Personnage, referenceId: string): Personnage {
  if (!personnage.references.some((r) => r.id === referenceId)) return personnage;
  return { ...personnage, referenceActiveId: referenceId };
}

/**
 * Le texte d'apparence a joindre au prompt d'un plan. Une seule fonction le
 * compose, pour que les plans d'un meme personnage parlent toujours de lui
 * dans les memes mots.
 */
export function apparencePourPrompt(personnages: readonly Personnage[], ids: readonly string[]): string {
  return ids
    .map((id) => personnages.find((p) => p.id === id))
    .filter((p): p is Personnage => !!p)
    .map((p) => {
      const ref = referenceActive(p);
      return ref?.description ? `${p.nom} (${ref.description})` : p.nom;
    })
    .join(', ');
}

/** Associer / dissocier un personnage a une scene reste une operation explicite. */
export function associer(ids: readonly string[], personnageId: string): string[] {
  return ids.includes(personnageId) ? [...ids] : [...ids, personnageId];
}

export function dissocier(ids: readonly string[], personnageId: string): string[] {
  return ids.filter((id) => id !== personnageId);
}
