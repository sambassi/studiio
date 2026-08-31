/**
 * M3-C — LA PASSERELLE D'ÉCRAN DES CANDIDATS.
 *
 * ⚠️ CE MODULE EST IMPORTÉ PAR UN COMPOSANT CLIENT. Il n'importe que
 * `candidat-contrat`, qui est pur. Une arête vers `candidat.ts`,
 * `candidat-service.ts` ou `candidat-anthropic.ts` tirerait MinIO, la base ou
 * la clé d'API dans le paquet navigateur.
 *
 * Il ne décide de rien : il traduit des réponses HTTP en formes que l'écran
 * sait afficher, et distingue les trois cas qu'un écran doit distinguer —
 * ça marche, ce n'est pas installé, ça a échoué.
 */
import { candidatValide, type CandidatMontage } from './candidat-contrat';

/** Ce que l'écran affiche d'une génération. */
export interface GenerationEcran {
  id: string;
  version: number;
  etat: string;
  candidats: CandidatMontage[];
  modele: string | null;
  motifEchec: string | null;
}

/**
 * Relit une génération venue du réseau.
 *
 * ⚠️ CHAQUE CANDIDAT EST REVALIDÉ. Ce qui arrive ici a traversé la base et
 * HTTP ; l'écran, lui, fait des soustractions dessus. Un candidat sans
 * `finSecondes` afficherait `NaN`, et un `NaN` à l'écran est un bogue qu'on
 * met des jours à rattacher à sa cause.
 */
export function generationDepuisReponse(brut: unknown): GenerationEcran | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const g = brut as Record<string, unknown>;
  if (typeof g.id !== 'string' || typeof g.etat !== 'string') return null;

  const liste = Array.isArray(g.candidats) ? g.candidats : [];
  const fournisseurs = (typeof g.fournisseurs === 'object' && g.fournisseurs !== null
    ? g.fournisseurs : {}) as Record<string, { modele?: unknown }>;
  const modele = typeof fournisseurs.candidats?.modele === 'string'
    ? fournisseurs.candidats.modele : null;

  return {
    id: g.id,
    version: typeof g.version === 'number' ? g.version : 1,
    etat: g.etat,
    candidats: liste.filter(candidatValide),
    modele,
    motifEchec: typeof g.motifEchec === 'string' ? g.motifEchec
      : typeof g.motif_echec === 'string' ? g.motif_echec : null,
  };
}

export type LectureCandidats =
  | { sorte: 'trouvee'; generation: GenerationEcran }
  | { sorte: 'aucune' }
  /** Le serveur n'a pas la table, ou pas le fournisseur : ce n'est pas une panne. */
  | { sorte: 'indisponible'; message: string }
  | { sorte: 'erreur'; message: string };

/** Lit la dernière génération d'une analyse. */
export async function lireCandidats(analyseId: string): Promise<LectureCandidats> {
  let reponse: Response;
  try {
    reponse = await fetch(`/api/autopilot/analyses/${analyseId}/candidats`, {
      method: 'GET', credentials: 'same-origin',
    });
  } catch {
    return { sorte: 'erreur', message: 'Réseau indisponible.' };
  }

  let corps: Record<string, unknown> = {};
  try { corps = await reponse.json() as Record<string, unknown>; } catch { /* corps vide */ }

  if (reponse.status === 503) {
    return {
      sorte: 'indisponible',
      message: typeof corps.error === 'string' ? corps.error
        : 'Les passages suggérés ne sont pas activés sur ce serveur.',
    };
  }
  if (!reponse.ok) {
    return {
      sorte: 'erreur',
      message: typeof corps.error === 'string' ? corps.error : 'Lecture impossible.',
    };
  }

  const generation = generationDepuisReponse(corps.generation);
  return generation ? { sorte: 'trouvee', generation } : { sorte: 'aucune' };
}

export type LancementCandidats =
  | { sorte: 'lancee'; generation: GenerationEcran }
  | { sorte: 'deja_en_cours' }
  | { sorte: 'indisponible'; message: string }
  | { sorte: 'echec'; message: string };

/**
 * Demande une génération.
 *
 * ⚠️ AUCUNE REPRISE ICI NON PLUS. Un `retry` côté écran paierait un second
 * appel au fournisseur sans que personne ne l'ait demandé — et l'index unique
 * de la base le refuserait de toute façon.
 */
export async function lancerCandidats(analyseId: string): Promise<LancementCandidats> {
  let reponse: Response;
  try {
    reponse = await fetch(`/api/autopilot/analyses/${analyseId}/candidats`, {
      method: 'POST', credentials: 'same-origin',
    });
  } catch {
    return { sorte: 'echec', message: 'Réseau indisponible.' };
  }

  let corps: Record<string, unknown> = {};
  try { corps = await reponse.json() as Record<string, unknown>; } catch { /* corps vide */ }

  if (reponse.status === 409 && corps.motif === 'generation_active_existante') {
    return { sorte: 'deja_en_cours' };
  }
  if (reponse.status === 503) {
    return {
      sorte: 'indisponible',
      message: typeof corps.error === 'string' ? corps.error
        : 'Les passages suggérés ne sont pas activés sur ce serveur.',
    };
  }
  if (!reponse.ok) {
    return {
      sorte: 'echec',
      message: typeof corps.error === 'string' ? corps.error : 'La recherche a échoué.',
    };
  }

  const generation = generationDepuisReponse(corps.generation);
  return generation
    ? { sorte: 'lancee', generation }
    : { sorte: 'echec', message: 'Réponse inexploitable.' };
}

/** `12.5` → `0:12.5`. Rend une borne lisible, jamais une valeur inventée. */
export function formaterInstant(secondes: number): string {
  if (!Number.isFinite(secondes) || secondes < 0) return '—';
  const m = Math.floor(secondes / 60);
  const s = secondes - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
