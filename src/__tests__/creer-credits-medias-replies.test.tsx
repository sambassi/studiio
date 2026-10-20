/**
 * Mentions fournisseurs sur Créer : les crédits des banques d'images restent
 * ACCESSIBLES (exigés par leurs conditions) mais REPLIÉS dans « Crédits
 * médias » — jamais sur la surface principale.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { CreditBanques } from '@/components/creer/RechercheStockSequence';
import { messagePhotos } from '@/lib/creer/photosEtat';

afterEach(cleanup);

describe('CreditBanques — replié, accessible', () => {
  it('<details> fermé : seul « Crédits médias » est visible ; les liens restent dans le DOM', () => {
    const { container } = render(<CreditBanques attribut="data-x" />);
    const d = container.querySelector('details[data-x][data-credit-media]') as HTMLDetailsElement;
    expect(d).not.toBeNull();
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')!.textContent).toBe('Crédits médias');
    expect(Array.from(d.querySelectorAll('a')).map((a) => a.textContent)).toEqual(['Pexels', 'Unsplash']);
    fireEvent.click(d.querySelector('summary')!);
  });
});

describe('AssistantWizard — attribution du fond et infobulles', () => {
  const src = readFileSync('src/app/dashboard/creer/AssistantWizard.tsx', 'utf8');
  it('l’attribution du fond (data-fond-attribution) est un détail replié « Crédits médias »', () => {
    expect(src).toMatch(/<details[^>]*data-fond-attribution/);
    expect(src).not.toMatch(/<p[^>]*data-fond-attribution/);
  });
  it('plus d’infobulle « Photo : {auteur} » pour une photo de banque', () => {
    expect(src).not.toContain("title={photo.photographer ? `Photo : ${photo.photographer}` : 'Choisir cette photo'}");
  });
});

describe('messages d’état des photos : aucun nom de fournisseur', () => {
  it.each(['pexels', 'unsplash', 'both'])('%s', (source) => {
    for (const e of ['vide', 'non-configure', 'auth', 'quota', 'indisponible'] as const) {
      expect(messagePhotos(e, source)).not.toMatch(/Pexels|Unsplash/i);
    }
  });
});
