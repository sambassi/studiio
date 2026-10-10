import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CRÉER — « RECADRER LA VIDÉO » : le rush REMPLIT le format, au cadrage choisi,
 * et l'export MP4 trace EXACTEMENT l'image de l'aperçu.
 *
 *   aperçu   : élément plein cadre, `object-fit: cover`,
 *              `translate(offsetX·100 %, offsetY·100 %) scale(scale)`
 *   export   : `drawVideoSeq` (compositeur) — cover × scale, centre + offset·cadre
 */
import {
  bornerRecadrageRush, rectangleRush, styleRecadrageRush, recadrageRushActif, RECADRAGE_RUSH_NEUTRE,
} from '../lib/creer/recadrage-rush';
import { drawVideoSeq } from '../lib/video-composer';

const FORMATS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] } as const;
const SOURCES = { '16:9': [1920, 1080], '9:16': [1080, 1920] } as const;

/** Ce que trace le compositeur : on capte `drawImage` (contexte factice). */
function traceExport(src: readonly [number, number], cadre: readonly [number, number], t: unknown) {
  const appels: number[][] = [];
  const ctx = new Proxy({}, {
    get: (_o, k) => (k === 'drawImage' ? (_s: unknown, ...a: number[]) => appels.push(a) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined),
    set: () => true,
  }) as unknown as CanvasRenderingContext2D;
  const video = { videoWidth: src[0], videoHeight: src[1] } as unknown as HTMLVideoElement;
  drawVideoSeq(ctx, cadre[0], cadre[1], video, null, 0.5, undefined, t as never);
  const [x, y, l, h] = appels[0];
  return { x, y, l, h };
}

/** Ce que montre l'aperçu CSS : cover dans un élément plein cadre, puis translate/scale autour du centre. */
function traceApercu(src: readonly [number, number], cadre: readonly [number, number], t: { scale: number; offsetX: number; offsetY: number }) {
  const [w, h] = cadre;
  const base = Math.max(w / src[0], h / src[1]);
  const l = src[0] * base * t.scale; const hh = src[1] * base * t.scale;
  const cx = w / 2 + t.offsetX * w; const cy = h / 2 + t.offsetY * h;
  return { x: cx - l / 2, y: cy - hh / 2, l, h: hh };
}

const pleinCadre = (r: { x: number; y: number; l: number; h: number }, w: number, h: number) =>
  r.x <= 0.5 && r.y <= 0.5 && r.x + r.l >= w - 0.5 && r.y + r.h >= h - 0.5;

