/**
 * CINEMA IA — LES MOUVEMENTS DE CAMERA, PAR PLAN.
 *
 * ⚠️ UNE INDICATION, PAS UNE GARANTIE. Aucun fournisseur branche n'expose de parametre de
 * camera (verifie : le schema du modele Kling 2.5 turbo lu sur la documentation officielle
 * porte `prompt`, `image_url`, `duration`, `cfg_scale`, `negative_prompt` ; Wan 2.1 sur
 * Replicate porte `prompt`, `image`, `seed`, `aspect_ratio`). Le mouvement est donc ECRIT
 * dans le prompt video, et le modele l'interprete : le resultat peut s'en ecarter. L'ecran
 * le dit. Aucun parametre natif n'est invente.
 *
 * Il n'a d'effet que sur la VIDEO (l'image d'un plan est fixe). Pour l'image, le prompt
 * n'en parle pas.
 *
 * MODE AUTOMATIQUE (le defaut) : un mouvement concret est CHOISI selon le plan — jamais
 * « auto » envoye tel quel. Regles, par ordre :
 *   1. plan d'insert (detail)                      → camera fixe ;
 *   2. un sujet qui se deplace (marche, court…)    → suivi lateral ;
 *   3. une replique en gros plan ou plan moyen     → travelling avant lent ;
 *   4. l'intention de la scene : confrontation → orbite ; incident → suivi lateral ;
 *      resolution / epilogue → travelling arriere ; exposition en plan d'ensemble →
 *      panoramique droit ;
 *   5. sinon                                       → travelling avant lent.
 */
import type { CadrePlan, IdCameraCinema, IntentionScene } from '@/lib/cinema/types';

export interface CameraCinema {
  id: IdCameraCinema;
  libelle: string;
  /** La phrase envoyee au modele (anglais). `null` pour `auto`, qui est resolu avant. */
  prompt: string | null;
}

export const CAMERAS_CINEMA: readonly CameraCinema[] = [
  { id: 'auto', libelle: 'Automatique', prompt: null },
  { id: 'fixe', libelle: 'Caméra fixe', prompt: 'static locked-off camera on a tripod, no camera movement at all, only the subjects move' },
  { id: 'travelling_avant', libelle: 'Travelling avant', prompt: 'slow smooth dolly-in, the camera glides steadily forward toward the subject' },
  { id: 'travelling_arriere', libelle: 'Travelling arrière', prompt: 'slow smooth dolly-out, the camera glides steadily backward away from the subject' },
  { id: 'pano_gauche', libelle: 'Panoramique gauche', prompt: 'slow smooth pan to the left, the camera pivots left from a fixed position' },
  { id: 'pano_droite', libelle: 'Panoramique droite', prompt: 'slow smooth pan to the right, the camera pivots right from a fixed position' },
  { id: 'suivi_lateral', libelle: 'Suivi latéral', prompt: 'smooth lateral tracking shot, the camera travels sideways alongside the subject keeping pace with it' },
  { id: 'orbite', libelle: 'Orbite', prompt: 'slow smooth orbit, the camera arcs around the subject while keeping it centered in frame' },
];

export const IDS_CAMERAS: readonly IdCameraCinema[] = CAMERAS_CINEMA.map((c) => c.id);

export function estCameraCinema(v: unknown): v is IdCameraCinema {
  return typeof v === 'string' && (IDS_CAMERAS as readonly string[]).includes(v);
}

export function cameraCinema(id: IdCameraCinema): CameraCinema {
  return CAMERAS_CINEMA.find((c) => c.id === id) ?? CAMERAS_CINEMA[0];
}

/** Verbes de deplacement d'un sujet, sans accents (le texte est normalise avant comparaison). */
const DEPLACEMENT = /\b(marche|marchent|court|courent|entre|entrent|avance|avancent|sort|sortent|traverse|traversent|poursuit|fuit|s'eloigne|s'approche|monte|descend|walks?|runs?|enters?|crosses|chases)\b/;

function normaliser(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface PlanPourCamera {
  cadre: CadrePlan;
  description: string;
  dialogue: { texte: string } | null;
}

/** Le mouvement CONCRET choisi pour un plan en mode automatique. Jamais `auto`. */
export function cameraAutomatique(
  plan: PlanPourCamera, scene: { intention: IntentionScene } | null | undefined,
): Exclude<IdCameraCinema, 'auto'> {
  if (plan.cadre === 'insert') return 'fixe';
  // Une replique est un texte parle : seul le texte de description decrit un deplacement.
  if (!plan.dialogue && DEPLACEMENT.test(normaliser(plan.description))) return 'suivi_lateral';
  if (plan.dialogue && (plan.cadre === 'rapproche' || plan.cadre === 'moyen')) return 'travelling_avant';
  switch (scene?.intention) {
    case 'confrontation': return 'orbite';
    case 'incident': return 'suivi_lateral';
    case 'resolution':
    case 'epilogue': return 'travelling_arriere';
    case 'exposition': return plan.cadre === 'ensemble' ? 'pano_droite' : 'travelling_avant';
    default: return 'travelling_avant';
  }
}

/** Ce qui sera REELLEMENT demande : le choix de l'utilisateur, ou celui de l'automatique. */
export function cameraEffective(
  plan: PlanPourCamera & { camera?: IdCameraCinema },
  scene: { intention: IntentionScene } | null | undefined,
): { choix: IdCameraCinema; effective: Exclude<IdCameraCinema, 'auto'>; automatique: boolean } {
  const choix: IdCameraCinema = estCameraCinema(plan.camera) ? plan.camera : 'auto';
  if (choix === 'auto') return { choix, effective: cameraAutomatique(plan, scene), automatique: true };
  return { choix, effective: choix, automatique: false };
}
