/**
 * GELS AUX COUPES — rendu temps réel de Créer.
 *
 * Rendu réel DANSE (5) : jusqu'à 1,47 s d'image figée autour des coupes.
 * Lecteurs simulés fidèles au navigateur : pendant un repositionnement
 * (`seeking`), l'élément présente sa DERNIÈRE image décodée. On mesure, à
 * 30 i/s, le plus long intervalle d'images identiques peintes sur le canvas.
 *
 *  - AVANT : l'ancienne logique (repositionnement AU MOMENT de la coupe) ;
 *  - APRÈS : le pilote (double tampon + préparation pendant le plan en cours).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { attribuerLecteurs, creerPiloteMontage, type LecteurVideo } from '@/lib/creer/pilote-montage';

const FPS = 30;
const DT = 1 / FPS;

/** Lecteur simulé : un repositionnement dure `latence` s, image figée pendant ce temps. */
class LecteurSimule implements LecteurVideo {
  paused = true;
  seeking = false;
  readyState = 4;
  playbackRate = 1;
  private position = 0;
  private finSeek = 0;
  private imageAffichee: number;
  constructor(readonly nom: string, private readonly horloge: { t: number }, private readonly latence: number) {
    this.imageAffichee = 0;
  }
  get currentTime() { return this.position; }
  set currentTime(v: number) {
    this.position = v;
    this.seeking = true;
    this.readyState = 1;
    this.finSeek = this.horloge.t + this.latence;
  }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  /** Avance d'une image d'horloge. */
  avancer() {
    if (this.seeking && this.horloge.t >= this.finSeek - 1e-9) { this.seeking = false; this.readyState = 4; }
    if (!this.seeking) {
      if (!this.paused) this.position += DT * this.playbackRate;
      this.imageAffichee = Math.floor(this.position * FPS + 1e-6);
    }
  }
  /** Ce que `drawImage` peint : la dernière image décodée. */
  image() { return `${this.nom}#${this.imageAffichee}`; }
}

/** Plan DANSE type : coupes rapides 0,8–1,6 s, 3 rushes, coupes internes comprises. */
const PLAN = [
  { url: 'A', debut: 0, fin: 1.0, depuis: 3 },
  { url: 'B', debut: 1.0, fin: 2.2, depuis: 7 },
  { url: 'B', debut: 2.2, fin: 3.0, depuis: 12 }, // coupe interne
  { url: 'C', debut: 3.0, fin: 4.6, depuis: 2 },
  { url: 'A', debut: 4.6, fin: 5.4, depuis: 9 },
  { url: 'A', debut: 5.4, fin: 6.6, depuis: 15 }, // coupe interne
  { url: 'C', debut: 6.6, fin: 7.4, depuis: 11 },
  { url: 'B', debut: 7.4, fin: 9.0, depuis: 20 },
];
const DUREE = 9;

function gelMax(peindre: (t: number) => LecteurSimule | null, lecteurs: LecteurSimule[], horloge: { t: number }): number {
  let precedente = '';
  let depuis = 0;
  let max = 0;
  for (let i = 0; i * DT < DUREE; i++) {
    horloge.t = i * DT;
    const el = peindre(horloge.t);
    lecteurs.forEach((l) => l.avancer());
    const image = el ? el.image() : 'vide';
    if (image !== precedente) { precedente = image; depuis = horloge.t; }
    max = Math.max(max, horloge.t - depuis + DT);
  }
  return max;
}

