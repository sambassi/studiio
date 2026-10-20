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
import { etapeDepuisStatutJumeauAutopilote, progressionVideoAvatar } from '@/lib/avatar/etapes-video-avatar';

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

/**
 * `avancement` (additif) : l'avancement RÉEL de la composition (images
 * rendues, 0..1) — `null` aux autres étapes, qui n'ont aucune mesure. C'est
 * le SEUL chiffre que l'écran affiche ; `pourcent` (bornes fixes par étape)
 * reste pour les lecteurs d'avant.
 */
export interface Progression { pourcent: number; etape: EtapeProduction; libelle: string; majA: number; avancement?: number | null }

const parUtilisateur = new Map<string, Progression>();

export function noterProgression(userId: string, etape: EtapeProduction, avancement = 0): void {
  const precedent = parUtilisateur.get(userId);
  const pourcent = pourcentEtape(etape, avancement);
  // Jamais de recul : une étape relancée ne fait pas revenir la barre.
  parUtilisateur.set(userId, {
    pourcent: Math.max(pourcent, precedent?.pourcent ?? 0),
    etape, libelle: LIBELLES_ETAPES[etape], majA: Date.now(),
    avancement: etape === 'composition' && Number.isFinite(avancement) ? Math.min(1, Math.max(0, avancement)) : null,
  });
}

/** Les étapes du pipeline, dans l'ordre, telles que l'écran les nomme. */
export const ETAPES_PRODUCTION: ReadonlyArray<{ etape: EtapeProduction; libelle: string }> = [
  { etape: 'analyse', libelle: 'Analyse des rushes' },
  { etape: 'preparation', libelle: 'Préparation du montage' },
  { etape: 'composition', libelle: 'Montage' },
  { etape: 'envoi', libelle: 'Envoi de la vidéo' },
  { etape: 'finalisation', libelle: 'Finalisation' },
];

/**
 * Ce que l'écran montre d'une production en cours : les étapes RÉELLES, et
 * un pourcentage SEULEMENT pendant la composition (images rendues). Aux
 * autres étapes : aucun chiffre (barre indéterminée). Pure.
 */
export function affichageProduction(p: { etape?: unknown; avancement?: unknown } | null | undefined): {
  etapes: Array<{ libelle: string; etat: 'terminee' | 'courante' | 'a_venir' }>;
  message: string;
  pourcentage?: number;
} {
  const etape = ETAPES_PRODUCTION.some((e) => e.etape === p?.etape) ? (p!.etape as EtapeProduction) : null;
  const i = etape ? ETAPES_PRODUCTION.findIndex((e) => e.etape === etape) : 0;
  const etapes = ETAPES_PRODUCTION.map((e, k) => ({
    libelle: e.libelle,
    etat: (k < i ? 'terminee' : k === i ? 'courante' : 'a_venir') as 'terminee' | 'courante' | 'a_venir',
  }));
  const message = etape ? LIBELLES_ETAPES[etape] : 'Démarrage…';
  const a = p?.avancement;
  if (etape === 'composition' && typeof a === 'number' && Number.isFinite(a)) {
    return { etapes, message, pourcentage: Math.round(Math.min(1, Math.max(0, a)) * 100) };
  }
  return { etapes, message };
}

export function lireProgression(userId: string): Progression | null {
  return parUtilisateur.get(userId) ?? null;
}

export function effacerProgression(userId: string): void {
  parUtilisateur.delete(userId);
}

// ── Résultat d'une production lancée EN ARRIÈRE-PLAN ────────────────────
// « Produire maintenant » ne tient plus la requête HTTP ouverte pendant tout
// le rendu : il répond tout de suite, le rendu continue, et l'écran relit
// avancement puis résultat. Un rechargement de page retrouve donc l'état,
// et le bouton reste bloqué tant que le rendu tourne (1 clic = 1 rendu).

export type ResultatProduction = { success: boolean } & Record<string, unknown>;

const resultats = new Map<string, { at: number; resultat: ResultatProduction }>();
const RESULTAT_TTL_MS = 30 * 60_000;

export function noterResultat(userId: string, resultat: ResultatProduction): void {
  parUtilisateur.delete(userId);
  resultats.set(userId, { at: Date.now(), resultat });
}

export function lireResultat(userId: string): ResultatProduction | null {
  const r = resultats.get(userId);
  if (!r) return null;
  if (Date.now() - r.at > RESULTAT_TTL_MS) { resultats.delete(userId); return null; }
  return r.resultat;
}

export function effacerResultat(userId: string): void {
  resultats.delete(userId);
}

// ── « Génération en cours » vue depuis le CALENDRIER ─────────────────────
// Le Calendrier ne montre que des posts, et un post n'existe qu'APRÈS le
// rendu, l'envoi et la relecture du MP4 final : pendant toute la production,
// il était vide, comme si rien ne se passait. Il relit donc la MÊME source que
// le panneau (`GET /api/autopilot/produire-maintenant/progression`) et montre
// une carte « Génération en cours » — sans créer de post, sans rien annoncer
// comme terminé. Pourcentage : seulement celui MESURÉ (composition).

export type GenerationEnCours =
  | { sorte: 'rendu'; etapes: Array<{ libelle: string; etat: 'terminee' | 'courante' | 'a_venir' }>; message: string; pourcentage?: number }
  | { sorte: 'avatar'; etapes: Array<{ libelle: string; etat: 'terminee' | 'courante' | 'a_venir' | 'echouee' }>; message: string; detail: string | null; depuis: string | null };

/** La lecture de `/progression` → la carte du Calendrier, ou `null` (rien en cours). Pure. */
export function generationEnCoursDepuisLecture(d: unknown): GenerationEnCours | null {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  if (o.progression && typeof o.progression === 'object') {
    const a = affichageProduction(o.progression as { etape?: unknown; avancement?: unknown });
    return { sorte: 'rendu', ...a };
  }
  const j = (o.jumeau && typeof o.jumeau === 'object' ? o.jumeau : null) as { etat?: unknown; statut?: unknown; depuis?: unknown } | null;
  if (j?.etat === 'en_preparation') {
    const p = progressionVideoAvatar({ etape: etapeDepuisStatutJumeauAutopilote(typeof j.statut === 'string' ? j.statut : 'en_attente') });
    return {
      sorte: 'avatar', etapes: p.etapes, message: p.message, detail: p.detail,
      depuis: typeof j.depuis === 'string' ? j.depuis : null,
    };
  }
  return null;
}
