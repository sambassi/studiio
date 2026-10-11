import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { MESSAGE_STOCK_INDISPONIBLE } from '@/components/creer/CompleterRushesStock';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { MediaStock } from '@/lib/stock/types';

/**
 * « Compléter automatiquement mes rushes » — étape Rushes de l'Autopilote.
 *
 * Désactivé par défaut : rien de plus que la case, aucun appel stock, la
 * configuration enregistrée inchangée. Activé : une proposition Pexels par
 * plan manquant, et RIEN n'entre dans la banque sans « Conserver ».
 */

const A = 'https://studiio.pro/storage/v1/object/public/media/u/a.mp4';
const B = 'https://studiio.pro/storage/v1/object/public/media/u/b.mp4';
const C = 'https://studiio.pro/storage/v1/object/public/media/u/c.mp4';
const IMPORTE = (id: string) => `https://studiio.pro/storage/v1/object/public/media/u/library/stock-pexels-video-${id}.mp4`;
const CLE = 'studiio.autopilote.completerRushesStock';

function media(id: string, orientation: 'portrait' | 'landscape'): MediaStock {
  const portrait = orientation === 'portrait';
  return {
    id: `pexels-video-${id}`,
    provider: 'pexels',
    providerAssetId: id,
    type: 'video',
    largeur: portrait ? 1080 : 1920,
    hauteur: portrait ? 1920 : 1080,
    orientation,
    dureeSecondes: 12,
    vignetteUrl: `https://images.pexels.com/videos/${id}/thumb.jpg`,
    apercuUrl: `https://images.pexels.com/videos/${id}/apercu.jpg`,
    fichierUrl: `https://videos.pexels.com/video-files/${id}/hd.mp4`,
    sourceUrl: `https://www.pexels.com/video/${id}/`,
    auteur: `Auteur ${id}`,
    description: 'african dance workout',
    licence: 'Pexels License',
    attribution: `Vidéo de Auteur ${id} sur Pexels`,
  };
}

