import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { MESSAGE_STOCK_INDISPONIBLE } from '@/components/creer/CompleterRushesStock';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import { MESSAGES_RUSHES } from '@/lib/autopilot/medias-prevus';
import type { MediaStock } from '@/lib/stock/types';

/**
 * « PERSONNAGE PRINCIPAL — Faire apparaître mon avatar », étape Rushes.
 *
 * La case est le réglage EXISTANT `jumeauAvatar` (aucune colonne nouvelle).
 * Avatar prêt : l'étape passe sans rush ; sans avatar : la règle historique.
 * Le stock, activé avec l'avatar, ne comble que les plans que l'avatar ne
 * tient pas. Aucune génération d'avatar, aucun fournisseur appelé.
 */

const A = 'https://projet.supabase.co/storage/v1/object/public/media/u/a.mp4';
const B = 'https://projet.supabase.co/storage/v1/object/public/media/u/b.mp4';
const CLE = 'studiio.autopilote.completerRushesStock';

function media(id: string): MediaStock {
  return {
    id: `pexels-video-${id}`, provider: 'pexels', providerAssetId: id, type: 'video',
    largeur: 1080, hauteur: 1920, orientation: 'portrait', dureeSecondes: 12,
    vignetteUrl: `https://images.pexels.com/videos/${id}/thumb.jpg`,
    apercuUrl: `https://images.pexels.com/videos/${id}/apercu.jpg`,
    fichierUrl: `https://videos.pexels.com/video-files/${id}/hd.mp4`,
    sourceUrl: `https://www.pexels.com/video/${id}/`, auteur: `Auteur ${id}`,
    description: 'yoga', licence: 'Pexels License', attribution: `Vidéo de Auteur ${id} sur Pexels`,
  };
}

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
let envois: string[];
let appels: string[];
let etatJumeau: unknown;
let reponseRecherche: () => { ok: boolean; status: number; body: unknown };

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* */ }
  configServeur = { ...DEFAULT_CONFIG, topics: ['yoga'], rushUrls: [A, B] };
  envois = [];
  appels = [];
  etatJumeau = JUMEAU_PRET;
  reponseRecherche = () => ({ ok: true, status: 200, body: { success: true, medias: [media('P1'), media('P2'), media('P3')], echecs: [] } });

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    appels.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.startsWith('/api/creer/jumeau')) return { ok: true, json: async () => ({ success: true, data: etatJumeau }) };
    if (u.startsWith('/api/avatars')) return { ok: true, json: async () => ({ success: true, data: AVATARS }) };
    if (u.startsWith('/api/stock/importer')) {
      const corps = JSON.parse(String(init?.body)) as { providerAssetId: string };
      return { ok: true, json: async () => ({ success: true, url: `https://projet.supabase.co/storage/v1/object/public/media/u/library/stock-pexels-video-${corps.providerAssetId}.mp4`, media: media(corps.providerAssetId) }) };
    }
    if (u.startsWith('/api/stock/')) {
      const r = reponseRecherche();
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    if (u.startsWith('/api/voice/clone')) return { ok: true, json: async () => ({ success: true, voices: [] }) };
    if (u.startsWith('/api/autopilot/rush/verifier')) return { ok: true, json: async () => ({ success: true, resultats: {} }) };
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        envois.push(String(init.body));
        configServeur = sanitizeConfig(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ success: true, config: configServeur, jumeauReady: true }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, jumeauReady: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  // J : AUCUNE requête de génération d'avatar ni de fournisseur, dans aucun test.
  for (const a of appels) {
    expect(a).not.toMatch(/\/api\/creer\/jumeau\/generer|\/api\/avatar\/(generate|create|did|apercu)|heygen|d-id|elevenlabs|unsplash/i);
    expect(a.startsWith('GET /api/') || a.startsWith('PUT /api/') || a.startsWith('POST /api/')).toBe(true);
  }
  cleanup();
  vi.unstubAllGlobals();
});

async function ouvrirRushes() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-autopilot-avatar-principal]')).toBeTruthy());
}
const caseAvatar = () => document.querySelector('[data-autopilot-avatar-case]') as HTMLInputElement;
const suivant = () => document.querySelector('[data-autopilot-suivant]') as HTMLButtonElement;
const attendrePret = (v: 'oui' | 'non') => waitFor(() => expect(document.querySelector(`[data-avatar-pret="${v}"]`)).toBeTruthy());
const texte = () => document.body.textContent ?? '';

