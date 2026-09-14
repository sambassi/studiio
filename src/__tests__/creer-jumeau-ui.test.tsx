/**
 * A_8h — LE BLOC « UTILISER MON CLONE » : ÉTEINT PAR DÉFAUT, ACTIONNABLE SEULEMENT SUR UN CLONE PRÊT.
 *
 * Le panneau ne décide rien : il affiche ce que `GET /api/creer/jumeau` dit,
 * grise l'interrupteur tant que ce n'est pas « prêt », nomme la voix
 * retenue, et remet à zéro un brouillon allumé sur un clone qui ne peut plus
 * servir. Aucun visage, aucune preview synthétique.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import JumeauCreerPanel from '@/components/creer/JumeauCreerPanel';
import { jumeauActivable, lienJumeauCreer } from '@/lib/avatar/jumeau-creer';

let reponse: Record<string, unknown>;

beforeEach(() => {
  reponse = { ok: true, etat: 'pret', voix: { userVoiceId: 'v', nom: 'Bassi coach' }, moteur: 'indisponible' };
  vi.stubGlobal('fetch', async (url: string) => {
    if (!String(url).includes('/api/creer/jumeau')) throw new Error(`appel inattendu : ${url}`);
    return { ok: true, status: 200, json: async () => reponse };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const toggle = () => document.querySelector('[data-jumeau-creer-toggle]') as HTMLInputElement;
const attendre = () => waitFor(() => expect(document.querySelector('[data-jumeau-creer-empechement], [data-jumeau-creer-voix]')).not.toBeNull());

describe('1. Les états', () => {
  it('1.1 ⚠️ AUCUN CLONE : toggle grisé, message, lien « Configurer mon clone »', async () => {
    reponse = { ok: true, etat: 'bloque', motif: 'avatar_absent' };
    render(<JumeauCreerPanel actif={false} onChange={() => {}} />);
    await attendre();
    expect(toggle().disabled).toBe(true);
    const e = document.querySelector('[data-jumeau-creer-empechement]')!;
    expect(e.textContent).toContain('Aucun clone n’est encore configuré.');
    expect(e.querySelector('a')!.getAttribute('href')).toBe('/dashboard/avatar');
    expect(e.querySelector('a')!.textContent).toBe('Configurer mon clone');
  });

  it('1.2 ⚠️ SOURCE PRÊTE : « pas encore entraîné », toggle grisé', async () => {
    reponse = { ok: true, etat: 'bloque', motif: 'avatar_non_entraine' };
    render(<JumeauCreerPanel actif={false} onChange={() => {}} />);
    await attendre();
    expect(toggle().disabled).toBe(true);
    expect(document.querySelector('[data-jumeau-creer-empechement]')!.textContent)
      .toContain('Votre vidéo est prête, mais votre clone n’est pas encore entraîné.');
  });

  it('1.3 ⚠️ NON VALIDÉ : « Validez d’abord », lien « Voir mon clone »', async () => {
    reponse = { ok: true, etat: 'bloque', motif: 'clone_non_valide' };
    render(<JumeauCreerPanel actif={false} onChange={() => {}} />);
    await attendre();
    expect(toggle().disabled).toBe(true);
    const e = document.querySelector('[data-jumeau-creer-empechement]')!;
    expect(e.textContent).toContain('Validez d’abord votre clone avant de l’utiliser dans une vidéo.');
    expect(e.querySelector('a')!.textContent).toBe('Voir mon clone');
  });

  it('1.4 ⚠️ VOIX ABSENTE : « Configurez votre voix », toggle grisé, aucune voix générique', async () => {
    reponse = { ok: true, etat: 'bloque', motif: 'voix_absente' };
    render(<JumeauCreerPanel actif={false} onChange={() => {}} />);
    await attendre();
    expect(toggle().disabled).toBe(true);
    const e = document.querySelector('[data-jumeau-creer-empechement]')!;
    expect(e.textContent).toContain('Configurez votre voix pour utiliser votre clone.');
    expect(e.querySelector('a')!.getAttribute('href')).toBe('/dashboard/avatar#ma-voix');
    expect(document.body.textContent).not.toMatch(/HeyGen|catalogue|par défaut/i);
  });

  it('1.5 ⚠️ PRÊT : toggle actionnable, ÉTEINT, et la voix retenue est nommée', async () => {
    render(<JumeauCreerPanel actif={false} onChange={() => {}} />);
    await attendre();
    expect(toggle().disabled).toBe(false);
    expect(toggle().checked).toBe(false);
    expect(document.querySelector('[data-jumeau-creer-voix]')!.textContent).toContain('Bassi coach');
    expect(document.querySelector('[data-jumeau-creer-voix]')!.textContent).not.toContain('Bassi studio');
  });

  it('1.6 un clic allume, et l’écran dit que le moteur n’est pas encore là', async () => {
    const changements: boolean[] = [];
    const { rerender } = render(<JumeauCreerPanel actif={false} onChange={(v) => changements.push(v)} />);
    await attendre();
    fireEvent.click(toggle());
    expect(changements).toEqual([true]);
    rerender(<JumeauCreerPanel actif onChange={(v) => changements.push(v)} />);
    expect(toggle().checked).toBe(true);
    expect(document.querySelector('[data-jumeau-creer-attente-moteur]')!.textContent)
      .toContain('aucune vidéo ordinaire ne sera produite à sa place');
  });

  it('1.7 ⚠️ BROUILLON ALLUMÉ SUR UN CLONE INDISPONIBLE : remis à zéro, et dit', async () => {
    reponse = { ok: true, etat: 'bloque', motif: 'clone_non_valide' };
    const changements: boolean[] = [];
    render(<JumeauCreerPanel actif onChange={(v) => changements.push(v)} />);
    await attendre();
    await waitFor(() => expect(changements).toEqual([false]));
    expect(toggle().checked).toBe(false);
    expect(document.querySelector('[data-jumeau-creer-remis-a-zero]')!.textContent)
      .toContain('doit être revalidé');
  });

  it('1.8 le serveur injoignable ne rend pas le clone disponible', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('réseau'); });
    render(<JumeauCreerPanel actif={false} onChange={() => {}} />);
    await attendre();
    expect(toggle().disabled).toBe(true);
  });

  it('1.9 aucun visage, aucune vidéo, aucune image dans le bloc', async () => {
    render(<JumeauCreerPanel actif onChange={() => {}} />);
    await attendre();
    expect(document.querySelectorAll('[data-jumeau-creer] img, [data-jumeau-creer] video, [data-jumeau-creer] canvas')).toHaveLength(0);
  });
});

describe('2. La règle, sans écran', () => {
  it('2.1 seul « prêt » rend l’interrupteur actionnable', () => {
    expect(jumeauActivable({ etat: 'pret', voix: { userVoiceId: 'v', nom: 'x' } })).toBe(true);
    expect(jumeauActivable({ etat: 'bloque', motif: 'voix_absente' })).toBe(false);
    expect(jumeauActivable({ etat: 'chargement' })).toBe(false);
  });

  it('2.2 le lien qui débloque dépend du motif', () => {
    expect(lienJumeauCreer('avatar_absent').libelle).toBe('Configurer mon clone');
    expect(lienJumeauCreer('voix_absente').href).toBe('/dashboard/avatar#ma-voix');
    expect(lienJumeauCreer('clone_non_valide').libelle).toBe('Voir mon clone');
  });
});
