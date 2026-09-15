import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/react';
import MaVoixPanel from '../components/voice/MaVoixPanel';

/**
 * Le panneau « Ma voix & prononciations » : il affiche ce que le serveur
 * dit, envoie des intentions, et montre la différence affiché / prononcé
 * avec la même fonction que le serveur. Sans écoute réelle : phrase
 * explicite, aucun bouton qui fait semblant.
 */

const V1 = '44444444-4444-4444-8444-000000000001';
const V2 = '44444444-4444-4444-8444-000000000002';

const serveur = {
  data: {} as Record<string, unknown>,
  appels: [] as Array<{ url: string; method: string; body?: unknown }>,
};

function stub(profil: Record<string, unknown>, ecoute: { status: number; body?: string } = { status: 200, body: 'AUDIO' }) {
  serveur.data = profil;
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    serveur.appels.push({ url: u, method: init?.method ?? 'GET', body });
    const json = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b, headers: new Headers() } as unknown as Response);
    if (u === '/api/voice/profil') return json(200, { success: true, data: serveur.data });
    if (u === '/api/voice/profil/prononciations') { serveur.data = { ...serveur.data, prononciations: body.prononciations }; return json(200, { success: true, data: { prononciations: body.prononciations } }); }
    if (u === '/api/voice/profil/voix') { serveur.data = { ...serveur.data, choix: body.userVoiceId, voixResolue: (serveur.data.voix as Array<{ id: string }>).find((v) => v.id === body.userVoiceId) ?? null, motifVoix: null, messageVoix: null, ecouteDisponible: true }; return json(200, { success: true, data: {} }); }
    if (u === '/api/voice/ecoute') {
      if (ecoute.status !== 200) return json(ecoute.status, { success: false, error: 'Notre fournisseur n’a pas pu générer l’écoute. Réessayez.' });
      return { ok: true, status: 200, blob: async () => new Blob([ecoute.body ?? 'AUDIO']), headers: new Headers({ 'X-Studiio-Spoken': encodeURIComponent('Bienvenue au cours Afro-boust à Neu-cha-tel.') }) } as unknown as Response;
    }
    return json(404, {});
  }) as unknown as typeof fetch;
}

const profilBase = (over: Record<string, unknown> = {}) => ({
  voix: [{ id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true }],
  choix: null, voixResolue: { id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true },
  motifVoix: null, messageVoix: null,
  prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }, { affiche: 'Neuchâtel', prononce: 'Neu-cha-tel' }],
  ecouteDisponible: true, ...over,
});

