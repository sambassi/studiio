/**
 * Fondu vers le CTA — la chronologie et l'aperçu disent ce que le rendu fait.
 *
 * Le compositeur place la transition dans les `TRANSITION_DURATION_SECONDS`
 * (0,8 s) DERNIÈRES secondes de la séquence sortante : le dernier média JOUE
 * jusqu'à sa fin planifiée, et le CTA apparaît en fondu par-dessus pendant ces
 * 0,8 s. La chronologie l'affiche (« CTA 12–16 s · fondu 0,8 s ») au lieu de
 * laisser croire à une coupe franche à 12 s ; l'aperçu montre le même fondu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';

Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });

import { avecDureeChoisie, chronologieListe, planApercuListe, planDetaille, type MediaVideo } from '@/lib/creer/medias-video';
import { TRANSITION_DURATION_SECONDS } from '@/lib/creer/transitionPreview';
import ApercuMontageListe from '@/components/creer/ApercuMontageListe';

const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-plage.mp4';
const PHOTO = 'https://studiio.pro/storage/v1/object/public/media/u1/library/photo-plage.jpg';
const STOCK_V = 'https://studiio.pro/storage/v1/object/public/media/u1/library/stock-pexels-video-123.mp4';
const liste: MediaVideo[] = [
  { id: 'r1', source: 'rush', type: 'video', url: RUSH, duree: 4, nom: 'rush-plage.mp4' },
  avecDureeChoisie({ id: 'p1', source: 'stock-photo', type: 'image', url: PHOTO, duree: 3 }, 5),
  { id: 's1', source: 'stock-video', type: 'video', url: STOCK_V, duree: 3, nom: 'Vidéo suggérée' },
];

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('chronologie — fondu entrant du CTA', () => {
  it('le CTA garde son début planifié (12 s) et annonce le fondu de 0,8 s qui le précède', () => {
    const { lignes } = chronologieListe(planDetaille(liste), { dureeCta: 4 });
    const cta = lignes[lignes.length - 1];
    expect(cta).toMatchObject({ id: 'cta', debut: 12, fin: 16, fondu: TRANSITION_DURATION_SECONDS });
    // Le dernier média n'est PAS raccourci : il joue jusqu'à 12 s.
    expect(lignes[2]).toMatchObject({ id: 's1', debut: 9, fin: 12 });
    expect(lignes.slice(0, 3).every((l) => l.fondu === undefined)).toBe(true);
  });

  it('sans CTA : aucun fondu annoncé', () => {
    const { lignes } = chronologieListe(planDetaille(liste));
    expect(lignes.some((l) => l.fondu !== undefined)).toBe(false);
  });

  it('libellé et attribut visibles sur la ligne du CTA', () => {
    const plan = planDetaille(liste);
    const { container } = render(
      <ApercuMontageListe etapes={planApercuListe(plan).etapes} lignes={chronologieListe(plan, { dureeCta: 4 }).lignes} format="9:16" accent="#7C3AED" ctaTexte="Viens" vignetteAvatar={null} />,
    );
    const b = container.querySelector('[data-ligne="cta"]')!;
    expect(b.getAttribute('data-fondu')).toBe('0.8');
    expect(b.textContent).toContain('CTA 12–16 s');
    expect(b.textContent).toContain('fondu 0,8 s');
    expect(b.getAttribute('title')).toMatch(/joue jusqu’à 12 s/);
  });
});

describe('aperçu — le même fondu que le rendu', () => {
  it('le dernier média reste l’étape courante jusqu’à 12 s, le CTA monte par-dessus de 11,2 à 12 s', () => {
    vi.useFakeTimers();
    const plan = planDetaille(liste);
    const { container } = render(
      <ApercuMontageListe etapes={planApercuListe(plan).etapes} lignes={chronologieListe(plan, { dureeCta: 4 }).lignes} format="9:16" accent="#7C3AED" ctaTexte="Viens" vignetteAvatar={null} />,
    );
    const racine = container.querySelector('[data-apercu-montage]')!;
    // Saut à 9 s (début de la vidéo suggérée), puis lecture.
    act(() => { fireEvent.click(container.querySelector('[data-ligne="s1"]')!); });
    act(() => { fireEvent.click(container.querySelector('[data-apercu-montage-lecture]')!); });
    const releve: Array<{ etape: string; fondu: number | null; cta: boolean }> = [];
    for (let i = 0; i < 70; i += 1) {
      act(() => { vi.advanceTimersByTime(50); });
      const f = container.querySelector('[data-apercu-montage-cta-fondu]');
      releve.push({ etape: racine.getAttribute('data-etape-courante')!, fondu: f ? Number(f.getAttribute('data-apercu-montage-cta-fondu')) : null, cta: !!container.querySelector('[data-apercu-montage-cta]') });
    }
    // Avant 11,2 s : la vidéo seule.
    expect(releve.slice(0, 40).every((r) => r.etape === 's1' && r.fondu === null)).toBe(true);
    // Pendant le fondu : TOUJOURS l'étape vidéo (elle joue), CTA en surimpression croissante.
    const fondus = releve.filter((r) => r.fondu !== null);
    expect(fondus.length).toBeGreaterThan(10);
    expect(fondus.every((r) => r.etape === 's1' && !r.cta)).toBe(true);
    for (let k = 1; k < fondus.length; k += 1) expect(fondus[k].fondu!).toBeGreaterThanOrEqual(fondus[k - 1].fondu!);
    // Après 12 s : le CTA seul.
    expect(releve[releve.length - 1]).toMatchObject({ etape: 'cta', fondu: null, cta: true });
  });
});
