import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  clampBounds, effectiveBounds, isTrimmed, timeToRatio, ratioToTime, timecode, boundsLabel,
  MIN_CLIP_SECONDS, MAX_CLIP_SECONDS,
} from '@/lib/creer/clipTrim';

/**
 * Rognage manuel d'un temps fort.
 *
 * La modale vit dans `components/media/ClipDetectorModal` — et non dans
 * `AssistantWizard` comme le laissait entendre l'énoncé.
 *
 * Les bornes décident de ce qui part réellement à l'extraction, et une borne
 * fausse ne se voit qu'**après** avoir attendu un rendu en temps réel. D'où
 * des règles pures, vérifiées sur des valeurs.
 *
 * Le détail qui décide de la sensation du geste : `clampBounds` sait **quelle
 * poignée** l'utilisateur tire. Sans cette information, tirer la fin vers la
 * gauche repousserait le début, et la séquence **glisserait** au lieu de se
 * raccourcir.
 */

const modale = readFileSync(
  resolve(__dirname, '../components/media/ClipDetectorModal.tsx'),
  'utf-8',
);

describe('Default-safe : sans rognage, rien ne change', () => {
  it('les bornes effectives sont celles détectées', () => {
    expect(effectiveBounds({ startTime: 2, endTime: 5 }, undefined)).toEqual({ start: 2, end: 5 });
    expect(effectiveBounds({ startTime: 2, endTime: 5 }, null)).toEqual({ start: 2, end: 5 });
  });

  it('une séquence non retouchée ne se signale pas comme telle', () => {
    expect(isTrimmed({ startTime: 2, endTime: 5 }, undefined)).toBe(false);
    expect(isTrimmed({ startTime: 2, endTime: 5 }, { start: 2, end: 5 })).toBe(false);
  });

  it('une séquence retouchée, si', () => {
    expect(isTrimmed({ startTime: 2, endTime: 5 }, { start: 2.5, end: 5 })).toBe(true);
    expect(isTrimmed({ startTime: 2, endTime: 5 }, { start: 2, end: 4 })).toBe(true);
  });

  it('les réglages sont oubliés à chaque nouvelle analyse', () => {
    // Ils appartiendraient sinon aux séquences d'un AUTRE rush.
    expect(modale).toContain('setTrims({});');
  });
});

describe('C est la poignée TIRÉE qui suit le curseur', () => {
  it('tirer la fin vers la gauche raccourcit — le début ne bouge pas', () => {
    const b = clampBounds({ start: 2, end: 2.1 }, 30, 'end');
    expect(b.start).toBe(2);
    expect(b.end - b.start).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS);
  });

  it('tirer le début vers la droite raccourcit — la fin ne bouge pas', () => {
    const b = clampBounds({ start: 4.9, end: 5 }, 30, 'start');
    expect(b.end).toBe(5);
    expect(b.end - b.start).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS);
  });

  it('des poignées croisées sont remises dans l ordre', () => {
    const b = clampBounds({ start: 8, end: 3 }, 30, 'end');
    expect(b.end).toBeGreaterThan(b.start);
  });

  it('la durée maximale rogne du côté qui NE bouge PAS', () => {
    // La poignée tenue doit suivre le curseur, sinon le geste semble bloqué.
    const fin = clampBounds({ start: 0, end: 200 }, 300, 'end');
    expect(fin.end).toBe(200);
    expect(fin.end - fin.start).toBe(MAX_CLIP_SECONDS);

    const debut = clampBounds({ start: 0, end: 200 }, 300, 'start');
    expect(debut.start).toBe(0);
    expect(debut.end - debut.start).toBe(MAX_CLIP_SECONDS);
  });
});

describe('Les bornes restent dans la source', () => {
  it('jamais avant zéro ni après la fin', () => {
    const b = clampBounds({ start: -10, end: 999 }, 12, 'end');
    expect(b.start).toBeGreaterThanOrEqual(0);
    expect(b.end).toBeLessThanOrEqual(12);
  });

  it('la fin est toujours STRICTEMENT après le début', () => {
    // Deux poignées au même endroit deviendraient insaisissables.
    for (const moved of ['start', 'end'] as const) {
      const b = clampBounds({ start: 5, end: 5 }, 30, moved);
      expect(b.end, moved).toBeGreaterThan(b.start);
    }
  });

  it('une source plus courte que la durée minimale ne fait pas tout casser', () => {
    const b = clampBounds({ start: 0, end: 10 }, 0.2, 'end');
    expect(b.end).toBeGreaterThan(b.start);
    expect(b.start).toBeGreaterThanOrEqual(0);
  });

  it('des valeurs non finies retombent sur quelque chose d exploitable', () => {
    const b = clampBounds({ start: Number.NaN, end: Number.POSITIVE_INFINITY }, 20, 'end');
    expect(Number.isFinite(b.start)).toBe(true);
    expect(Number.isFinite(b.end)).toBe(true);
    expect(b.end).toBeGreaterThan(b.start);
  });

  it('les bornes sont arrondies au centième — le seek ne vaut pas mieux', () => {
    const b = clampBounds({ start: 1.234567, end: 5.987654 }, 30, 'end');
    expect(b.start).toBe(1.23);
    expect(b.end).toBe(5.99);
  });
});

