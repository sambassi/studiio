/**
 * FOURNISSEUR SIMULE — local, gratuit, deterministe. Le seul `actif`.
 *
 * Il ne genere rien par IA : il DESSINE, avec ffmpeg (`lavfi`), une image ou
 * une courte video dont la couleur dominante encode l'IDENTITE du personnage
 * present (hash de son apparence de reference). C'est suffisant pour :
 *
 *  1. prouver que le reste du pipeline (prompt, devis, plafond, import,
 *     empreinte, rendu) fonctionne de bout en bout SANS dependre d'un
 *     service externe ni d'un centime depense ;
 *  2. donner au test de « coherence » (mission 2) un signal MESURABLE :
 *     deux plans du MEME personnage recoivent la MEME couleur d'identite,
 *     deux personnages DIFFERENTS des couleurs differentes.
 *
 * ⚠️ CE SIGNAL NE PROUVE RIEN SUR UN VRAI MODELE. Un hash de texte n'est pas
 * une identite visuelle : il ne fait que verifier que le MECANISME de
 * comparaison (voir `coherence.ts`) distingue bien « meme personnage » de
 * « personnage different » quand la donnee sous-jacente le permet. La
 * coherence VISUELLE d'un vrai fournisseur reste a mesurer le jour ou un
 * vrai fournisseur est branche (mission 2 du cahier des charges).
 */
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';
import { mkdir } from 'fs/promises';
import { executer } from '@/lib/cinema/rendu-local';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import { hash } from '@/lib/cinema/empreinte';
import { generationIaSimuleeActive } from '@/lib/cinema/garde';
import {
  enregistrerFournisseur, type DemandeImageGeneration, type DemandeVideoGeneration,
  type FournisseurGenerationIA, type ResultatGenerationIA,
} from '@/lib/cinema/generation/fournisseur';

export const ID_FOURNISSEUR_SIMULE = 'simule';

/** Palette fixe (tons Studiio) — le hash choisit DANS cette liste, il n'invente pas de couleur. */
export const PALETTE_IDENTITE: readonly string[] = [
  '0x7C3AED', '0xEC4899', '0x2563EB', '0x059669', '0xD97706', '0xDC2626', '0x0891B2', '0x9333EA',
];

/**
 * La couleur d'identite d'un personnage : derivee UNIQUEMENT de son
 * apparence de reference. Stable tant que la reference ne change pas — deux
 * plans, deux scenes, deux appels : meme texte d'apparence, meme couleur.
 */
export function couleurIdentite(descriptionApparence: string): string {
  const h = parseInt(hash(descriptionApparence.trim().toLowerCase() || 'sans-reference'), 16);
  return PALETTE_IDENTITE[h % PALETTE_IDENTITE.length];
}

/** Couleur de FOND quand aucun personnage n'est present (plan d'ambiance). */
const COULEUR_SANS_PERSONNAGE = '0x334155';

const DOSSIER_SORTIE = path.join(os.tmpdir(), 'cinema-generation-simulee');
const existeDossier = async () => mkdir(DOSSIER_SORTIE, { recursive: true });

function dimensionsDe(demandeFormat: '9:16' | '16:9'): { l: number; h: number } {
  // Resolution MODESTE : c'est un fournisseur simule, pas un rendu final —
  // la mesure (ffprobe) et le cadrage se font a l'identique quelle que soit
  // la taille, et une petite image rend le banc rapide.
  return demandeFormat === '9:16' ? { l: 360, h: 640 } : { l: 640, h: 360 };
}

async function genererImage(demande: DemandeImageGeneration): Promise<ResultatGenerationIA> {
  await existeDossier();
  const { l, h } = dimensionsDe(demande.format);
  const couleur = demande.personnages.length
    ? couleurIdentite(demande.personnages.map((p) => p.description || p.nom).join(' | '))
    : COULEUR_SANS_PERSONNAGE;
  const fichier = path.join(DOSSIER_SORTIE, `img-${demande.graine}-${randomBytes(3).toString('hex')}.png`);

  // ⚠️ PAS DE `drawtext` : le filtre exige ffmpeg compile avec
  // `--enable-libfreetype`, absent du build de ce poste (`No such filter:
  // 'drawtext'`, constate le 2026-10-26). `drawbox`, lui, est toujours
  // present (lot 2 s'en sert deja pour les fixtures de test) : une bande
  // claire suffit a distinguer visuellement le fichier d'un simple aplat,
  // sans dependre d'une police. Le SIGNAL mesure par les tests reste la
  // COULEUR dominante, jamais le texte.
  const r = await executer(cheminFfmpeg(), [
    '-f', 'lavfi', '-i', `color=c=${couleur}:s=${l}x${h}`,
    '-vf', 'drawbox=x=0:y=ih-ih/6:w=iw:h=ih/6:color=white@0.3:t=fill',
    '-frames:v', '1', '-y', fichier,
  ], { timeoutMs: 30_000 });
  if (r.code !== 0) return { ok: false, erreur: `fournisseur simule (image) : ffmpeg code ${r.code} — ${r.stderr.slice(-300)}` };
  return { ok: true, fichier, nomSuggere: `simule-${demande.graine}.png` };
}

async function genererVideo(demande: DemandeVideoGeneration): Promise<ResultatGenerationIA> {
  await existeDossier();
  const { l, h } = dimensionsDe(demande.format);
  const duree = Math.max(1, Math.min(8, demande.dureeS));
  const fichier = path.join(DOSSIER_SORTIE, `vid-${demande.graine}-${randomBytes(3).toString('hex')}.mp4`);

  // Image-vers-video : un lent zoom sur l'image source — mouvement reel,
  // encode comme une vraie video, pas une boucle de l'image fixe.
  const r = await executer(cheminFfmpeg(), [
    '-loop', '1', '-i', demande.fichierImageSource,
    '-vf', `scale=${l * 2}:${h * 2},zoompan=z='min(zoom+0.0015,1.15)':d=${Math.round(duree * 30)}:s=${l}x${h}:fps=30`,
    '-t', String(duree), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-y', fichier,
  ], { timeoutMs: 60_000 });
  if (r.code !== 0) return { ok: false, erreur: `fournisseur simule (video) : ffmpeg code ${r.code}` };
  return { ok: true, fichier, nomSuggere: `simule-${demande.graine}.mp4` };
}

export const FOURNISSEUR_SIMULE: FournisseurGenerationIA = {
  id: ID_FOURNISSEUR_SIMULE,
  libelle: 'Fournisseur simule (local, gratuit, deterministe)',
  /**
   * ETEINT SAUF SI `CINEMA_GENERATION_SIMULEE` l'allume (`garde.ts`). Lu A CHAQUE LECTURE,
   * et non au chargement du module : l'interrupteur agit sans redemarrer le processus, et
   * un test peut le poser puis le retirer.
   *
   * Eteint, `genererMediaPlan` refuse AVANT toute construction de prompt (`atelier.ts`) :
   * aucune image factice ne peut etre presentee a un utilisateur comme une generation.
   */
  get actif(): boolean { return generationIaSimuleeActive(); },
  genererImage,
  genererVideo,
};

enregistrerFournisseur(FOURNISSEUR_SIMULE);
