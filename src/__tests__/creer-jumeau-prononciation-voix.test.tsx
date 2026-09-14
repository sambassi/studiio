/**
 * A_8h — LE PANNEAU PRONONCIATION NOMME LA VOIX CHOISIE POUR LE JUMEAU, PAS LA PREMIÈRE DU COMPTE.
 *
 * Trouvé en A_8g : avec deux voix clonées, « Sera dit avec votre voix :
 * Bassi studio » alors que le jumeau devait parler avec « Bassi coach ». Le
 * choix vit à un seul endroit (`jumeauNumerique.userVoiceId`) ; le panneau le
 * relit, et le suit quand il change sur la même page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import PrononciationsPanel from '@/components/voice/PrononciationsPanel';
import { EVENEMENT_VOIX_JUMEAU } from '@/lib/avatar/jumeau-creer';

const STUDIO = { id: 'elevenlabs-a', userVoiceId: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Bassi studio' };
const COACH = { id: 'elevenlabs-b', userVoiceId: 'bbbbbbbb-2222-4222-8222-222222222222', name: 'Bassi coach' };

let voix: typeof STUDIO[];
let choisie: string | null;

beforeEach(() => {
  voix = [STUDIO, COACH];
  choisie = COACH.userVoiceId;
  vi.stubGlobal('fetch', async (url: string) => {
    const u = String(url);
    if (u.includes('/api/autopilot/bibliotheque-creative')) {
      return { ok: true, json: async () => ({ ok: true, bibliotheque: { prononciations: [] } }) };
    }
    if (u.includes('/api/voice/clone')) return { ok: true, json: async () => ({ success: true, voices: voix }) };
    if (u.includes('/api/autopilot/jumeau')) {
      return { ok: true, json: async () => ({ ok: true, jumeau: { active: false, avatarId: null, avatarVersion: null, userVoiceId: choisie } }) };
    }
    throw new Error(`appel inattendu : ${u}`);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const libelle = () => document.querySelector('[data-prononciations-avec-voix]')?.textContent ?? null;

describe('A_8h — la voix nommée', () => {
  it('⚠️ DEUX VOIX, « BASSI COACH » CHOISIE : C’EST ELLE — pas « Bassi studio »', async () => {
    render(<PrononciationsPanel />);
    await waitFor(() => expect(libelle()).toContain('Bassi coach'));
    expect(libelle()).not.toContain('Bassi studio');
  });

  it('deux voix, aucune choisie : rien n’est nommé à la place de la personne', async () => {
    choisie = null;
    render(<PrononciationsPanel />);
    await waitFor(() => expect(document.querySelector('[data-prononciations-sans-voix]')).not.toBeNull());
    expect(libelle()).toBeNull();
  });

  it('une seule voix : nommée d’office, c’est la sienne', async () => {
    voix = [STUDIO]; choisie = null;
    render(<PrononciationsPanel />);
    await waitFor(() => expect(libelle()).toContain('Bassi studio'));
  });

  it('⚠️ LE CHOIX CHANGE SUR LA PAGE : LE PANNEAU SUIT SANS RECHARGER', async () => {
    render(<PrononciationsPanel />);
    await waitFor(() => expect(libelle()).toContain('Bassi coach'));
    choisie = STUDIO.userVoiceId;
    window.dispatchEvent(new Event(EVENEMENT_VOIX_JUMEAU));
    await waitFor(() => expect(libelle()).toContain('Bassi studio'));
  });
});
