/**
 * A_8f — L'INTERRUPTEUR, VU PAR CELUI QUI L'ACTIONNE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CET ÉCRAN PROMET
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Il autorise un moteur automatique à produire, sans que personne ne regarde,
 * des vidéos où c'est LE VISAGE ET LA VOIX de quelqu'un qui parlent.
 *
 * Il est donc éteint tant qu'on ne l'allume pas, il refuse de s'allumer avant
 * que le clone n'ait été regardé et accepté, et — c'est le point le plus
 * facile à rater — il DIT ce qui manque. Un interrupteur grisé sans phrase
 * laisse chercher ; chaque état porte ici le geste qui débloque.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';

import AutopiloteJumeauPanel from '@/components/avatar/AutopiloteJumeauPanel';
import { ETAT_SOURCE_PRETE } from '@/lib/avatar/contrat';

const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const VOIX = { id: 'dddddddd-4444-4444-8444-444444444444', name: 'Bassi' };

let range: Record<string, unknown>;
let ecritures: Record<string, unknown>[];
let reponsePut: { statut: number; corps: Record<string, unknown> } | null;

beforeEach(() => {
  range = { active: false, avatarId: null, avatarVersion: null, userVoiceId: null };
  ecritures = [];
  reponsePut = null;

  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (!String(url).includes('/api/autopilot/jumeau')) {
      throw new Error(`appel inattendu : ${url}`);
    }
    if (init?.method === 'PUT') {
      const corps = JSON.parse(String(init.body)) as { jumeau: Record<string, unknown> };
      ecritures.push(corps.jumeau);
      if (reponsePut) {
        return {
          ok: reponsePut.statut === 200,
          status: reponsePut.statut,
          json: async () => reponsePut!.corps,
        };
      }
      range = { ...corps.jumeau };
      return { ok: true, status: 200, json: async () => ({ ok: true, jumeau: range }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, jumeau: range }) };
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const monter = (props: Partial<React.ComponentProps<typeof AutopiloteJumeauPanel>> = {}) => render(
  <AutopiloteJumeauPanel
    avatarId={AVATAR}
    statut="completed"
    providerAvatarId="hg_1"
    valideLe="2026-09-09T12:00:00Z"
    voix={[VOIX]}
    {...props}
  />,
);

const attendre = () => waitFor(
  () => expect(document.querySelector('[data-jumeau-toggle]')).not.toBeNull(),
);
const toggle = () => document.querySelector('[data-jumeau-toggle]') as HTMLInputElement;

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Éteint, et il faut une raison pour l’allumer', () => {
  it('1.1 ⚠️ ÉTEINT PAR DÉFAUT, MÊME AVEC UN CLONE PARFAIT', async () => {
    monter();
    await attendre();
    expect(toggle().checked).toBe(false);
    expect(ecritures).toEqual([]);
  });

  it('1.2 ⚠️ AUCUN CLONE : NON ACTIVABLE, ET ON DIT QUOI FAIRE', async () => {
    const { container } = monter({
      avatarId: null, statut: null, providerAvatarId: null, valideLe: null,
    });
    await attendre();
    expect(toggle().disabled).toBe(true);
    expect(container.querySelector('[data-jumeau-empechement]')!.textContent)
      .toContain('Créez et validez votre clone');
  });

  it('1.3 ⚠️ UNE SOURCE PRÊTE N’EST PAS UN CLONE', async () => {
    const { container } = monter({
      statut: ETAT_SOURCE_PRETE, providerAvatarId: null, valideLe: null,
    });
    await attendre();
    expect(toggle().disabled).toBe(true);
    expect(container.querySelector('[data-jumeau-empechement]')!.textContent)
      .toContain('pas encore entraîné');
  });

  it('1.4 ⚠️ UN CLONE NON VALIDÉ NE S’ACTIVE PAS', async () => {
    const { container } = monter({ valideLe: null });
    await attendre();
    expect(toggle().disabled).toBe(true);
    expect(container.querySelector('[data-jumeau-empechement]')!.textContent)
      .toContain('validez votre clone');
  });

  it('1.5 un entraînement en cours non plus', async () => {
    const { container } = monter({ statut: 'processing', valideLe: null });
    await attendre();
    expect(toggle().disabled).toBe(true);
    expect(container.querySelector('[data-jumeau-empechement]')).not.toBeNull();
  });

  it('1.6 un clic sur un interrupteur grisé n’écrit rien', async () => {
    monter({ valideLe: null });
    await attendre();
    fireEvent.click(toggle());
    expect(ecritures).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Clone validé', () => {
  it('2.1 l’interrupteur devient actionnable, sans empêchement affiché', async () => {
    const { container } = monter();
    await attendre();
    expect(toggle().disabled).toBe(false);
    expect(container.querySelector('[data-jumeau-empechement]')).toBeNull();
  });

  it('2.2 ⚠️ L’ACTIVATION ENVOIE L’AVATAR ET LA VOIX DU COMPTE', async () => {
    monter();
    await attendre();
    fireEvent.click(toggle());
    await waitFor(() => expect(ecritures.length).toBe(1));
    expect(ecritures[0]).toMatchObject({
      active: true, avatarId: AVATAR, userVoiceId: VOIX.id,
    });
  });

  it('2.3 activé et voix prête : « Prêt pour Autopilote »', async () => {
    const { container } = monter();
    await attendre();
    fireEvent.click(toggle());
    await waitFor(() => expect(container.querySelector('[data-jumeau-pret]')).not.toBeNull());
    expect(toggle().checked).toBe(true);
  });

  it('2.4 ⚠️ ACTIVÉ SANS VOIX : ON LE DIT, ET ON DIT LA CONSÉQUENCE', async () => {
    /* On ne bloque pas la configuration — mais rien ne partira, et l'écran
       doit l'annoncer plutôt que de laisser croire que tout est prêt. */
    const { container } = monter({ voix: [] });
    await attendre();
    const avis = container.querySelector('[data-jumeau-voix-manquante]')!;
    expect(avis.textContent).toContain('Voix à configurer');
    expect(avis.textContent).toContain('lorsque votre voix sera prête');
  });

  it('2.5 ⚠️ ACTIVÉ, L’ÉCRAN DIT QUE LA GÉNÉRATION N’EST PAS ENCORE LÀ', async () => {
    /* Le pire serait de laisser croire que des vidéos partent déjà. Et la
       phrase dit aussi ce qu'Autopilote fera à la place : rien, plutôt qu'une
       vidéo sans la personne. */
    const { container } = monter();
    await attendre();
    fireEvent.click(toggle());
    await waitFor(() => expect(
      container.querySelector('[data-jumeau-attente-integration]'),
    ).not.toBeNull());
    expect(container.querySelector('[data-jumeau-attente-integration]')!.textContent)
      .toContain('ne produira pas de vidéo à votre place');
  });

  it('2.6 ⚠️ UN REFUS DU SERVEUR EST AFFICHÉ, ET RIEN N’EST COCHÉ', async () => {
    reponsePut = {
      statut: 409,
      corps: { ok: false, motif: 'clone_non_valide', error: 'Regardez et validez votre clone avant de l’activer.' },
    };
    const { container } = monter();
    await attendre();
    fireEvent.click(toggle());
    await waitFor(() => expect(container.textContent).toContain('Regardez et validez votre clone'));
    expect(toggle().checked).toBe(false);
  });

  it('2.7 désactiver écrit `active: false`', async () => {
    range = { active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX.id };
    monter();
    await waitFor(() => expect(toggle().checked).toBe(true));
    fireEvent.click(toggle());
    await waitFor(() => expect(ecritures.length).toBe(1));
    expect(ecritures[0].active).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le réglage survit', () => {
  it('3.1 ⚠️ IL EST RELU AU CHARGEMENT, PAS DEVINÉ', async () => {
    range = { active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX.id };
    const { container } = monter();
    await waitFor(() => expect(toggle().checked).toBe(true));
    expect(container.querySelector('[data-jumeau-pret]')).not.toBeNull();
  });

  it('3.2 un rechargement retrouve le même état', async () => {
    monter();
    await attendre();
    fireEvent.click(toggle());
    await waitFor(() => expect(range.active).toBe(true));

    cleanup();
    monter();
    await waitFor(() => expect(toggle().checked).toBe(true));
  });
});
