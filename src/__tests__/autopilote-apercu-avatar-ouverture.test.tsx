import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import { mediaApercuAutopilote, type ResumeMediasApercu } from '@/lib/autopilot/apercu-medias';
import { avatarSeulConfig } from '@/lib/autopilot/sources';

/**
 * PREUVE AUTOPILOTE (19/10) — l'aperçu dit « rush » alors que la vidéo sort avec l'avatar.
 *
 * Avatar coché + rushes, sans clé `sources` : le moteur monte l'avatar SEUL
 * (`avatarSeulConfig`), les rushes ne servent pas. L'aperçu, lui, ne connaissait
 * la disponibilité de l'avatar qu'une fois l'étape Rushes ouverte (seul endroit
 * où `AvatarPrincipalAutopilote` est monté) : à l'ouverture du panneau (étape
 * Sujets), il montrait le premier rush, 20 s, sans avatar — mesuré sur la pile
 * locale (preuve-autopilote/main/apercu-etape1-t30s.png).
 *
 * Attendu : dès l'ouverture, quelle que soit l'étape, le résumé remonté à
 * l'aperçu porte l'avatar prêt. Lecture seule (`GET /api/creer/jumeau`,
 * `GET /api/avatars`) : aucun fournisseur, aucune génération, aucun débit.
 */

const A = 'https://projet.supabase.co/storage/v1/object/public/media/u/a.mp4';
const B = 'https://projet.supabase.co/storage/v1/object/public/media/u/b.mp4';

const JUMEAU_PRET = {
  pret: true, motif: null, message: null, moteurDisponible: true, messageMoteur: null,
  jumeau: { avatar: { id: 'av1', version: 2, nom: 'Moi', valideLe: '2026-10-01', fournisseur: 'heygen' }, voix: { id: 'v1', nom: 'Ma voix' }, prononciations: 0 },
};
const JUMEAU_ABSENT = {
  pret: false, motif: 'avatar_absent', message: 'Vous n’avez pas encore d’avatar.', moteurDisponible: true, messageMoteur: null, jumeau: null,
};
const AVATARS = {
  avatars: [{ id: 'av1', nom: 'Moi', parDefaut: true, utilisable: true, type: 'photo', versionActive: { id: 'ver-1', version: 2, source: true, type: 'photo' } }],
  capacite: {}, qualites: [],
};

let configServeur: AutopilotConfig;
let appels: string[];
let etatJumeau: unknown;

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* */ }
  configServeur = { ...DEFAULT_CONFIG, topics: ['danse'], rushUrls: [A, B], jumeauAvatar: true };
  appels = [];
  etatJumeau = JUMEAU_PRET;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    appels.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.startsWith('/api/creer/jumeau')) return { ok: true, json: async () => ({ success: true, data: etatJumeau }) };
    if (u.startsWith('/api/avatars')) return { ok: true, json: async () => ({ success: true, data: AVATARS }) };
    if (u.startsWith('/api/voice/clone')) return { ok: true, json: async () => ({ success: true, voices: [] }) };
    if (u.startsWith('/api/autopilot/rush/verifier')) return { ok: true, json: async () => ({ success: true, resultats: {} }) };
    if (u.startsWith('/api/autopilot/config')) {
      return { ok: true, json: async () => ({ success: true, ready: true, jumeauReady: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  // Aucune génération, aucun fournisseur, aucune écriture : que des lectures.
  for (const a of appels) {
    expect(a).not.toMatch(/\/api\/creer\/jumeau\/generer|\/api\/avatar\/(generate|create|did|apercu)|heygen|d-id|elevenlabs/i);
    // Seule écriture HTTP tolérée : la sonde existante des rushes (lecture côté serveur).
    expect(a).toMatch(/^GET \/api\/|^POST \/api\/autopilot\/rush\/verifier/);
  }
  cleanup();
  vi.unstubAllGlobals();
});

function ouvrir() {
  const resumes: ResumeMediasApercu[] = [];
  render(<AutopilotPanel accent="#7C3AED" onApercuMediasChange={(r) => resumes.push(r)} />);
  return resumes;
}
const dernier = (r: ResumeMediasApercu[]) => r[r.length - 1];
const surEtapeSujets = () => document.querySelector('[data-autopilot-etape="0"]')?.getAttribute('aria-current') === 'step'
  || !document.querySelector('[data-autopilot-avatar-principal]');

describe('Aperçu Autopilote — avatar coché, dès l’ouverture du panneau (étape Sujets)', () => {
  it('le moteur montera l’avatar seul : la config de référence le dit', () => {
    expect(avatarSeulConfig(sanitizeConfig(configServeur))).toBe(true);
  });

  it('avatar prêt → le résumé remonté à l’aperçu porte l’avatar, sans ouvrir l’étape Rushes', async () => {
    const resumes = ouvrir();
    await waitFor(() => expect(resumes.length).toBeGreaterThan(0));
    await waitFor(() => expect(dernier(resumes).avatar.disponible).toBe(true));
    // On n'a jamais quitté l'étape Sujets : le composant de l'étape Rushes n'est pas monté.
    expect(surEtapeSujets()).toBe(true);
    expect(document.querySelector('[data-autopilot-avatar-principal]')).toBeNull();
    // Et l'aperçu montre donc l'avatar — comme la vidéo — pas le premier rush.
    const media = mediaApercuAutopilote(dernier(resumes), { rushUrls: configServeur.rushUrls, actives: null });
    expect(media.type).toBe('avatar');
  });

  it('la vignette de l’avatar remonte aussi (lecture de /api/avatars)', async () => {
    const resumes = ouvrir();
    await waitFor(() => expect(dernier(resumes)?.avatar.vignette?.url).toBe('/api/avatars/versions/ver-1/source'));
  });

  it('avatar pas prêt → l’aperçu garde la règle d’avant (pas d’avatar)', async () => {
    etatJumeau = JUMEAU_ABSENT;
    const resumes = ouvrir();
    await waitFor(() => expect(appels.some((a) => a.startsWith('GET /api/creer/jumeau'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(dernier(resumes).avatar.disponible).toBe(false);
    expect(mediaApercuAutopilote(dernier(resumes), { rushUrls: configServeur.rushUrls, actives: null }).type).toBe('rush');
  });

  it('avatar non coché → aucune lecture de l’avatar à l’ouverture (comportement inchangé)', async () => {
    configServeur = { ...configServeur, jumeauAvatar: false };
    const resumes = ouvrir();
    await waitFor(() => expect(resumes.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 50));
    expect(appels.some((a) => a.startsWith('GET /api/creer/jumeau'))).toBe(false);
    expect(dernier(resumes).avatar.disponible).toBe(false);
  });
});