function simuler(latence: number) {
  const horloge = { t: 0 };
  // AVANT : un élément par rush, repositionné à la coupe (ancien compositeur).
  const avantEls = new Map(['A', 'B', 'C'].map((u) => [u, new LecteurSimule(u, horloge, latence)]));
  const avantPlan = PLAN.map((s) => ({ ...s, el: avantEls.get(s.url)! }));
  for (const el of avantEls.values()) { el.currentTime = avantPlan.find((s) => s.el === el)!.depuis; el.pause(); }
  let extraitCourant = -1;
  const avant = gelMax((t) => {
    const k = avantPlan.findIndex((s) => t >= s.debut && t < s.fin);
    const actif = avantPlan[k];
    for (const el of avantEls.values()) {
      if (el === actif.el) {
        if (el.paused || k !== extraitCourant) { el.currentTime = actif.depuis + (t - actif.debut); if (el.paused) el.play(); }
      } else if (!el.paused) el.pause();
    }
    extraitCourant = k;
    return actif.el;
  }, [...avantEls.values()], horloge);

  // APRÈS : double tampon + pilote.
  horloge.t = 0;
  const tampons = attribuerLecteurs(PLAN);
  const apresEls = new Map<string, LecteurSimule>();
  const plan = PLAN.map((s, k) => {
    const cle = `${s.url}${tampons[k]}`;
    if (!apresEls.has(cle)) apresEls.set(cle, new LecteurSimule(cle, horloge, latence));
    return { ...s, el: apresEls.get(cle)! };
  });
  const pilote = creerPiloteMontage(plan);
  pilote.prepositionner();
  // Le préchargement initial a le temps de se faire avant l'enregistrement.
  horloge.t = 10; for (const el of apresEls.values()) el.avancer();
  horloge.t = 0;
  const apres = gelMax((t) => pilote.image(t), [...apresEls.values()], horloge);
  return { avant, apres, bilan: pilote.bilan() };
}

describe('gels aux coupes (lecteurs simulés, 30 i/s)', () => {
  it('double tampon : deux extraits consécutifs du même rush n’utilisent jamais le même lecteur', () => {
    const t = attribuerLecteurs(PLAN);
    PLAN.forEach((s, k) => { if (k > 0 && PLAN[k - 1].url === s.url) expect(t[k]).not.toBe(t[k - 1]); });
  });

  it('latence de repositionnement 0,6 s : AVANT ≥ 0,5 s de gel, APRÈS ≤ 100 ms', () => {
    const r = simuler(0.6);
    expect(r.avant).toBeGreaterThanOrEqual(0.5);
    expect(r.apres).toBeLessThanOrEqual(0.1 + 1e-6);
    expect(r.bilan.coupesNonPretes).toBe(0);
    expect(r.bilan.coupes).toBe(PLAN.length - 1);
  });

  it('latence 0,3 s (cache) et 1,5 s (plus longue qu’un plan) : APRÈS ≤ 100 ms', () => {
    expect(simuler(0.3).apres).toBeLessThanOrEqual(0.1 + 1e-6);
    // Chaque lecteur libre est préparé sur son prochain extrait dès qu'il se
    // libère : l'avance dépasse la durée d'un seul plan.
    const r = simuler(1.5);
    expect(r.avant).toBeGreaterThanOrEqual(1.4);
    expect(r.apres).toBeLessThanOrEqual(0.1 + 1e-6);
  });

  it('image suivante jamais prête : le plan en cours continue de jouer, coupe reportée ≤ 0,25 s puis signalée', () => {
    const r = simuler(3);
    expect(r.bilan.coupesNonPretes).toBeGreaterThan(0);
    expect(r.bilan.reportMax).toBeLessThanOrEqual(0.25 + DT);
  });
});

describe('câblage du compositeur', () => {
  const c = readFileSync(resolve(process.cwd(), 'src/lib/video-composer.ts'), 'utf-8');
  it('le rendu temps réel passe par le pilote, plus de repositionnement à la coupe', () => {
    expect(c).toContain('const el = pilote.image(dedans ? t - vs : null);');
    expect(c).toContain('if (pilote) pilote.prepositionner();');
    expect(c).not.toContain('if (el.paused || k !== extraitCourant) {');
  });
  it('double tampon chargé et peint ; instrumentation journalisée', () => {
    expect(c).toContain('const tampons = planAjuste ? attribuerLecteurs(planAjuste) : [];');
    expect(c).toContain('lecteurAffiche ?? segmentA(rushPlan, secondsIn)?.el ?? videoEl');
    expect(c).toContain("console.log('[Composer] Coupes :'");
  });
});