beforeEach(() => { serveur.appels.length = 0; (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = () => 'blob:apercu'; (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = () => {}; });
afterEach(() => { cleanup(); });

describe('MaVoixPanel', () => {
  it('voix sélectionnée « Ma voix — Bassi », liste des prononciations, aperçu affiché ≠ prononcé (même fonction que le serveur)', async () => {
    stub(profilBase());
    render(<MaVoixPanel />);
    await waitFor(() => expect(document.querySelector('[data-voix-selectionnee]')).not.toBeNull());
    expect(document.querySelector('[data-voix-selectionnee]')!.textContent).toContain('« Ma voix — Bassi »');
    expect(document.querySelectorAll('[data-prononciation]')).toHaveLength(2);
    expect(document.querySelector('[data-apercu-affiche]')!.textContent).toBe('« Bienvenue au cours Afroboost à Neuchâtel. »');
    expect(document.querySelector('[data-apercu-prononce]')!.textContent).toBe('« Bienvenue au cours Afro-boust à Neu-cha-tel. »');
    // Pas de sélecteur avec une seule voix.
    expect(document.querySelector('[data-voix-selecteur]')).toBeNull();
  });

  it('aucune voix : message du serveur, aucune écoute, aucun faux bouton', async () => {
    stub(profilBase({ voix: [], voixResolue: null, motifVoix: 'aucune_voix', messageVoix: 'Aucune voix personnelle n’est enregistrée sur votre compte.', ecouteDisponible: false }));
    render(<MaVoixPanel />);
    await waitFor(() => expect(document.querySelector('[data-voix-motif="aucune_voix"]')).not.toBeNull());
    expect(document.querySelector('[data-ecouter]')).toBeNull();
    expect(document.querySelector('[data-ecoute-indisponible]')!.textContent).toMatch(/L’écoute de votre voix personnelle n’est pas encore disponible\./);
  });

  it('plusieurs voix : sélecteur ; choisir envoie PUT /api/voice/profil/voix { userVoiceId } puis relit le profil', async () => {
    stub(profilBase({ voix: [{ id: V1, nom: 'Bassi', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true }, { id: V2, nom: 'Radio', fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-02', utilisable: true }], voixResolue: null, motifVoix: 'choix_requis', messageVoix: 'Plusieurs voix sont enregistrées : choisissez celle à utiliser.', ecouteDisponible: false }));
    render(<MaVoixPanel />);
    const select = await waitFor(() => {
      const el = document.querySelector('[data-voix-selecteur]') as HTMLSelectElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(document.querySelector('[data-ecouter]')).toBeNull();
    fireEvent.change(select, { target: { value: V2 } });
    await waitFor(() => expect(document.querySelector('[data-voix-selectionnee]')).not.toBeNull());
    const appel = serveur.appels.find((a) => a.url === '/api/voice/profil/voix')!;
    expect(appel.method).toBe('PUT');
    expect(appel.body).toEqual({ userVoiceId: V2 });
    expect(document.querySelector('[data-voix-selectionnee]')!.textContent).toContain('Radio');
  });

  it('ajouter / modifier / supprimer une prononciation → PUT de la liste complète ; doublon refusé localement', async () => {
    stub(profilBase({ prononciations: [] }));
    render(<MaVoixPanel />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Ajouter une prononciation/ })));
    fireEvent.change(document.querySelector('[data-prononciation-affiche]')!, { target: { value: 'Afroboost' } });
    fireEvent.change(document.querySelector('[data-prononciation-prononce]')!, { target: { value: 'Afro-boust' } });
    fireEvent.click(document.querySelector('[data-prononciation-valider]')!);
    await waitFor(() => expect(document.querySelector('[data-prononciation="Afroboost"]')).not.toBeNull());
    expect(serveur.appels.find((a) => a.url === '/api/voice/profil/prononciations')!.body).toEqual({ prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }] });
    // Doublon : refusé avant tout appel.
    const avant = serveur.appels.length;
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une prononciation/ }));
    fireEvent.change(document.querySelector('[data-prononciation-affiche]')!, { target: { value: 'afroboost' } });
    fireEvent.change(document.querySelector('[data-prononciation-prononce]')!, { target: { value: 'x' } });
    fireEvent.click(document.querySelector('[data-prononciation-valider]')!);
    await waitFor(() => expect(document.querySelector('[data-voix-erreur]')!.textContent).toMatch(/déjà une prononciation/));
    expect(serveur.appels.length).toBe(avant);
    fireEvent.click(document.querySelector('[data-prononciation-annuler]')!);
    // Modifier.
    fireEvent.click(document.querySelector('[data-prononciation-modifier="Afroboost"]')!);
    fireEvent.change(document.querySelector('[data-prononciation-prononce]')!, { target: { value: 'A-fro-boust' } });
    fireEvent.click(document.querySelector('[data-prononciation-valider]')!);
    await waitFor(() => expect(document.querySelector('[data-prononciation="Afroboost"]')!.textContent).toContain('A-fro-boust'));
    // Supprimer.
    fireEvent.click(document.querySelector('[data-prononciation-supprimer="Afroboost"]')!);
    await waitFor(() => expect(document.querySelector('[data-prononciation="Afroboost"]')).toBeNull());
    expect(serveur.appels.filter((a) => a.url === '/api/voice/profil/prononciations').pop()!.body).toEqual({ prononciations: [] });
    // Le texte affiché de l'aperçu n'a jamais bougé.
    expect(document.querySelector('[data-apercu-affiche]')!.textContent).toBe('« Bienvenue au cours Afroboost à Neuchâtel. »');
  });

  it('⚠️ « Écouter ma voix » : POST /api/voice/ecoute avec le texte AFFICHÉ (le serveur applique les prononciations) ; audio réel joué, texte dit montré', async () => {
    stub(profilBase());
    render(<MaVoixPanel />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Écouter ma voix/ })));
    await waitFor(() => expect(document.querySelector('[data-ecoute-audio]')).not.toBeNull());
    const appel = serveur.appels.find((a) => a.url === '/api/voice/ecoute')!;
    expect(appel.body).toEqual({ texte: 'Bienvenue au cours Afroboost à Neuchâtel.' });
    expect(document.body.textContent).toContain('Texte prononcé : « Bienvenue au cours Afro-boust à Neu-cha-tel. »');
  });

  it('⚠️ écoute en échec fournisseur : erreur honnête, aucun audio', async () => {
    stub(profilBase(), { status: 502 });
    render(<MaVoixPanel />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: /Écouter ma voix/ })));
    await waitFor(() => expect(document.querySelector('[data-voix-erreur]')!.textContent).toMatch(/fournisseur n’a pas pu générer/));
    expect(document.querySelector('[data-ecoute-audio]')).toBeNull();
  });

  it('⚠️ le panneau ne contient aucun audio embarqué ni voix générique de repli', async () => {
    const src = (await import('node:fs')).readFileSync((await import('node:path')).resolve(__dirname, '../components/voice/MaVoixPanel.tsx'), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(/data:audio|\.mp3'|speechSynthesis|SpeechSynthesisUtterance|\/api\/tts\//);
  });
});