describe('Recadrage du rush — rempli, sans bande, sans étirement, crop respecté', () => {
  const cas: Array<[keyof typeof SOURCES, keyof typeof FORMATS, { scale: number; offsetX: number; offsetY: number }]> = [
    ['16:9', '9:16', { scale: 1, offsetX: -0.6, offsetY: 0 }],
    ['16:9', '1:1', { scale: 1.4, offsetX: 0.3, offsetY: -0.1 }],
    ['9:16', '16:9', { scale: 1.2, offsetX: 0, offsetY: 0.5 }],
    ['9:16', '9:16', { scale: 1, offsetX: 0, offsetY: 0 }],
  ];
  for (const [s, f, demande] of cas) {
    it(`⚠️ source ${s} → sortie ${f} : cadre rempli, ratio de la source intact, export = aperçu`, () => {
      const src = SOURCES[s]; const cadre = FORMATS[f];
      const t = bornerRecadrageRush(demande, { srcW: src[0], srcH: src[1], w: cadre[0], h: cadre[1] });
      const exp = traceExport(src, cadre, t);
      const ap = traceApercu(src, cadre, t);
      // Export MP4 et aperçu : le MÊME rectangle.
      for (const k of ['x', 'y', 'l', 'h'] as const) expect(exp[k]).toBeCloseTo(ap[k], 3);
      // Aucune bande : l'image couvre tout le cadre.
      expect(pleinCadre(exp, cadre[0], cadre[1])).toBe(true);
      // Aucun étirement : le ratio dessiné est celui de la source.
      expect(exp.l / exp.h).toBeCloseTo(src[0] / src[1], 3);
      // Le rectangle de la lib est celui du compositeur.
      const r = rectangleRush(src[0], src[1], cadre[0], cadre[1], t);
      expect(r.x).toBeCloseTo(exp.x, 3);
    });
  }

  it('⚠️ 16:9 dans 9:16 : on peut faire glisser JUSQU’AU bord de la source, jamais au-delà (aucune bande)', () => {
    const dims = { srcW: 1920, srcH: 1080, w: 1080, h: 1920 };
    const t = bornerRecadrageRush({ scale: 1, offsetX: -5, offsetY: 3 }, dims);
    // À zoom 1, aucun débordement vertical : décalage Y nul ; horizontal borné au bord.
    expect(t.offsetY).toBe(0);
    const r = rectangleRush(1920, 1080, 1080, 1920, t);
    expect(r.x + r.l).toBeGreaterThanOrEqual(1080);
    expect(r.x + r.l).toBeLessThan(1080.5);
    expect(t.offsetX).toBeLessThan(-1.0);
  });

  it('9:16 → 9:16 sans recadrage : neutre, rien n’est enregistré (comportement d’avant)', () => {
    expect(recadrageRushActif(RECADRAGE_RUSH_NEUTRE)).toBe(false);
    expect(styleRecadrageRush(RECADRAGE_RUSH_NEUTRE)).toMatchObject({ objectFit: 'cover', width: '100%', height: '100%' });
  });

  it('repli pendant le chargement (ratio source inconnu) : cover + translate + scale', () => {
    expect(styleRecadrageRush({ scale: 1.5, offsetX: 0.2, offsetY: -0.1 })).toMatchObject({
      objectFit: 'cover', transform: 'translate(20%, -10%) scale(1.5)', transformOrigin: 'center',
    });
  });

  // Défaut vu au banc navigateur : en `cover` plein cadre, le navigateur coupe
  // l'image au bord de l'ÉLÉMENT — un glissé au-delà de (zoom-1)/2 montrait une
  // bande noire que l'export, lui, ne trace pas. Avec le ratio source, l'élément
  // a la taille de l'image dessinée : même rectangle que l'export, au pixel près.
  const pc = (v: unknown) => Number(String(v).replace('%', '')) / 100;
  for (const [nom, srcW, srcH, w, h, t] of [
    ['16:9 → 9:16, glissé à droite + zoom 1,5', 1920, 1080, 1080, 1920, { scale: 1.5, offsetX: 0.4368, offsetY: 0 }],
    ['16:9 → 9:16, glissé au bord gauche', 1920, 1080, 1080, 1920, { scale: 1, offsetX: -0.9, offsetY: 0 }],
    ['16:9 → 1:1, zoom 2 en haut', 1920, 1080, 1080, 1080, { scale: 2, offsetX: 0.1, offsetY: 0.4 }],
    ['9:16 → 16:9, en bas', 1080, 1920, 1920, 1080, { scale: 1.2, offsetX: 0, offsetY: -0.8 }],
    ['9:16 → 9:16, zoom 1,3', 1080, 1920, 1080, 1920, { scale: 1.3, offsetX: 0.1, offsetY: 0.1 }],
  ] as const) {
    it(`⚠️ aperçu = export, sans bande : ${nom}`, () => {
      const st = styleRecadrageRush(t, { source: srcW / srcH, cadre: w / h });
      const r = rectangleRush(srcW, srcH, w, h, t);
      expect(pc(st.left)).toBeCloseTo(r.x / w, 4);
      expect(pc(st.top)).toBeCloseTo(r.y / h, 4);
      expect(pc(st.width)).toBeCloseTo(r.l / w, 4);
      expect(pc(st.height)).toBeCloseTo(r.h / h, 4);
      // L'image couvre tout le cadre.
      expect(pc(st.left)).toBeLessThanOrEqual(1e-6);
      expect(pc(st.top)).toBeLessThanOrEqual(1e-6);
      expect(pc(st.left) + pc(st.width)).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(pc(st.top) + pc(st.height)).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(st.objectFit).toBe('fill'); // l'élément a le ratio de la source : pas d'étirement
      expect((pc(st.width) * w) / (pc(st.height) * h)).toBeCloseTo(srcW / srcH, 3);
    });
  }
});

describe('Recadrage du rush — la chaîne jusqu’à l’export et au post', () => {
  const lire = (f: string) => readFileSync(resolve(__dirname, '..', f), 'utf-8');
  const wizard = lire('app/dashboard/creer/AssistantWizard.tsx');

  // Recadrage PAR RUSH : l'export reçoit une table `rushTransforms` (clé = URL),
  // voir `creer-recadrage-par-rush.test.ts` pour le comportement détaillé.
  it('⚠️ l’export reçoit le recadrage (par rush) ; l’aperçu du plateau aussi', () => {
    expect(wizard).toContain('? recadragesRendu(plateau.rushUrl, plateau.rushs, planMontageRushs)');
    expect(wizard).toContain('style={styleRecadrageRush(\n                  rushTransform,');
  });

  it('⚠️ persisté : brouillon, métadonnées du post (création + Modifier), relu par le Calendrier', () => {
    expect(wizard).toContain('rushTransforms: (() => {');
    expect(wizard).toContain('setRushTransforms(recadragesRushAvecHeritage(draft.rushTransforms, draft.rushTransform, draft.rushUrl ?? null));');
    expect(lire('lib/creer/postMetadata/to-wizard.ts')).toContain("presence(meta, 'rushTransforms')");
    expect(lire('lib/creer/postMetadata/to-wizard.ts')).toContain("presence(meta, 'rushTransform')");
    expect(lire('lib/creer/postMetadata/from-wizard.ts')).toContain("poserSiChange(envoi, 'rushTransforms'");
    expect(lire('lib/rendus/options-depuis-metadata.ts')).toContain('fidelite.rushTransforms = recadragesRush');
  });

  it('⚠️ le jumeau généré dans Créer REMPLIT le format (aucune bande DANS le fichier)', () => {
    expect(wizard.match(/cadrage: 'remplir'/g)?.length).toBe(2);
  });
});
