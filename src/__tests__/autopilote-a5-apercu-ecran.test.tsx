/**
 * A5 — À L'ÉCRAN : l'aperçu de l'Autopilote annonce la durée que la vidéo
 * finale prendra avec le jumeau (estimation signalée) et dit que la voix de
 * l'avatar s'entend dans la vidéo finale. Sans avatar : rien de nouveau.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import { buildAutopilotSample, postDeLEchantillon } from '@/lib/autopilot/sample';
import { scriptJumeauMontage } from '@/lib/autopilot/script-jumeau';
import { estimerParoleJumeau, etapesApercuAutopilote } from '@/lib/autopilot/durees-sequences';
import { vignettesPourTests } from '@/lib/medias/vignette-video';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '@/app/dashboard/creer/AssistantWizard';

const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/plage.mp4';
const JUMEAU_PRET = {
  pret: true, motif: null, message: null, moteurDisponible: true, messageMoteur: null,
  jumeau: { avatar: { id: 'av1', version: 2, nom: 'Moi', valideLe: '2026-10-01', fournisseur: 'heygen' }, voix: { id: 'v1', nom: 'Ma voix' }, prononciations: 0 },
};
const AVATARS = {
  avatars: [{ id: 'av1', nom: 'Moi', parDefaut: true, utilisable: true, type: 'photo', versionActive: { id: 'ver-1', version: 2, source: true, type: 'photo' } }],
};

let configServeur: AutopilotConfig = DEFAULT_CONFIG;
let appels: string[] = [];
let ecritures: string[] = [];

beforeEach(() => {
  configServeur = DEFAULT_CONFIG;
  appels = [];
  ecritures = [];
  vignettesPourTests.reinitialiser();
  vignettesPourTests.desactiverPersistance();
  vignettesPourTests.definirExtracteur(async () => { throw new Error('jsdom'); });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    appels.push(u);
    if (init?.method && init.method !== 'GET') ecritures.push(u);
    if (u.startsWith('/api/pexels')) return { ok: true, json: async () => ({ success: true, photos: [] }) };
    if (u.startsWith('/api/creer/jumeau')) return { ok: true, json: async () => ({ success: true, data: JUMEAU_PRET }) };
    if (u.startsWith('/api/avatars')) return { ok: true, json: async () => ({ success: true, data: AVATARS }) };
    if (u.startsWith('/api/autopilot/config')) {
      return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, jumeauReady: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});
afterEach(() => {
  // Aucune génération payante pour l'aperçu : aucune requête fournisseur,
  // aucune génération du jumeau, aucune production lancée.
  for (const a of appels) expect(a).not.toMatch(/\/api\/creer\/jumeau\/generer|heygen|elevenlabs/i);
  for (const e of ecritures) expect(e).not.toMatch(/produire|jumeau|generer/i);
  cleanup();
  vi.unstubAllGlobals();
  vignettesPourTests.reinitialiser();
});

async function ouvrirAutopilote() {
  window.localStorage.clear();
  render(<AssistantWizard />);
  await waitFor(() => expect(document.querySelector('[data-parcours-autopilote]')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-parcours-autopilote]')!);
  await waitFor(() => expect(document.querySelector('[data-autopilot-apercu]')).toBeTruthy());
  return document.querySelector('[data-autopilot-apercu]') as HTMLElement;
}

describe('A5 — aperçu avec avatar seul', () => {
  for (const duree of [30, 45]) {
    it(`cible ${duree} s : durée estimée = celle que le montage prendra, voix signalée`, async () => {
      configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, topics: ['finance'], rushUrls: [], jumeauAvatar: true, brief: { duree } });
      const apercu = await ouvrirAutopilote();
      // L'état de l'avatar (prêt) est lu par le panneau à l'étape Rushes / Médias.
      fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
      await waitFor(() => expect(document.querySelector('[data-avatar-pret="oui"]')).toBeTruthy());
      await waitFor(() => expect(apercu.querySelector('[data-autopilot-apercu-jumeau="estimee"]')).toBeTruthy(), { timeout: 4000 });
      const note = apercu.querySelector('[data-autopilot-apercu-jumeau="estimee"]') as HTMLElement;
      // La même règle, calculée ici à part : script du montage → parole → répartition du rendu.
      const sample = buildAutopilotSample(configServeur);
      const parole = estimerParoleJumeau(scriptJumeauMontage(postDeLEchantillon(sample, configServeur.brief), configServeur));
      const steps = etapesApercuAutopilote({ activeOrder: ['intro', 'cards', 'video', 'cta'], paroleJumeau: parole, dureeCible: duree, avecCartes: true });
      const total = Math.round(steps.reduce((t, e) => t + e.seconds, 0) * 10) / 10;
      expect(Number(note.getAttribute('data-autopilot-apercu-duree-totale'))).toBe(total);
      expect(total).not.toBe(20); // plus les 4 + 6 + 6 + 4 s d'avant
      expect(note.textContent).toContain('Durée estimée');
      expect(note.textContent).toContain('durée réelle de la parole');
      expect(note.querySelector('[data-autopilot-apercu-voix-avatar]')!.textContent).toContain('voix de l’avatar s’entend dans la vidéo finale');
    });
  }
});

describe('A5 — sans avatar : aperçu inchangé', () => {
  it('rush seul : aucune note d’estimation jumeau', async () => {
    configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, rushUrls: [RUSH], brief: { duree: 30 } });
    const apercu = await ouvrirAutopilote();
    await waitFor(() => expect(apercu.querySelector(`video[src="${RUSH}"]`)).toBeTruthy());
    expect(apercu.querySelector('[data-autopilot-apercu-jumeau]')).toBeNull();
  });
});