describe('A — 2 rushes, avatar OFF, stock OFF : comportement historique', () => {
  it('section affichée, case décochée, Continuer actif, PUT identique à avant', async () => {
    const attendu = JSON.stringify(sanitizeConfig({ ...sanitizeConfig(configServeur), rushUrls: [A] }));
    await ouvrirRushes();
    await attendrePret('oui');
    expect(screen.getByText('Personnage principal')).toBeTruthy();
    expect(screen.getByText('Faire apparaître mon avatar')).toBeTruthy();
    expect(screen.getByText('Utilisez votre avatar dans la vidéo, avec ou sans rush personnel.')).toBeTruthy();
    expect(caseAvatar().checked).toBe(false);
    expect(suivant().disabled).toBe(false);
    expect(document.querySelector('[data-autopilot-medias-avatar="non"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-medias-prevus]')?.getAttribute('data-rendu')).toBe('rushes');
    fireEvent.click(document.querySelectorAll('[aria-label="Retirer ce rush"]')[1]);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(envois[0]).toBe(attendu);
    expect(JSON.parse(envois[0]).jumeauAvatar).toBe(false);
    expect(appels.some((a) => a.includes('/api/stock/'))).toBe(false);
  });
});

describe('B — 2 rushes, avatar ON', () => {
  it('cocher enregistre jumeauAvatar: true (le réglage existant) et rien d autre', async () => {
    const avant = sanitizeConfig(configServeur);
    await ouvrirRushes();
    await attendrePret('oui');
    fireEvent.click(caseAvatar());
    await waitFor(() => expect(envois.length).toBe(1));
    expect(envois[0]).toBe(JSON.stringify(sanitizeConfig({ ...avant, jumeauAvatar: true })));
    await waitFor(() => expect(caseAvatar().checked).toBe(true));
    expect(document.querySelector('[data-autopilot-medias-avatar="oui"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-medias-rushes="2"]')).toBeTruthy();
    // Le rendu dit la vérité : avatar en séquence Vidéo, rushes en repli.
    expect(document.querySelector('[data-autopilot-medias-prevus]')?.getAttribute('data-rendu')).toBe('avatar-rushes-en-repli');
    expect(suivant().disabled).toBe(false);
    // Vignette : la source EXISTANTE de la version active, jamais une génération.
    await waitFor(() => expect(document.querySelector('[data-avatar-vignette="photo"]')?.getAttribute('src')).toBe('/api/avatars/versions/ver-1/source'));
  });
});