let configServeur: AutopilotConfig;
let envois: string[];
let appelsStock: string[];
let corpsImport: unknown[];
/** Ce que renvoie la recherche stock. */
let reponseRecherche: () => { ok: boolean; status: number; body: unknown };

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* */ }
  configServeur = { ...DEFAULT_CONFIG, topics: ['cours Afroboost cardio-danse'], rushUrls: [A] };
  envois = [];
  appelsStock = [];
  corpsImport = [];
  reponseRecherche = () => ({
    ok: true,
    status: 200,
    body: { success: true, medias: [media('L1', 'landscape'), media('P1', 'portrait'), media('P2', 'portrait'), media('P3', 'portrait')], echecs: [] },
  });

  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/stock/')) {
      appelsStock.push(u);
      if (u.startsWith('/api/stock/importer')) {
        const corps = JSON.parse(String(init?.body)) as { providerAssetId: string };
        corpsImport.push(corps);
        return { ok: true, json: async () => ({ success: true, url: IMPORTE(corps.providerAssetId), importe: true, media: media(corps.providerAssetId, 'portrait') }) };
      }
      const r = reponseRecherche();
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    if (u.startsWith('/api/voice/clone')) {
      return { ok: true, json: async () => ({ success: true, voices: [] }) };
    }
    if (u.startsWith('/api/autopilot/rush/verifier')) {
      return { ok: true, json: async () => ({ success: true, resultats: {}, refusees: [] }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        envois.push(String(init.body));
        const recu = sanitizeConfig(JSON.parse(String(init.body)));
        configServeur = recu;
        return { ok: true, json: async () => ({ success: true, config: recu }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ouvrirRushes() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-autopilot-add-rush]')).toBeTruthy());
}

const caseStock = () => document.querySelector('[data-autopilot-completer-stock]') as HTMLInputElement;

/** La case est désormais la source stock ENREGISTRÉE : un PUT, puis on repart de zéro. */
let envoiActivation: AutopilotConfig | null = null;
async function activer() {
  const avant = envois.length;
  fireEvent.click(caseStock());
  await waitFor(() => expect(envois.length).toBe(avant + 1));
  envoiActivation = JSON.parse(envois[avant]) as AutopilotConfig;
  envois.length = 0;
  await waitFor(() => expect(caseStock().checked).toBe(true));
}

async function attendrePropositions() {
  await waitFor(() => expect(document.querySelector('[data-autopilot-stock-slot="plan-3"][data-etat="propose"]')).toBeTruthy());
}

describe('Désactivé (défaut) — comportement identique', () => {
  it('la case est décochée, rien d autre n est rendu, aucun appel stock', async () => {
    await ouvrirRushes();
    expect(caseStock()).toBeTruthy();
    expect(caseStock().checked).toBe(false);
    expect(screen.getByText('Compléter avec Pexels / Unsplash')).toBeTruthy();
    expect(screen.getByText(/seuls les médias que vous retenez sont utilisés/)).toBeTruthy();
    expect(document.querySelector('[data-autopilot-stock]')).toBeNull();
    expect(document.querySelector('[data-autopilot-stock-suffisant]')).toBeNull();
    expect(document.querySelector('[data-autopilot-rush-stock]')).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(appelsStock).toEqual([]);
  });

  it('le PUT de configuration est strictement celui d avant', async () => {
    configServeur = { ...configServeur, rushUrls: [A, B] };
    const attendu = JSON.stringify(sanitizeConfig({ ...sanitizeConfig(configServeur), rushUrls: [A] }));
    await ouvrirRushes();
    const retirer = document.querySelectorAll('[aria-label="Retirer ce rush"]');
    fireEvent.click(retirer[1]);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(envois[0]).toBe(attendu);
    expect(appelsStock).toEqual([]);
  });

  it('cocher enregistre la source stock dans designStyle.sources (plus de localStorage)', async () => {
    configServeur = { ...configServeur, rushUrls: [A, B, C] };
    await ouvrirRushes();
    await activer();
    expect(envoiActivation!.designStyle.sources).toEqual({ actives: { rushes: true, avatar: false, stock: true }, stock: [], gabarit: [] });
    expect(envoiActivation!.rushUrls).toEqual([A, B, C]);
    expect(window.localStorage.getItem(CLE)).toBeNull();
    fireEvent.click(caseStock());
    await waitFor(() => expect(envois.length).toBe(1));
    expect((JSON.parse(envois[0]) as AutopilotConfig).designStyle.sources?.actives.stock).toBe(false);
    await waitFor(() => expect(document.querySelector('[data-autopilot-stock-suffisant]')).toBeNull());
  });

  it('l ancienne préférence localStorage est MIGRÉE une fois vers la configuration, puis effacée', async () => {
    configServeur = { ...configServeur, rushUrls: [A, B, C] };
    window.localStorage.setItem(CLE, '1');
    await ouvrirRushes();
    await waitFor(() => expect(caseStock().checked).toBe(true));
    await waitFor(() => expect(envois.length).toBe(1));
    expect((JSON.parse(envois[0]) as AutopilotConfig).designStyle.sources?.actives.stock).toBe(true);
    expect(window.localStorage.getItem(CLE)).toBeNull();
  });
});

describe('Activé — couverture suffisante', () => {
  it('3 rushes : message, aucune requête stock', async () => {
    configServeur = { ...configServeur, rushUrls: [A, B, C] };
    await ouvrirRushes();
    await activer();
    await waitFor(() => expect(screen.getByText('Vos rushes suffisent : aucun média stock nécessaire.')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 20));
    expect(appelsStock).toEqual([]);
  });
});

describe('Activé — « cours Afroboost cardio-danse », 1 rush', () => {
  it('propose seulement pour les 2 plans manquants, vertical d abord, sans rien ajouter', async () => {
    await ouvrirRushes();
    await activer();
    await attendrePropositions();
    expect(document.querySelector('[data-autopilot-stock-slot="plan-1"]')).toBeNull();
    expect(document.querySelector('[data-autopilot-stock-slot="plan-2"]')).toBeTruthy();
    expect(screen.getByText('Rushes personnels : 1')).toBeTruthy();
    expect(screen.getByText('Médias stock proposés : 2')).toBeTruthy();
    // Vertical (9:16) d'abord : le paysage L1 arrivé en tête n'est pas retenu.
    expect(document.querySelector('[data-autopilot-stock-vignette="P1"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-stock-vignette="P2"]')).toBeTruthy();
    expect(document.querySelector('[data-autopilot-stock-vignette="L1"]')).toBeNull();
    // Recherche Pexels vidéo uniquement.
    for (const u of appelsStock) {
      expect(u).toContain('type=video');
      expect(u).toContain('fournisseurs=pexels');
      expect(u).toContain('format=9%3A16');
    }
    // Attribution : lien vers la page Pexels, rel noopener.
    const lien = document.querySelector('a[href="https://www.pexels.com/video/P1/"]') as HTMLAnchorElement;
    expect(lien).toBeTruthy();
    expect(lien.rel).toContain('noopener');
    // Explication du manque.
    expect(screen.getAllByText(/tous vos rushes sont déjà utilisés/).length).toBe(2);
    // Libellés lisibles : jamais l'identifiant interne « plan-2 » à l'écran.
    expect(document.querySelector('[data-autopilot-stock]')!.textContent).not.toMatch(/plan-\d/);
    expect(screen.getByText('Plan de développement')).toBeTruthy();
    expect(screen.getByText('Plan temps fort')).toBeTruthy();
    // Rien d'ajouté sans « Conserver ».
    expect(envois).toEqual([]);
    expect(corpsImport).toEqual([]);
  });

  it('« Conserver » importe par identifiant et ajoute APRÈS les rushes de l utilisateur', async () => {
    await ouvrirRushes();
    await activer();
    await attendrePropositions();
    fireEvent.click(document.querySelector('[data-autopilot-stock-conserver="plan-2"]') as Element);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(corpsImport).toEqual([{ provider: 'pexels', type: 'video', providerAssetId: 'P1' }]);
    const recu = JSON.parse(envois[0]) as AutopilotConfig;
    expect(recu.rushUrls).toEqual([A, IMPORTE('P1')]);
    // UN seul PUT : la banque ET le média retenu (attribution comprise).
    expect(recu.designStyle.sources?.stock).toEqual([{
      url: IMPORTE('P1'), type: 'video', provider: 'pexels', providerAssetId: 'P1', auteur: 'Auteur P1',
      sourceUrl: 'https://www.pexels.com/video/P1/', licence: 'Pexels License', vignetteUrl: 'https://images.pexels.com/videos/P1/thumb.jpg',
    }]);
    await waitFor(() => expect(document.querySelector(`[data-autopilot-rush-stock="${IMPORTE('P1')}"]`)?.textContent).toBe('Stock · Pexels · Auteur P1'));
    expect(document.querySelector('[data-autopilot-stock-slot="plan-2"][data-etat="conserve"]')).toBeTruthy();
    // L'autre proposition reste en attente, rien n'est ajouté pour elle.
    expect(document.querySelector('[data-autopilot-stock-slot="plan-3"][data-etat="propose"]')).toBeTruthy();
    // Le compteur ne compte plus le média conservé (il est déjà dans la banque).
    expect(screen.getByText('Médias stock proposés : 1')).toBeTruthy();
  });

  it('« Supprimer » retire la proposition sans rien enregistrer', async () => {
    await ouvrirRushes();
    await activer();
    await attendrePropositions();
    fireEvent.click(document.querySelector('[data-autopilot-stock-supprimer="plan-2"]') as Element);
    await waitFor(() => expect(screen.getByText('Médias stock proposés : 1')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-stock-slot="plan-2"][data-etat="supprime"]')).toBeTruthy();
    expect(envois).toEqual([]);
  });

  it('« Remplacer » propose un autre média, jamais celui d un autre plan', async () => {
    await ouvrirRushes();
    await activer();
    await attendrePropositions();
    fireEvent.click(document.querySelector('[data-autopilot-stock-remplacer="plan-2"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-autopilot-stock-vignette="P3"]')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-stock-vignette="P1"]')).toBeNull();
    // P2 reste sur plan-3, il n'a pas été repris.
    expect(document.querySelectorAll('[data-autopilot-stock-vignette="P2"]').length).toBe(1);
    expect(envois).toEqual([]);
  });

  it('« Chercher autre chose » lance la requête libre pour ce plan', async () => {
    await ouvrirRushes();
    await activer();
    await attendrePropositions();
    const champ = document.querySelector('[data-autopilot-stock-libre="plan-2"]') as HTMLInputElement;
    fireEvent.change(champ, { target: { value: 'drum circle' } });
    fireEvent.click(document.querySelector('[data-autopilot-stock-chercher="plan-2"]') as Element);
    await waitFor(() => expect(appelsStock.some((u) => u.includes('requete=drum+circle'))).toBe(true));
    expect(envois).toEqual([]);
  });
});

describe('Activé — fournisseur en défaut', () => {
  it('erreur Pexels (quota) : message discret, le panneau reste utilisable', async () => {
    reponseRecherche = () => ({ ok: false, status: 429, body: { success: false, error: 'quota' } });
    await ouvrirRushes();
    await activer();
    await waitFor(() => expect(screen.getByText(MESSAGE_STOCK_INDISPONIBLE)).toBeTruthy());
    const suivant = document.querySelector('[data-autopilot-suivant]') as HTMLButtonElement;
    expect(suivant.disabled).toBe(false);
    fireEvent.click(suivant);
    await waitFor(() => expect(document.querySelector('[data-autopilot-add-rush]')).toBeNull());
    expect(envois).toEqual([]);
  });

  it('aucun résultat : même message, rien d ajouté', async () => {
    reponseRecherche = () => ({ ok: true, status: 200, body: { success: true, medias: [], echecs: [] } });
    await ouvrirRushes();
    await activer();
    await waitFor(() => expect(screen.getByText(MESSAGE_STOCK_INDISPONIBLE)).toBeTruthy());
    expect(screen.getByText('Médias stock proposés : 0')).toBeTruthy();
    expect((document.querySelector('[data-autopilot-suivant]') as HTMLButtonElement).disabled).toBe(false);
    expect(envois).toEqual([]);
  });

  it('sans aucun rush ni média retenu : bloqué (des propositions ne sont pas une source)', async () => {
    configServeur = { ...configServeur, rushUrls: [] };
    await ouvrirRushes();
    await activer();
    await attendrePropositions();
    expect((document.querySelector('[data-autopilot-suivant]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-autopilot-stock-slot="plan-1"]')).toBeTruthy();
  });
});