describe('La timeline', () => {
  it('convertit un instant en position', () => {
    expect(timeToRatio(0, 20)).toBe(0);
    expect(timeToRatio(10, 20)).toBe(0.5);
    expect(timeToRatio(20, 20)).toBe(1);
  });

  it('et une position en instant', () => {
    const rect = { left: 100, width: 200 };
    expect(ratioToTime(100, rect, 20)).toBe(0);
    expect(ratioToTime(200, rect, 20)).toBe(10);
    expect(ratioToTime(300, rect, 20)).toBe(20);
  });

  it('un glissement au-delà des bords reste dans la source', () => {
    const rect = { left: 100, width: 200 };
    expect(ratioToTime(-500, rect, 20)).toBe(0);
    expect(ratioToTime(9999, rect, 20)).toBe(20);
  });

  it('une source de durée nulle ne divise pas par zéro', () => {
    expect(timeToRatio(5, 0)).toBe(0);
    expect(ratioToTime(150, { left: 100, width: 200 }, 0)).toBe(0);
  });

  it('une zone de largeur nulle non plus', () => {
    expect(ratioToTime(150, { left: 100, width: 0 }, 20)).toBe(0);
  });
});

describe('L étiquette', () => {
  it('donne les deux timecodes et la durée', () => {
    expect(boundsLabel({ start: 0, end: 2.6 })).toBe('0:00 → 0:02 · 2,6 s');
  });

  it('la virgule décimale, en français', () => {
    expect(boundsLabel({ start: 61, end: 64.25 })).toContain('1:01 → 1:04');
    expect(boundsLabel({ start: 61, end: 64.25 })).toContain(',');
  });

  it('le timecode ne montre jamais NaN ni de valeur négative', () => {
    expect(timecode(Number.NaN)).toBe('0:00');
    expect(timecode(-12)).toBe('0:00');
    expect(timecode(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('La modale utilise les bornes RÉGLÉES', () => {
  it('l aperçu démarre et s arrête dessus', () => {
    expect(modale).toContain('const bornes = bornesDe(clip);');
    expect(modale).toContain('vid.currentTime = bornes.start;');
    expect(modale).toContain('v.currentTime >= bornes.end');
  });

  it('l extraction aussi — c est tout l objet du rognage', () => {
    expect(modale).toContain('const bornesExtraction = bornesDe(clip);');
    expect(modale).toContain('extractClip(file, bornesExtraction.start, bornesExtraction.end,');
    // Plus aucune extraction sur les bornes automatiques.
    expect(modale).not.toContain('extractClip(file, clip.startTime, clip.endTime,');
  });

  it('le budget de temps suit la durée RÉGLÉE, pas la détectée', () => {
    // Rogner à deux secondes une séquence détectée à trente laisserait
    // sinon un budget quinze fois trop large.
    expect(modale).toContain('(bornesExtraction.end - bornesExtraction.start) * 3000 + 30_000');
  });

  it('la durée de la source vient de la détection', () => {
    expect(modale).toContain('setSourceDuration(result.totalDuration);');
  });
});

describe('Le geste', () => {
  it('saisit la poignée la PLUS PROCHE du clic', () => {
    // Viser la bonne à deux pixels près serait impraticable.
    expect(modale).toContain("Math.abs(t - b.start) <= Math.abs(t - b.end) ? 'start' : 'end'");
  });

  it('capture le pointeur — le glissement survit à la sortie de la zone', () => {
    expect(modale).toContain('e.currentTarget.setPointerCapture(e.pointerId);');
    expect(modale).toContain('onLostPointerCapture={() => setDragHandle(null)}');
  });

  it('ne déplace rien tant qu aucune poignée n est tenue', () => {
    expect(modale).toContain('if (!dragHandle) return;');
  });

  it('la poignée tirée est transmise au bornage', () => {
    expect(modale).toContain('clampBounds(propose, sourceDuration, poignee)');
  });

  it('on peut rétablir les bornes détectées', () => {
    expect(modale).toContain('data-clip-reset');
    expect(modale).toContain('const reinitialiserBornes = useCallback');
  });

  it('le bouton « rétablir » n apparaît que si l on a retouché', () => {
    expect(modale).toContain('isTrimmed(previewClip, trims[previewClip.id])');
  });
});
