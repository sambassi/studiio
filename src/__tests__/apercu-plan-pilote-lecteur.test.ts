/**
 * M3-a PR3 — pilote (image figée, retour au début, changement de rush à deux
 * lecteurs alternés), moteur de l'aperçu rapide (positionnement impossible,
 * média 404), surimpressions (parité avec le compositeur), filigrane,
 * résolution bornée, et AUCUN chemin d'enregistrement / téléchargement.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { creerPiloteMontage, alternerLecteurs, attribuerLecteurs, type LecteurVideo } from '@/lib/creer/pilote-montage';
import {
  MoteurApercuPlan, dimensionsApercu, etatSurimpression, occurrencesFiligrane, peindreFiligrane, couvertureFiligrane,
  motifFiligrane, APERCU_COTE_MAX, FILIGRANE_OPACITE, rectangleImageApercu,
} from '@/lib/creer/apercu-plan-lecteur';
import { dessinerSurimpressions } from '@/lib/video-composer';
import { rectangleRush } from '@/lib/creer/recadrage-rush';

class Faux implements LecteurVideo {
  currentTime = 0; paused = true; seeking = false; readyState = 4; playbackRate = 1;
  src = ''; plays = 0; seeks: number[] = [];
  play() { this.paused = false; this.plays += 1; return Promise.resolve(); }
  pause() { this.paused = true; }
}
const suivi = (f: Faux) => new Proxy(f, {
  set(t, k, v) { if (k === 'currentTime') t.seeks.push(v); (t as unknown as Record<string | symbol, unknown>)[k] = v; return true; },
});

const PLAN = [
  { url: 'r1', debut: 0, fin: 2, depuis: 10 },
  { url: 'r2', debut: 2, fin: 4, depuis: 5 },
  { url: 'r1', debut: 4, fin: 6, depuis: 20 },
];

describe('pilote — ajouts de l’aperçu, compositeur inchangé', () => {
  it('sans source : aucun chargement, attribuerLecteurs inchangé', () => {
    expect(attribuerLecteurs(PLAN)).toEqual([0, 0, 0]);
    const a = suivi(new Faux());
    const charger = vi.fn();
    const p = creerPiloteMontage([{ el: a, debut: 0, fin: 2, depuis: 3 }], { charger });
    p.image(0.1);
    expect(charger).not.toHaveBeenCalled();
    expect(a.paused).toBe(false);
  });
  it('deux lecteurs alternés + source : le suivant est chargé et positionné PENDANT le plan en cours', () => {
    expect(alternerLecteurs(3)).toEqual([0, 1, 0]);
    const els = [suivi(new Faux()), suivi(new Faux())];
    const sources = new Map<Faux, string>();
    const p = creerPiloteMontage(PLAN.map((s, k) => ({ el: els[k % 2], debut: s.debut, fin: s.fin, depuis: s.depuis, source: s.url })), {
      charger: (el, src) => { sources.set(el, src); (el as Faux).src = src; },
    });
    expect(p.image(0.1)).toBe(els[0]);
    expect(sources.get(els[0])).toBe('r1');
    expect(sources.get(els[1])).toBe('r2'); // préparé
    expect(els[1].currentTime).toBe(5);
    expect(els[1].paused).toBe(true);
    // coupe → r2 sur le lecteur 1 ; le lecteur 0 se recharge sur r1@20 pour l'extrait 3
    expect(p.image(2.05)).toBe(els[1]);
    expect(sources.get(els[0])).toBe('r1');
    expect(els[0].currentTime).toBe(20);
    expect(p.image(4.05)).toBe(els[0]);
  });
  it('changement de rush : un lecteur qui porte une AUTRE source n’est jamais « prêt »', () => {
    const els = [suivi(new Faux()), suivi(new Faux())];
    let charges = 0;
    const p = creerPiloteMontage([{ el: els[0], debut: 0, fin: 1, depuis: 0, source: 'a' }, { el: els[1], debut: 1, fin: 2, depuis: 7, source: 'b' }], {
      charger: () => { charges += 1; },
    });
    p.image(0);
    expect(charges).toBe(2);
  });
  it('positionner() : image FIGÉE exacte, aucune lecture, puis image() redémarre', () => {
    const els = [suivi(new Faux()), suivi(new Faux())];
    const p = creerPiloteMontage(PLAN.map((s, k) => ({ el: els[k % 2], debut: s.debut, fin: s.fin, depuis: s.depuis, source: s.url })), { charger: () => {} });
    const el = p.positionner(3.5)!;
    expect(el).toBe(els[1]);
    expect(el.currentTime).toBeCloseTo(6.5, 5);
    expect(els.every((e) => e.paused)).toBe(true);
    expect(els[0].plays + els[1].plays).toBe(0);
    expect(p.image(3.5)).toBe(els[1]);
    expect(els[1].paused).toBe(false);
  });
  it('retour au début : nouvelle instance ⇒ extrait 1 repositionné', () => {
    const els = [suivi(new Faux()), suivi(new Faux())];
    const mk = () => creerPiloteMontage(PLAN.map((s, k) => ({ el: els[k % 2], debut: s.debut, fin: s.fin, depuis: s.depuis, source: s.url })), { charger: () => {} });
    const p1 = mk(); p1.image(0); p1.image(2.1); p1.image(4.2);
    const p2 = mk();
    expect(p2.image(0)).toBe(els[0]);
    expect(els[0].currentTime).toBeCloseTo(10, 5);
    expect(p2.indexA(0)).toBe(0);
  });
});

// ── Moteur (éléments simulés) ─────────────────────────────────────────────
type FauxEl = HTMLVideoElement & { _l: Record<string, Array<() => void>>; fire: (n: string) => void };
function fauxVideo(): FauxEl {
  const l: Record<string, Array<() => void>> = {};
  const attrs: Record<string, string> = {};
  const el = {
    _l: l, currentTime: 0, paused: true, seeking: false, readyState: 4, playbackRate: 1, muted: false, defaultMuted: false,
    playsInline: false, preload: '', controls: true, crossOrigin: null as string | null, videoWidth: 1080, videoHeight: 1920,
    set src(v: string) { attrs.src = v; }, get src() { return attrs.src ?? ''; },
    setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k] ?? null, removeAttribute: (k: string) => { delete attrs[k]; },
    addEventListener: (n: string, f: () => void) => { (l[n] ??= []).push(f); },
    play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; }, load() {},
    fire: (n: string) => (l[n] ?? []).forEach((f) => f()),
    attrs,
  };
  return el as unknown as FauxEl;
}

describe('MoteurApercuPlan', () => {
  it('deux éléments seulement, muets, sans contrôles ni téléchargement', () => {
    const crees: FauxEl[] = [];
    const m = new MoteurApercuPlan(PLAN, { creerVideo: () => { const v = fauxVideo(); crees.push(v); return v; } });
    expect(crees).toHaveLength(2);
    for (const v of crees) {
      expect(v.muted).toBe(true);
      expect(v.controls).toBe(false);
      expect(v.getAttribute('controlsList')).toContain('nodownload');
    }
    const img = m.image(2.5, true)!;
    expect(img.index).toBe(1);
    expect(img.source).toBe('r2');
    expect(img.cible).toBeCloseTo(5.5, 5);
  });
  it('image figée : aucune lecture ; reprise : nouvelle instance', () => {
    const crees: FauxEl[] = [];
    const m = new MoteurApercuPlan(PLAN, { creerVideo: () => { const v = fauxVideo(); crees.push(v); return v; } });
    m.image(4.5, false);
    expect(crees.every((v) => v.paused)).toBe(true);
    expect(crees[0].currentTime).toBeCloseTo(20.5, 5);
    m.image(4.5, true);
    expect(crees[0].paused).toBe(false);
  });
  it('position perdue après « seeked » (pas de plages d’octets) ⇒ problème « positionnement »', async () => {
    vi.useFakeTimers();
    const crees: FauxEl[] = [];
    const surProbleme = vi.fn();
    const m = new MoteurApercuPlan(PLAN, { creerVideo: () => { const v = fauxVideo(); crees.push(v); return v; }, surProbleme });
    m.image(0.5, false); // cible 10,5 s
    crees[0].currentTime = 0; // le serveur ignore le positionnement
    crees[0].fire('seeked');
    vi.advanceTimersByTime(300);
    expect(surProbleme).toHaveBeenCalledWith('positionnement');
    expect(m.probleme).toBe('positionnement');
    vi.useRealTimers();
  });
  it('positionnement tenu ⇒ aucun problème', () => {
    vi.useFakeTimers();
    const crees: FauxEl[] = [];
    const surProbleme = vi.fn();
    const m = new MoteurApercuPlan(PLAN, { creerVideo: () => { const v = fauxVideo(); crees.push(v); return v; }, surProbleme });
    m.image(0.5, false);
    crees[0].fire('seeked');
    vi.advanceTimersByTime(300);
    expect(surProbleme).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('média 404 (error) ⇒ problème « media »', () => {
    const crees: FauxEl[] = [];
    const surProbleme = vi.fn();
    const m = new MoteurApercuPlan(PLAN, { creerVideo: () => { const v = fauxVideo(); crees.push(v); return v; }, surProbleme });
    m.image(0.1, true);
    crees[0].fire('error');
    expect(surProbleme).toHaveBeenCalledWith('media');
  });
  it('recadrage de l’EXTRAIT courant (par URL), même rectangle que l’export', () => {
    const r = rectangleImageApercu({ videoWidth: 1920, videoHeight: 1080 }, 'r2', 304, 540, { r2: { scale: 1.5, offsetX: 0.1, offsetY: 0 } });
    expect(r).toEqual(rectangleRush(1920, 1080, 304, 540, { scale: 1.5, offsetX: 0.1, offsetY: 0 }));
    expect(rectangleImageApercu({ videoWidth: 1920, videoHeight: 1080 }, 'r1', 304, 540, { r2: { scale: 1.5, offsetX: 0.1, offsetY: 0 } }))
      .toEqual(rectangleRush(1920, 1080, 304, 540, null));
  });
});

describe('surimpressions : formule du compositeur', () => {
  it('opacité et glissement identiques à dessinerSurimpressions, image par image', () => {
    const fenetres = { titre: [0, 2.5] as [number, number], cartes: [{ index: 0, debut: 1.8, fin: 4.1 }], cta: [8, 10] as [number, number], voix: {} };
    for (let i = 0; i <= 330; i += 1) {
      const s = i / 30;
      const traces: Array<{ a: number; y: number }> = [];
      let alpha = 1;
      const ctx = {
        save() {}, restore() {}, set globalAlpha(v: number) { alpha = v; }, get globalAlpha() { return alpha; },
        createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '',
        drawImage: (_img: unknown, _x: number, y: number) => traces.push({ a: alpha, y }),
      } as unknown as CanvasRenderingContext2D;
      const img = {} as CanvasImageSource;
      dessinerSurimpressions(ctx, 1080, 1920, s, { fenetres, images: { titre: img, cartes: { 0: img }, cta: img } });
      const nous = [
        etatSurimpression(s, 0, 2.5), etatSurimpression(s, 1.8, 4.1), etatSurimpression(s, 8, 10),
      ].filter(Boolean).map((e) => ({ a: e!.opacite, y: e!.decalage }));
      expect(nous, `t=${s}`).toEqual(traces);
    }
  });
});

describe('résolution bornée et filigrane', () => {
  it('plus grand côté ≤ 540 px, les trois formats', () => {
    expect(dimensionsApercu('9:16')).toEqual({ w: 304, h: 540 });
    expect(dimensionsApercu('16:9')).toEqual({ w: 540, h: 304 });
    expect(dimensionsApercu('1:1')).toEqual({ w: 540, h: 540 });
    for (const f of ['9:16', '16:9', '1:1'] as const) expect(Math.max(dimensionsApercu(f).w, dimensionsApercu(f).h)).toBeLessThanOrEqual(APERCU_COTE_MAX);
  });
  it('filigrane présent à CHAQUE instant, dans chaque quart du cadre, et en mouvement', () => {
    for (const f of ['9:16', '16:9', '1:1'] as const) {
      const { w, h } = dimensionsApercu(f);
      const { pasX } = motifFiligrane(w, h);
      let precedent = '';
      for (let ms = 0; ms <= 30000; ms += 250) {
        const pts = occurrencesFiligrane(w, h, ms).filter((p) => p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h);
        expect(pts.length, `${f} ${ms}`).toBeGreaterThanOrEqual(4);
        // chaque moitié haute / basse et gauche / droite porte une occurrence (à un pas près)
        expect(pts.some((p) => p.y < h / 2 + pasX / 2) && pts.some((p) => p.y > h / 2 - pasX / 2)).toBe(true);
        const sig = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('|');
        if (ms > 0 && ms % 14000 !== 0) expect(sig).not.toBe(precedent);
        precedent = sig;
      }
    }
  });
  it('opacité 20–30 % ; surface couverte mesurée', () => {
    expect(FILIGRANE_OPACITE).toBeGreaterThanOrEqual(0.2);
    expect(FILIGRANE_OPACITE).toBeLessThanOrEqual(0.3);
    for (const f of ['9:16', '16:9', '1:1'] as const) {
      const { w, h } = dimensionsApercu(f);
      const c = couvertureFiligrane(w, h);
      expect(c).toBeGreaterThan(0.05);
      expect(c).toBeLessThan(0.35);
    }
  });
  it('peint DANS le canvas : une occurrence par point, opacité appliquée', () => {
    const appels: Array<{ alpha: number }> = [];
    let alpha = 1;
    const ctx = {
      save() {}, restore() {}, setTransform() {}, translate() {}, rotate() {}, strokeText() {},
      set globalAlpha(v: number) { alpha = v; }, get globalAlpha() { return alpha; },
      fillText: () => appels.push({ alpha }), font: '', textAlign: '', textBaseline: '', lineWidth: 1, strokeStyle: '', fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const n = peindreFiligrane(ctx, 304, 540, 1234);
    expect(n).toBe(occurrencesFiligrane(304, 540, 1234).length);
    expect(appels).toHaveLength(n);
    expect(appels.every((a) => a.alpha === FILIGRANE_OPACITE)).toBe(true);
  });
});

describe('jamais de fichier depuis l’aperçu rapide', () => {
  const fichiers = ['src/lib/creer/apercu-plan-lecteur.ts', 'src/components/creer/LecteurPlanApercu.tsx', 'src/lib/creer/preparer-plan-montage.ts'];
  it.each(fichiers)('%s : ni MediaRecorder, ni captureStream, ni toBlob/toDataURL, ni téléchargement, ni appel réseau', (f) => {
    const s = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(s).not.toMatch(/MediaRecorder|captureStream|toBlob|toDataURL|downloadBlob|download=|createObjectURL|fetch\(|XMLHttpRequest|\/api\//);
  });
});