describe('C — 0 rush, avatar ON, stock ON', () => {
  it('étape valide, le stock COMPLÈTE l avatar (plans 2 et 3), résumé complet', async () => {
    configServeur = { ...configServeur, rushUrls: [], jumeauAvatar: true };
    window.localStorage.setItem(CLE, '1');
    await ouvrirRushes();
    await attendrePret('oui');
    await waitFor(() => expect(document.querySelector('[data-autopilot-stock-slot="plan-3"][data-etat="propose"]')).toBeTruthy());
    // L'avatar tient l'accroche : aucune proposition pour le plan 1.
    expect(document.querySelector('[data-autopilot-stock-slot="plan-1"]')).toBeNull();
    expect(document.querySelector('[data-autopilot-stock-slot="plan-2"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-stock-avatar]')).toBeTruthy();
    expect(screen.getByText('Médias stock proposés : 2')).toBeTruthy();
    // Conserver / Remplacer / Supprimer / Chercher autre chose : l'UI existante.
    for (const s of ['conserver', 'remplacer', 'supprimer', 'chercher']) {
      expect(document.querySelector(`[data-autopilot-stock-${s}="plan-2"]`)).toBeTruthy();
    }
    expect(suivant().disabled).toBe(false);
    expect(texte()).not.toMatch(/au moins un rush/i);
    await waitFor(() => expect(document.querySelector('[data-autopilot-medias-stock="2"]')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-medias-avatar="oui"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-medias-rushes="0"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-autopilot-medias-stock-vignette]').length).toBe(2);
    expect(document.querySelector('[data-autopilot-medias-stock-repli]')).toBeTruthy();
    expect(envois).toEqual([]);
    // Pexels uniquement (I).
    for (const a of appels.filter((x) => x.includes('/api/stock/recherche?'))) expect(a).toContain('fournisseurs=pexels');
  });
});

describe('D — 0 rush, avatar ON, stock OFF : avatar seul', () => {
  it('accepté, avec le message', async () => {
    configServeur = { ...configServeur, rushUrls: [], jumeauAvatar: true };
    await ouvrirRushes();
    await attendrePret('oui');
    await waitFor(() => expect(suivant().disabled).toBe(false));
    expect(document.querySelector('[data-autopilot-avatar-seul]')?.textContent).toBe(MESSAGES_RUSHES.avatarSeul);
    expect(document.querySelector('[data-autopilot-medias-prevus]')?.getAttribute('data-rendu')).toBe('avatar-seul');
    expect(document.querySelector('[data-autopilot-suivant-bloque]')).toBeNull();
    expect(texte()).not.toMatch(/au moins un rush/i);
    // Vérification : la check-list tient l'avatar pour suffisant.
    fireEvent.click(suivant());
    fireEvent.click(document.querySelector('[data-autopilot-etape="5"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-autopilot-checklist]')?.getAttribute('data-autopilot-pret')).toBe('oui'));
    expect(document.querySelector('[data-autopilot-medias-avatar="oui"]')).toBeTruthy();
    expect((document.querySelector('[data-autopilot-produire-maintenant]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('E — 0 rush, avatar OFF, stock OFF : blocage historique', () => {
  it('Continuer bloqué, message d avant', async () => {
    configServeur = { ...configServeur, rushUrls: [] };
    await ouvrirRushes();
    await attendrePret('oui');
    expect(suivant().disabled).toBe(true);
    expect(document.querySelector('[data-autopilot-suivant-bloque]')?.textContent).toBe('Ajoutez au moins un rush pour continuer');
    expect(screen.getByText('0 rush — au moins un est nécessaire')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-avatar-seul]')).toBeNull();
  });
});

describe('F — 0 rush, avatar OFF, stock ON : toujours bloqué', () => {
  it('les propositions ne débloquent rien', async () => {
    configServeur = { ...configServeur, rushUrls: [] };
    window.localStorage.setItem(CLE, '1');
    await ouvrirRushes();
    await waitFor(() => expect(document.querySelector('[data-autopilot-stock-slot="plan-3"][data-etat="propose"]')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-stock-slot="plan-1"]')).toBeTruthy();
    expect(suivant().disabled).toBe(true);
    expect(document.querySelector('[data-autopilot-suivant-bloque]')?.getAttribute('data-autopilot-suivant-bloque')).toBe('sans-rush');
  });
});

describe('G — avatar demandé, aucun avatar prêt', () => {
  it('case inactivable, « Aucun avatar prêt », lien Configurer mon avatar', async () => {
    etatJumeau = JUMEAU_ABSENT;
    configServeur = { ...configServeur, rushUrls: [] };
    await ouvrirRushes();
    await attendrePret('non');
    expect(caseAvatar().disabled).toBe(true);
    expect(texte()).toContain('Aucun avatar prêt.');
    const lien = document.querySelector('[data-autopilot-avatar-configurer]') as HTMLAnchorElement;
    expect(lien.textContent).toBe('Configurer mon avatar');
    expect(lien.getAttribute('href')).toBe('/dashboard/avatar');
    // Aucun avatar créé, aucune vignette lue.
    expect(appels.some((a) => a.includes('/api/avatars'))).toBe(false);
  });

  it('déjà coché (configuration ancienne) : étape bloquée avec un message explicite', async () => {
    etatJumeau = JUMEAU_ABSENT;
    configServeur = { ...configServeur, rushUrls: [], jumeauAvatar: true };
    await ouvrirRushes();
    await attendrePret('non');
    expect(suivant().disabled).toBe(true);
    expect(document.querySelector('[data-autopilot-suivant-bloque]')?.textContent).toBe(MESSAGES_RUSHES.avatarNonPret);
    expect(envois).toEqual([]);
  });

  it('moteur vidéo indisponible : même chose', async () => {
    etatJumeau = { ...JUMEAU_PRET, moteurDisponible: false, messageMoteur: 'Vidéo indisponible.' };
    configServeur = { ...configServeur, rushUrls: [] };
    await ouvrirRushes();
    await attendrePret('non');
    expect(caseAvatar().disabled).toBe(true);
    expect(texte()).toContain('Vidéo indisponible.');
  });
});

describe('H/I — fournisseurs stock en défaut', () => {
  it('H : erreur Pexels avec l avatar : pas de crash, étape toujours valide', async () => {
    reponseRecherche = () => ({ ok: false, status: 500, body: { success: false, error: 'boom' } });
    configServeur = { ...configServeur, rushUrls: [], jumeauAvatar: true };
    window.localStorage.setItem(CLE, '1');
    await ouvrirRushes();
    await waitFor(() => expect(screen.getByText(MESSAGE_STOCK_INDISPONIBLE)).toBeTruthy());
    expect(suivant().disabled).toBe(false);
    expect(document.querySelector('[data-autopilot-medias-stock="0"]')).toBeTruthy();
  });

  it('I : une réponse qui mentionne Unsplash en échec n est jamais appelée côté Unsplash', async () => {
    reponseRecherche = () => ({ ok: true, status: 200, body: { success: true, medias: [], echecs: [{ fournisseur: 'unsplash', motif: 'erreur' }] } });
    configServeur = { ...configServeur, rushUrls: [], jumeauAvatar: true };
    window.localStorage.setItem(CLE, '1');
    await ouvrirRushes();
    await waitFor(() => expect(screen.getByText(MESSAGE_STOCK_INDISPONIBLE)).toBeTruthy());
    expect(suivant().disabled).toBe(false);
    const recherches = appels.filter((a) => a.includes('/api/stock/recherche?'));
    expect(recherches.length).toBeGreaterThan(0);
    for (const a of recherches) {
      expect(a).toContain('fournisseurs=pexels');
      expect(a).not.toMatch(/unsplash/i);
    }
  });
});
