/**
 * CINEMA IA — LA DIRECTION ARTISTIQUE DANS LES PROMPTS.
 *
 * Le prompt de base reste celui du moteur existant (`lib/ai/prompt-image.ts`, partage avec
 * d'autres parcours et NON modifie ici) : sujet, action, apparence des personnages, decor,
 * texte original. Ce module n'ajoute que la DIRECTION — style et camera — autour de lui :
 *
 *   - image : le style, insere AVANT le rappel « Original request » (les premiers mots
 *     pesent le plus, le texte original ferme le prompt) ;
 *   - video : la camera REMPLACE la consigne figee « subtle and steady camera motion » du
 *     prompt video partage — sans cela, deux consignes de camera se contrediraient — et le
 *     style est rappele pour que la video ne derive pas du look de l'image source.
 *
 * Sans style ET en mode image, le prompt est EXACTEMENT celui d'avant (pas de regression
 * pour un film qui n'a rien choisi). En video, la camera automatique remplace la consigne
 * figee : c'est la fonctionnalite.
 */
import type { Film, PlanCinema, SceneCinema } from '@/lib/cinema/types';
import { styleEffectif, type StyleCinema } from '@/lib/cinema/direction/styles';
import { cameraCinema, cameraEffective } from '@/lib/cinema/direction/camera';

/** Le marqueur que `construirePromptImage` pose devant le texte original. */
export const MARQUEUR_ORIGINAL = '. Original request (French):';
/** La consigne de camera figee du prompt video partage. */
export const CAMERA_FIGEE = 'subtle and steady camera motion';

export interface DirectionPlan {
  style: StyleCinema | null;
  /** `null` = film d'avant sans camera choisie : la consigne figee d'origine est conservee. */
  camera: ReturnType<typeof cameraEffective> | null;
  sceneId: string | null;
}

export function directionDuPlan(film: Film, planId: string): DirectionPlan {
  const scene: SceneCinema | undefined = film.scenes.find((s) => s.plans.some((p) => p.id === planId));
  const plan: PlanCinema | undefined = scene?.plans.find((p) => p.id === planId);
  return {
    style: styleEffectif(film, scene),
    camera: film.directionActive === true || plan?.camera !== undefined
      ? cameraEffective(plan ?? { cadre: 'moyen', description: '', dialogue: null }, scene)
      : null,
    sceneId: scene?.id ?? null,
  };
}

/** Le bloc de style : cinq descripteurs, et la garde qui l'empeche de toucher au contenu. */
export function blocStyle(style: StyleCinema): string {
  const p = style.prompt;
  return [
    `Cinematic style: ${p.profil}`,
    `lighting: ${p.eclairage}`,
    `color palette: ${p.palette}`,
    `mood: ${p.ambiance}`,
    `image texture: ${p.texture}`,
    // Le style change la facon de filmer, jamais ce qui est dit ou montre.
    'apply this style to lighting, color grading, mood and texture only: do not change the characters, their appearance, the dialogue or the setting',
  ].join('. ');
}

function avantOriginal(prompt: string, ajout: string): string {
  const i = prompt.indexOf(MARQUEUR_ORIGINAL);
  return i < 0 ? `${prompt}. ${ajout}` : `${prompt.slice(0, i)}. ${ajout}${prompt.slice(i)}`;
}

/** Prompt d'IMAGE : le prompt du moteur, plus le style effectif. Sans style : inchange. */
export function promptImageAvecDirection(promptBase: string, direction: DirectionPlan): string {
  return direction.style ? avantOriginal(promptBase, blocStyle(direction.style)) : promptBase;
}

/** Prompt de VIDEO : la camera remplace la consigne figee ; le style est rappele. */
export function promptVideoAvecDirection(promptBase: string, direction: DirectionPlan): string {
  let prompt = promptBase;
  if (direction.camera) {
    const camera = `camera: ${cameraCinema(direction.camera.effective).prompt as string}`;
    prompt = promptBase.includes(CAMERA_FIGEE) ? promptBase.replace(CAMERA_FIGEE, camera) : avantOriginal(promptBase, camera);
  }
  if (direction.style) {
    const p = direction.style.prompt;
    prompt = avantOriginal(prompt, `keep the ${direction.style.nomEn} look of the input image: ${p.eclairage}, ${p.palette}, ${p.texture}`);
  }
  return prompt;
}
