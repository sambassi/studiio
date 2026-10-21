/**
 * Aperçu du style (Autopilote « Exemple de style », Créer) = rendu.
 *
 * Constat (banc UX, 21/10) : dans l'aperçu HTML, CTA « LEVIERS EFFICACES /
 * COMMENCE AUJOURD'HUI » dans un rectangle gris opaque alors que le rendu n'a
 * plus de fond ; et un titre long d'un seul mot doit tenir entier, comme dans
 * le moteur (`titreSur916` → `echelleTitreSansDebord`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { Preview } from '@/app/dashboard/creer/AssistantWizard';
import { lisibiliteCtaAction, CTA_ACTION_PANNEAU } from '@/lib/autopilot/cta-action';
import { FOND_TEXTE_SUR_IMAGE, contrasteSurVoile } from '@/lib/creer/contraste';
import { chassePolice } from '@/lib/creer/zones-sures-916';
import { VIDEO_SIZE } from '@/lib/creer/designSpec';
import { GEL_TEXT } from './fixtures/zones-sures-916-entrees';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
afterEach(() => cleanup());

const generated = {
  title: 'MOTIVATION', subtitle: 'Motivation scientifique : les leviers qui marchent vraiment',
  cards: [{ id: 'a', icon: 'Brain', title: 'HABIT STACKING', description: '', value: 'ANCRÉ' }],
  cta: 'LEVIERS EFFICACES', ctaSub: 'Commence aujourd’hui',
};

function apercu(format: '9:16' | '1:1' | '16:9', echelleTitre: number, ctaFond: string | null = null, titre = 'MOTIVATION') {
  const frameRef = { current: null } as React.RefObject<HTMLDivElement>;
  const text = { ...GEL_TEXT, title: { ...GEL_TEXT.title, scale: echelleTitre } };
  return render(
    <Preview generated={{ ...generated, title: titre } as never} format={format} frameRef={frameRef} displayScale={0.25}
      activeOrder={['intro', 'cards', 'cta']} gradStart="#7C3AED" gradEnd="#EC4899" gradientOpacity={0.3}
      accent="#7C3AED" text={text as never} ctaFond={ctaFond} />,
  ).container;
}

describe('Aperçu : un titre long d’un seul mot tient entier (3 formats)', () => {
  const formats = ['9:16', '1:1', '16:9'] as const;
  const cas = formats.flatMap((f) => (['MOTIVATION', 'ANTICONSTITUTIONNELLEMENT'] as const).map((t) => [f, t] as const));
  it.each(cas)('%s — « %s » à l’échelle 3 : mot ≤ largeur du cadre', (format, titre) => {
    const c = apercu(format, 3, null, titre);
    const bloc = c.querySelector<HTMLElement>('[data-title-block]')!;
    const texte = bloc.firstElementChild as HTMLElement;
    const px = parseFloat(texte.style.fontSize);
    const largeurCadre = (parseFloat(bloc.style.width) / 100) * VIDEO_SIZE[format].w;
    expect(titre.length * chassePolice('Inter', true).em * px).toBeLessThanOrEqual(largeurCadre + 0.5);
    // Le mot très long débordait sans la garde, dans les 3 formats.
    if (titre.length > 20) {
      expect(titre.length * chassePolice('Inter', true).em * VIDEO_SIZE[format].w * (format === '9:16' ? 0.04375 : 0.035) * 3).toBeGreaterThan(largeurCadre);
    }
  });
});

describe('Aperçu du style Autopilote : CTA d’action sans rectangle opaque', () => {
  const lisible = lisibiliteCtaAction({ cta: generated.cta, ctaSub: generated.ctaSub }, 1);
  it('le « panneau » du CTA d’action est transparent (même règle que les surimpressions)', () => {
    expect(CTA_ACTION_PANNEAU).toBe(FOND_TEXTE_SUR_IMAGE);
    expect(lisible.ctaBackground).toBe(FOND_TEXTE_SUR_IMAGE);
    expect(contrasteSurVoile(lisible.ctaSubColor)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['9:16', '1:1', '16:9'] as const)('%s — rendu de l’aperçu : aucun fond opaque, contour des glyphes', (format) => {
    const c = apercu(format, 1, lisible.ctaBackground);
    const fond = c.querySelector<HTMLElement>('[data-cta-fond]')!;
    expect(fond).toBeTruthy();
    expect(fond.style.backgroundColor).toBe('transparent');
    expect(fond.innerHTML).toContain('rgba(0,0,0,0.75)');
    expect(c.innerHTML).not.toContain('rgba(0, 0, 0, 0.6)');
  });
  it('câblage : l’aperçu Autopilote passe le fond calculé par le moteur (`lisibiliteCtaAction`)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    expect(src).toMatch(/ctaFond=\{ctaLisible\?\.ctaBackground \?\? null\}/);
  });
});
