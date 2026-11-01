// @vitest-environment node
/**
 * CINEMA IA — l'audit de fidelite dit la VERITE sur ce que le decoupage a fait.
 *
 * On ne teste pas un interrupteur : on verifie que l'audit retrouve chaque phrase dans un
 * plan, dans l'ordre, et qu'il signale exactement les trois fabrications du moteur (plan
 * d'ensemble ajoute, decor neutre, locuteur devine) plus les prenoms hors casting.
 */
import { describe, it, expect } from 'vitest';
import { auditFidelite, ecartsBloquants, ecartsScene, phrasesDeLaScene, resumeFidelite, DECOR_NEUTRE } from '@/lib/cinema/fidelite';
import { appliquerPatch } from '@/lib/cinema/patch';
import { preparerFilm } from '@/lib/cinema/atelier';
import { phrases } from '@/lib/cinema/scenario';
import type { Film } from '@/lib/cinema/types';

const CASTING = [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }];
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Marco dit : « je ne reculerai pas ». Le jour se leve sur la salle vide.';
const film = (histoire = HISTOIRE, casting = CASTING): Film =>
  ({ ...preparerFilm({ histoire, personnages: casting, idFilm: 'film-fid' }), proprietaire: 'u1' });

describe('chaque phrase de l’histoire est reliee a un plan', () => {
  it('toutes les phrases sont retrouvees, dans l’ordre, et le texte original est intact', () => {
    const f = film();
    const r = auditFidelite(f);
    expect(f.histoire).toBe(HISTOIRE);
    expect(r.total).toBe(phrases(HISTOIRE).length);
    expect(r.retrouvees).toBe(r.total);
    expect(r.ordreRespecte).toBe(true);
    expect(r.fidele).toBe(true);
    for (const l of r.phrases) {
      expect(l.planId, l.phrase).not.toBeNull();
      // Le plan porte la phrase MOT POUR MOT.
      const plan = f.scenes.flatMap((s) => s.plans).find((p) => p.id === l.planId)!;
      expect(plan.description).toBe(l.phrase);
    }
    expect(resumeFidelite(r)).toMatch(/conservees, dans l’ordre/);
  });

  it('une phrase retiree du film est signalee comme absente', () => {
    const f = film();
    const ampute: Film = { ...f, scenes: f.scenes.map((s, i) => (i === 0 ? { ...s, plans: s.plans.slice(0, 1) } : s)) };
    const r = auditFidelite(ampute);
    expect(r.fidele).toBe(false);
    expect(r.retrouvees).toBeLessThan(r.total);
    expect(r.ecarts.some((e) => e.genre === 'phrase_absente')).toBe(true);
    expect(resumeFidelite(r)).toMatch(/manquante/);
  });

  it('des plans remis dans le desordre : l’ordre est signale', () => {
    const f = film();
    const inverse: Film = { ...f, scenes: [...f.scenes].reverse().map((s, i) => ({ ...s, index: i })) };
    expect(auditFidelite(inverse).ordreRespecte).toBe(false);
    expect(auditFidelite(inverse).ecarts.some((e) => e.genre === 'ordre_change')).toBe(true);
  });

  it('les phrases d’une scene sont celles de VOTRE texte, sans le plan ajoute', () => {
    const f = film();
    const p = phrasesDeLaScene(f, f.scenes[0]);
    expect(p.length).toBeGreaterThan(0);
    for (const x of p) expect(HISTOIRE).toContain(x);
    expect(p.some((x) => /Plan d'ensemble/.test(x))).toBe(false);
  });
});

describe('les fabrications du moteur sont DITES, pas masquees', () => {
  it('le plan d’ensemble ajoute par Studiio est signale dans chaque scene', () => {
    const f = film();
    for (const s of f.scenes) {
      const e = ecartsScene(f, s).filter((x) => x.genre === 'plan_ajoute');
      expect(e, s.id).toHaveLength(1);
      expect(e[0].detail).toMatch(/ne vient pas de votre texte/);
      expect(e[0].planId).toBe(s.plans[0].id);
    }
  });

  it('un lieu non reconnu devient « un decor neutre » : substitution signalee', () => {
    const f = film('Zyx avance lentement. Le silence pese. Rien ne bouge encore. Puis tout bascule.', [{ nom: 'Zyx', description: 'manteau gris' }]);
    const neutres = f.scenes.filter((s) => s.lieu === DECOR_NEUTRE);
    expect(neutres.length).toBeGreaterThan(0);
    const r = auditFidelite(f);
    expect(r.ecarts.filter((e) => e.genre === 'lieu_substitue').length).toBe(neutres.length);
    expect(r.ecarts.find((e) => e.genre === 'lieu_substitue')!.detail).toMatch(/Nommez un lieu/);
  });

  it('une replique sans nom : le locuteur devine est signale, avec le prenom attribue', () => {
    const f = film('Nina entre dans la salle. « je ne reculerai pas ». Le jour se leve. Marco attend dehors.');
    const r = auditFidelite(f);
    const devine = r.ecarts.filter((e) => e.genre === 'locuteur_devine');
    expect(devine.length).toBeGreaterThan(0);
    expect(devine[0].detail).toMatch(/Studiio l’a attribuee a (Nina|Marco)/);
    expect(devine[0].planId).toBeTruthy();
  });

  it('une replique NOMMEE n’est pas signalee', () => {
    const f = film();
    expect(auditFidelite(f).ecarts.some((e) => e.genre === 'locuteur_devine')).toBe(false);
  });

  it('un prenom hors casting est signale : il n’apparaitrait dans aucun plan', () => {
    const f = film('Nina entre dans la salle. Sofia la regarde sans bouger. Le jour se leve. Nina sourit enfin.');
    const r = auditFidelite(f);
    const hors = r.ecarts.filter((e) => e.genre === 'personnage_hors_casting');
    expect(hors).toHaveLength(1);
    expect(hors[0].detail).toMatch(/Sofia/);
    expect(hors[0].detail).toMatch(/aucun plan/);
  });

  it('l’audit ne modifie RIEN : c’est une lecture', () => {
    const f = film();
    const avant = JSON.stringify(f);
    auditFidelite(f);
    expect(JSON.stringify(f)).toBe(avant);
  });
});

describe('gravite des ecarts, scenes inventees, narration et acceptation explicite', () => {
  const casting = [{ nom: 'Nina', role: 'p', description: '', urlImage: null }, { nom: 'Marco', role: 'a', description: '', urlImage: null }];
  const film = (histoire: string, nbScenes?: number) => preparerFilm({ histoire, personnages: casting, idFilm: 'f', titre: 't', nbScenes });

  it('une histoire d’UNE phrase : le minimum de scenes en INVENTE deux, et c’est un ecart critique', () => {
    const f = film('Nina entre dans la salle.');
    const inventees = auditFidelite(f).ecarts.filter((e) => e.genre === 'scene_inventee');
    expect(f.scenes.length).toBeGreaterThanOrEqual(3);
    expect(inventees.length).toBe(f.scenes.length - 1);
    expect(inventees.every((e) => e.critique)).toBe(true);
    expect(inventees[0].detail).toMatch(/aucune phrase de votre texte/);
  });

  it('une histoire assez longue, lieux nommes, personnages au casting : aucun ecart critique', () => {
    const f = film('Nina entre dans la salle. Marco la regarde dans la salle. Nina sourit dans la salle.');
    expect(ecartsBloquants(f)).toEqual([]);
  });

  it('une phrase de recit est signalee « narration », sans bloquer, et n’est attribuee a personne', () => {
    const f = film('Nina entre dans la salle. Marco la regarde dans la salle. Nina sourit dans la salle.');
    const narrations = auditFidelite(f).ecarts.filter((e) => e.genre === 'narration');
    expect(narrations.length).toBe(3);
    expect(narrations.every((e) => !e.critique)).toBe(true);
    const plansNarres = f.scenes.flatMap((s) => s.plans).filter((p) => p.dialogue?.genre === 'narration');
    expect(plansNarres.every((p) => p.dialogue?.personnageId === null)).toBe(true);
  });

  it('une replique sans prenom est attribuee par rotation : critique, jusqu’a acceptation', () => {
    const f = film('Nina entre dans la salle. « Je ne reculerai pas » dit une voix. Marco la regarde dans la salle.');
    const b = ecartsBloquants(f);
    expect(b.some((e) => e.genre === 'locuteur_devine' || e.genre === 'lieu_substitue')).toBe(true);
  });

  it('accepter un ecart le sort des bloquants — et rien d’autre ; le texte d’origine reste intact', () => {
    const f = film('Nina sourit. Marco la regarde.');
    const avant = ecartsBloquants(f);
    expect(avant.length).toBeGreaterThan(0);
    const accepte = { ...f, ecartsAcceptes: [avant[0].cle] };
    expect(ecartsBloquants(accepte)).toHaveLength(avant.length - 1);
    expect(accepte.histoire).toBe('Nina sourit. Marco la regarde.');
  });

  it('le constat est stable : la meme histoire donne les memes cles (une acceptation survit au rechargement)', () => {
    const cles = (f: ReturnType<typeof film>) => auditFidelite(f).ecarts.map((e) => e.cle);
    expect(cles(film('Nina sourit. Marco la regarde.'))).toEqual(cles(film('Nina sourit. Marco la regarde.')));
  });

  it('le PATCH « accepter » remplace la liste, deduplique et ignore ce qui n’est pas une cle', () => {
    const f = film('Nina sourit. Marco la regarde.');
    const a = appliquerPatch(f, { accepter: ['k1', 'k1', 42, '', 'k2'] });
    expect(a.ecartsAcceptes).toEqual(['k1', 'k2']);
    expect(appliquerPatch(a, { accepter: [] }).ecartsAcceptes).toEqual([]);
    expect(appliquerPatch(a, { style: 'noir' }).ecartsAcceptes).toEqual(['k1', 'k2']);
  });
});
