/**
 * Le style du film est choisi UNE FOIS (etape Histoire) : toutes les scenes l'heritent, et il
 * atteint REELLEMENT les prompts envoyes au fournisseur — pas seulement l'ecran.
 */
import { describe, it, expect } from 'vitest';
import { preparerFilm } from '@/lib/cinema/atelier';
import { directionDuPlan, promptImageAvecDirection, promptVideoAvecDirection, blocStyle } from '@/lib/cinema/direction/prompt';
import { STYLES_CINEMA, styleCinema } from '@/lib/cinema/direction/styles';
import { appliquerPatch } from '@/lib/cinema/patch';
import type { Film } from '@/lib/cinema/types';

const HISTOIRE = 'Nina entre dans la salle. Marco la regarde dans la salle. Nina sourit dans la salle. Le jour se leve sur la salle. Marco quitte la salle.';
const casting = [{ nom: 'Nina', role: 'p', description: '', urlImage: null }, { nom: 'Marco', role: 'a', description: '', urlImage: null }];
const base = () => preparerFilm({ histoire: HISTOIRE, personnages: casting, idFilm: 'f', titre: 't', nbScenes: 4 });
const BASE = 'A cinematic still. Nina walks in. Original request (French): Nina entre.';

describe('style global : transmis a toutes les scenes et a tous les prompts', () => {
  it('le film a 4 scenes, et chacune herite du style du film sans rien choisir', () => {
    const f = { ...base(), styleCinema: 'noir' as const };
    expect(f.scenes).toHaveLength(4);
    for (const scene of f.scenes) {
      expect(scene.styleCinema).toBeUndefined();
      for (const plan of scene.plans) expect(directionDuPlan(f, plan.id).style?.id).toBe('noir');
    }
  });

  it.each(STYLES_CINEMA.map((s) => s.id))('style %s : le bloc de style est dans le prompt IMAGE de chaque plan des 4 scenes', (id) => {
    const f = { ...base(), styleCinema: id };
    const bloc = blocStyle(styleCinema(id)!);
    for (const plan of f.scenes.flatMap((s) => s.plans)) {
      expect(promptImageAvecDirection(BASE, directionDuPlan(f, plan.id))).toContain(bloc);
      // La video repart de l'image : elle RAPPELLE le style (eclairage, palette, texture).
      expect(promptVideoAvecDirection(BASE, directionDuPlan(f, plan.id))).toContain(`keep the ${styleCinema(id)!.nomEn} look of the input image`);
    }
  });

  it('le style ne touche pas au contenu : la garde « personnages, dialogue, decor » accompagne chaque bloc', () => {
    for (const s of STYLES_CINEMA) expect(blocStyle(s)).toMatch(/do not change the characters, their appearance, the dialogue or the setting/);
  });

  it('une exception de scene l’emporte pour CETTE scene seulement', () => {
    let f: Film = { ...base(), styleCinema: 'noir' };
    f = appliquerPatch(f, { scenes: [{ id: f.scenes[1].id, style: 'scifi' }] });
    expect(directionDuPlan(f, f.scenes[1].plans[0].id).style?.id).toBe('scifi');
    for (const i of [0, 2, 3]) expect(directionDuPlan(f, f.scenes[i].plans[0].id).style?.id).toBe('noir');
  });

  it('revenir au style du film : l’exception `null` l’efface', () => {
    let f: Film = { ...base(), styleCinema: 'noir' };
    f = appliquerPatch(f, { scenes: [{ id: f.scenes[1].id, style: 'scifi' }] });
    f = appliquerPatch(f, { scenes: [{ id: f.scenes[1].id, style: null }] });
    expect(directionDuPlan(f, f.scenes[1].plans[0].id).style?.id).toBe('noir');
  });

  it('changer le style du film change les 4 scenes, sans toucher a l’histoire ni aux plans', () => {
    const f = base();
    const g = appliquerPatch({ ...f, styleCinema: 'noir' }, { style: 'romantique' });
    expect(g.histoire).toBe(f.histoire);
    expect(g.scenes.map((s) => s.plans.map((p) => p.description))).toEqual(f.scenes.map((s) => s.plans.map((p) => p.description)));
    for (const s of g.scenes) expect(directionDuPlan(g, s.plans[0].id).style?.id).toBe('romantique');
  });

  it('un film sans style : les prompts d’avant sont inchanges', () => {
    const f = base();
    expect(promptImageAvecDirection(BASE, directionDuPlan(f, f.scenes[0].plans[0].id))).toBe(BASE);
  });
});
