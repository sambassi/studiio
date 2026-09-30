/**
 * Progression RÉELLE d'une production Autopilote manuelle (« Produire
 * maintenant »), par étapes du pipeline — jamais un minuteur inventé.
 *
 *   Analyse des rushes        0–15 %
 *   Préparation du montage   15–25 %
 *   Composition (Remotion)   25–85 %  ← avancement réel des images rendues
 *   Envoi de la vidéo        85–95 %
 *   Finalisation             95–100 %
 *
 * En mémoire du processus, par utilisateur : une seule production manuelle
 * à la fois (verrou de la route), un seul conteneur applicatif.
 */
export type EtapeProduction = 'analyse' | 'preparation' | 'composition' | 'envoi' | 'finalisation';

export const BORNES_ETAPES: Record<EtapeProduction, [number, number]> = {
  analyse: [0, 15],
  preparation: [15, 25],
  composition: [25, 85],
  envoi: [85, 95],
  finalisation: [95, 100],
};

export const LIBELLES_ETAPES: Record<EtapeProduction, string> = {
  analyse: 'Analyse des rushes…',
  preparation: 'Préparation du montage…',
  composition: 'Composition de la vidéo…',
  envoi: 'Envoi de la vidéo…',
  finalisation: 'Finalisation…',
};

/** Pourcentage global pour une étape et son avancement interne (0..1). Pure. */
export function pourcentEtape(etape: EtapeProduction, avancement = 0): number {
  const [a, b] = BORNES_ETAPES[etape];
  const f = Math.min(1, Math.max(0, Number.isFinite(avancement) ? avancement : 0));
  return Math.round(a + (b - a) * f);
}

export interface Progression { pourcent: number; etape: EtapeProduction; libelle: string; majA: number }

const parUtilisateur = new Map<string, Progression>();

export function noterProgression(userId: string, etape: EtapeProduction, avancement = 0): void {
  const precedent = parUtilisateur.get(userId);
  const pourcent = pourcentEtape(etape, avancement);
  // Jamais de recul : une étape relancée ne fait pas revenir la barre.
  parUtilisateur.set(userId, {
    pourcent: Math.max(pourcent, precedent?.pourcent ?? 0),
    etape, libelle: LIBELLES_ETAPES[etape], majA: Date.now(),
  });
}

export function lireProgression(userId: string): Progression | null {
  return parUtilisateur.get(userId) ?? null;
}

export function effacerProgression(userId: string): void {
  parUtilisateur.delete(userId);
}
