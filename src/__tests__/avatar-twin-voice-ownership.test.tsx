/**
 * A_8g — « MA VOIX » : CHOISIE PARMI LES MIENNES, PERSISTÉE, REFUSÉE SI ELLE N'EST PAS À MOI.
 *
 * Deux moitiés, sur le VRAI code :
 *
 *   1. la route `PUT /api/autopilot/jumeau` — le serveur relit la voix sous
 *      le compte : un identifiant d'autrui, ou inconnu, est REFUSÉ (409),
 *      pas effacé en silence ;
 *   2. le panneau — la liste ne contient que les voix du compte, désignées
 *      par leur nom ; le choix est écrit tout de suite et relu au
 *      chargement, jamais deviné.
 *
 * Aucun fournisseur : `user_voices` est une table, le panneau parle à une
 * route simulée.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

type Ligne = Record<string, unknown>;

const UID = 'aaaaaaaa-1111-4111-8111-111111111111';
const AUTRUI = 'bbbbbbbb-2222-4222-8222-222222222222';
const AVATAR = 'cccccccc-3333-4333-8333-333333333333';
const VOIX_A = { id: 'dddddddd-4444-4444-8444-444444444444', name: 'Bassi studio' };
const VOIX_B = { id: 'eeeeeeee-5555-4555-8555-555555555555', name: 'Bassi coach' };
const VOIX_AUTRUI = 'ffffffff-6666-4666-8666-666666666666';

// ───────────────────────────────────────────────────────────────────────────
// 1. La route
// ───────────────────────────────────────────────────────────────────────────

let tables: Record<string, Ligne[]> = {};
let voixDuCompte: Ligne[] = [];

function requete(table: string) {
  const eq: [string, unknown][] = [];
  const estNul: string[] = [];
  const filtrees = () => {
    let out = [...(tables[table] ?? [])];
    for (const [c, v] of eq) out = out.filter((l) => l[c] === v);
    for (const c of estNul) out = out.filter((l) => l[c] === null || l[c] === undefined);
    return out;
  };
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (c: string, v: unknown) => { eq.push([c, v]); return api; },
    is: (c: string, v: unknown) => { if (v === null) estNul.push(c); return api; },
    order: () => api, limit: () => api,
    maybeSingle: async () => ({ data: filtrees()[0] ?? null, error: null }),
    single: async () => ({ data: filtrees()[0] ?? null, error: null }),
    then: (r: (v: unknown) => unknown) => r({ data: filtrees(), error: null }),
  };
  return api;
}
function fusionner(userId: string, patch: Ligne) {
  const lignes = tables.autopilot_config ?? [];
  const ligne = lignes.find((l) => l.user_id === userId);
  if (!ligne) { tables.autopilot_config = [...lignes, { user_id: userId, design_style: { ...patch } }]; return { error: null }; }
  ligne.design_style = { ...(ligne.design_style as Ligne ?? {}), ...patch };
  return { error: null };
}
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: {
    from: (t: string) => requete(t),
    rpc: async (_n: string, args: { p_user_id: string; p_patch: Ligne }) => fusionner(args.p_user_id, args.p_patch),
  },
  supabase: { from: (t: string) => requete(t) },
}));
vi.mock('@/lib/auth/config', () => ({ auth: async () => ({ user: { id: UID } }) }));
vi.mock('@/lib/voice/store', () => ({
  listUserVoices: async (userId: string) => voixDuCompte.filter((v) => v.user_id === userId),
}));

import { PUT as ACTIVER, GET as LIRE } from '@/app/api/autopilot/jumeau/route';
import AutopiloteJumeauPanel from '@/components/avatar/AutopiloteJumeauPanel';

const activer = (jumeau: Ligne) => ACTIVER({ json: async () => ({ jumeau }) } as never);
const range = () => ((tables.autopilot_config[0].design_style ?? {}) as Ligne).jumeauNumerique as Ligne | undefined;

beforeEach(() => {
  tables = {
    user_avatars: [{
      id: AVATAR, user_id: UID, status: 'completed', provider_avatar_id: 'hg_1',
      validated_at: '2026-09-09T12:00:00Z', deleted_at: null, subject_type: 'self', version: 1,
    }],
    autopilot_config: [{ user_id: UID, design_style: {} }],
  };
  voixDuCompte = [
    { id: VOIX_A.id, user_id: UID, provider_voice_id: 'el_a', name: VOIX_A.name, consent_at: '2026-09-01T10:00:00Z' },
    { id: VOIX_B.id, user_id: UID, provider_voice_id: 'el_b', name: VOIX_B.name, consent_at: '2026-09-01T10:00:00Z' },
    { id: VOIX_AUTRUI, user_id: AUTRUI, provider_voice_id: 'el_x', name: 'X', consent_at: '2026-09-01T10:00:00Z' },
  ];
});

describe('1. La route : la voix est relue sous le compte', () => {
  it('1.1 une voix du compte est retenue, par sa référence Studiio', async () => {
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX_B.id });
    expect(res.status).toBe(200);
    expect(range()).toMatchObject({ active: true, userVoiceId: VOIX_B.id });
  });

  it('1.2 ⚠️ CROSS-USER : la voix d’autrui est REFUSÉE, rien n’est écrit', async () => {
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX_AUTRUI });
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('voix_absente');
    expect(range()).toBeUndefined();
  });

  it('1.3 un identifiant inconnu est refusé de la même façon (aucune énumération)', async () => {
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(409);
    expect((await res.json()).motif).toBe('voix_absente');
  });

  it('1.4 sans voix désignée, on peut configurer — et la route le dit', async () => {
    const res = await activer({ active: true, avatarId: AVATAR, userVoiceId: null });
    expect(res.status).toBe(200);
    expect((await res.json()).voixPrete).toBe(false);
    expect(range()).toMatchObject({ active: true, userVoiceId: null });
  });

  it('1.5 ⚠️ LE CHOIX SURVIT : relu tel quel au chargement suivant', async () => {
    await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX_B.id });
    const j = await (await LIRE()).json();
    expect(j.jumeau).toMatchObject({ active: true, avatarId: AVATAR, userVoiceId: VOIX_B.id });
  });

  it('1.6 changer de voix sans changer l’interrupteur est une écriture ordinaire', async () => {
    await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX_A.id });
    await activer({ active: true, avatarId: AVATAR, userVoiceId: VOIX_B.id });
    expect(range()).toMatchObject({ active: true, userVoiceId: VOIX_B.id });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Le panneau
// ───────────────────────────────────────────────────────────────────────────

let configRangee: Ligne;
let ecritures: Ligne[] = [];

describe('2. Le panneau « Ma voix »', () => {
  beforeEach(() => {
    configRangee = { active: false, avatarId: null, avatarVersion: null, userVoiceId: null };
    ecritures = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (!String(url).includes('/api/autopilot/jumeau')) throw new Error(`appel inattendu : ${url}`);
      if (init?.method === 'PUT') {
        const corps = JSON.parse(String(init.body)) as { jumeau: Ligne };
        ecritures.push(corps.jumeau);
        configRangee = { ...corps.jumeau };
        return { ok: true, status: 200, json: async () => ({ ok: true, jumeau: configRangee }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, jumeau: configRangee }) };
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  const monter = (voix: { id: string; name: string }[] = [VOIX_A, VOIX_B]) => render(
    <AutopiloteJumeauPanel
      avatarId={AVATAR} statut="completed" providerAvatarId="hg_1"
      valideLe="2026-09-09T12:00:00Z" voix={voix}
    />,
  );
  const attendre = () => waitFor(() => expect(document.querySelector('[data-jumeau-toggle]')).not.toBeNull());
  const selecteur = () => document.querySelector('[data-jumeau-voix-choix]') as HTMLSelectElement;

  it('2.1 ⚠️ LA LISTE NE CONTIENT QUE MES VOIX, PAR LEUR NOM — aucun identifiant', async () => {
    monter();
    await attendre();
    const options = [...selecteur().querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['Choisir ma voix', VOIX_A.name, VOIX_B.name]);
    expect(selecteur().textContent).not.toMatch(/el_|elevenlabs|dddddddd/);
    expect(document.querySelector('[data-jumeau-voix] label')!.textContent).toBe('Ma voix');
  });

  it('2.2 ⚠️ PLUSIEURS VOIX : AUCUNE N’EST CHOISIE À MA PLACE', async () => {
    monter();
    await attendre();
    expect(selecteur().value).toBe('');
    expect(document.querySelector('[data-jumeau-voix-a-choisir]')).not.toBeNull();
    fireEvent.click(document.querySelector('[data-jumeau-toggle]')!);
    await waitFor(() => expect(ecritures.length).toBe(1));
    expect(ecritures[0].userVoiceId).toBeNull();
  });

  it('2.3 une seule voix : c’est la mienne, elle est retenue', async () => {
    monter([VOIX_A]);
    await attendre();
    expect(selecteur().value).toBe(VOIX_A.id);
    expect(document.querySelector('[data-jumeau-voix-a-choisir]')).toBeNull();
  });

  it('2.4 ⚠️ CHOISIR ÉCRIT TOUT DE SUITE, AVEC LA RÉFÉRENCE STUDIIO', async () => {
    monter();
    await attendre();
    fireEvent.change(selecteur(), { target: { value: VOIX_B.id } });
    await waitFor(() => expect(ecritures.length).toBe(1));
    expect(ecritures[0]).toMatchObject({ active: false, avatarId: AVATAR, userVoiceId: VOIX_B.id });
  });

  it('2.5 ⚠️ RELU AU CHARGEMENT, PAS DEVINÉ : le choix survit au rechargement', async () => {
    configRangee = { active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: VOIX_B.id };
    const { container } = monter();
    await attendre();
    await waitFor(() => expect(selecteur().value).toBe(VOIX_B.id));
    expect(ecritures).toEqual([]);
    const pret = container.querySelector('[data-jumeau-pret]')!;
    expect(pret.textContent).toContain(VOIX_B.name);
  });

  it('2.6 actif sans voix retenue : pas de « Prêt », on demande de choisir', async () => {
    configRangee = { active: true, avatarId: AVATAR, avatarVersion: 1, userVoiceId: null };
    const { container } = monter();
    await attendre();
    expect(container.querySelector('[data-jumeau-pret]')).toBeNull();
    expect(container.querySelector('[data-jumeau-voix-a-choisir]')).not.toBeNull();
  });

  it('2.7 ⚠️ AUCUNE VOIX : « Configurez votre voix », et le chemin vers l’espace voix', async () => {
    const { container } = monter([]);
    await attendre();
    const avis = container.querySelector('[data-jumeau-voix-manquante]')!;
    expect(avis.textContent).toContain('Configurez votre voix avant d’utiliser votre clone.');
    expect(avis.querySelector('a')!.getAttribute('href')).toBe('#ma-voix');
    expect(document.querySelector('[data-jumeau-voix-choix]')).toBeNull();
  });
});
