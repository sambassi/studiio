import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { MESSAGE_RECHERCHE_INDISPONIBLE } from '@/components/creer/StockRechercheAutopilote';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import { MESSAGES_RUSHES, validerEtapeRushes, gabaritSuggere } from '@/lib/autopilot/medias-prevus';
import type { ConfigSources, MediaStockRetenu } from '@/lib/autopilot/sources';
import type { MediaStock } from '@/lib/stock/types';

/**
 * Autopilote MULTI-SOURCES — l'écran (étape Rushes / Médias).
 *
 * Rushes personnels, avatar et stock (Pexels / Unsplash) sont des SOURCES
 * indépendantes et combinables. La vidéo est possible dès qu'UNE source
 * visuelle existe — plus de « au moins un rush ». Tout se persiste dans
 * `designStyle.sources` (+ `jumeauAvatar`), par le PUT existant.
 */

const ORIGINE = 'https://studiio.pro/storage/v1/object/public/media/u';
const A = `${ORIGINE}/a.mp4`;
const B = `${ORIGINE}/b.mp4`;
const IMPORTE = (id: string) => `${ORIGINE}/library/stock-pexels-video-${id}.mp4`;
const HOTLINK = (id: string) => `https://images.unsplash.com/photo-${id}?ixid=x`;

function media(provider: 'pexels' | 'unsplash', type: 'video' | 'photo', id: string): MediaStock {
  return {
    id: `${provider}-${type}-${id}`, provider, providerAssetId: id, type,
    largeur: 1080, hauteur: 1920, orientation: 'portrait', dureeSecondes: type === 'video' ? 10 : undefined,
    vignetteUrl: `https://cdn.${provider}.test/${id}/thumb.jpg`,
    apercuUrl: `https://cdn.${provider}.test/${id}/apercu.jpg`,
    fichierUrl: type === 'photo' ? `https://images.${provider}.com/${id}/full.jpg` : `https://cdn.${provider}.test/${id}/full.mp4`,
    sourceUrl: `https://www.${provider}.com/${type}/${id}/`, auteur: `Auteur ${id}`,
    description: 'danse', licence: provider === 'unsplash' ? 'Unsplash License' : 'Pexels License',
    attribution: `x`,
  };
}

const retenu = (provider: 'pexels' | 'unsplash', type: 'video' | 'photo', id: string, url?: string): MediaStockRetenu => ({
  url: url ?? (type === 'video' ? IMPORTE(id) : `https://images.${provider}.com/${id}/full.jpg`),
  type, provider, providerAssetId: id, auteur: `Auteur ${id}`, sourceUrl: `https://www.${provider}.com/${type}/${id}/`,
  licence: provider === 'unsplash' ? 'Unsplash License' : 'Pexels License', vignetteUrl: `https://cdn.${provider}.test/${id}/thumb.jpg`,
});

const sourcesCfg = (p: { actives?: Partial<ConfigSources['actives']>; stock?: MediaStockRetenu[]; gabarit?: ConfigSources['gabarit'] } = {}): ConfigSources => ({
  actives: { rushes: true, avatar: false, stock: false, ...(p.actives ?? {}) },
  stock: p.stock ?? [],
  gabarit: p.gabarit ?? [],
});

const JUMEAU_PRET = {
  pret: true, motif: null, message: null, moteurDisponible: true, messageMoteur: null,
  jumeau: { avatar: { id: 'av1', version: 2, nom: 'Moi', valideLe: '2026-10-01', fournisseur: 'heygen' }, voix: { id: 'v1', nom: 'Ma voix' }, prononciations: 0 },
};
const JUMEAU_ABSENT = { pret: false, motif: 'avatar_absent', message: 'Vous n’avez pas encore d’avatar.', moteurDisponible: true, messageMoteur: null, jumeau: null };
const AVATARS = {
  avatars: [{ id: 'av1', nom: 'Moi', parDefaut: true, utilisable: true, type: 'photo', versionActive: { id: 'ver-1', version: 2, source: true, type: 'photo' } }],
};

let configServeur: AutopilotConfig;
let envois: AutopilotConfig[];
let brut: string[];
let appels: string[];
let importes: unknown[];
let etatJumeau: unknown;
let rechercheEnPanne: boolean;
let importEnPanne: boolean;

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* */ }
  configServeur = { ...DEFAULT_CONFIG, topics: ['yoga'], rushUrls: [] };
  envois = []; brut = []; appels = []; importes = [];
  etatJumeau = JUMEAU_PRET;
  rechercheEnPanne = false;
  importEnPanne = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    appels.push(u);
    if (u.startsWith('/api/creer/jumeau')) return { ok: true, json: async () => ({ success: true, data: etatJumeau }) };
    if (u.startsWith('/api/avatars')) return { ok: true, json: async () => ({ success: true, data: AVATARS }) };
    if (u.startsWith('/api/stock/importer')) {
      const corps = JSON.parse(String(init?.body)) as { provider: string; type: string; providerAssetId: string };
      importes.push(corps);
      if (importEnPanne) return { ok: false, status: 502, json: async () => ({ success: false, error: 'indisponible' }) };
      const urlRendue = corps.provider === 'unsplash' ? HOTLINK(corps.providerAssetId) : IMPORTE(corps.providerAssetId);
      return { ok: true, json: async () => ({ success: true, url: urlRendue, importe: corps.type === 'video', media: media(corps.provider as 'pexels', corps.type as 'video', corps.providerAssetId) }) };
    }
    if (u.startsWith('/api/stock/recherche')) {
      if (rechercheEnPanne) return { ok: false, status: 500, json: async () => ({ success: false, error: 'boom' }) };
      const type = new URL(u, 'http://x').searchParams.get('type');
      const medias = type === 'photo'
        ? [media('pexels', 'photo', 'PH1'), media('unsplash', 'photo', 'U1')]
        : [media('pexels', 'video', 'V1'), media('pexels', 'video', 'V2')];
      return { ok: true, json: async () => ({ success: true, medias, echecs: [] }) };
    }
    if (u.startsWith('/api/voice/clone')) return { ok: true, json: async () => ({ success: true, voices: [] }) };
    if (u.startsWith('/api/autopilot/rush/verifier')) return { ok: true, json: async () => ({ success: true, resultats: {} }) };
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        brut.push(String(init.body));
        configServeur = sanitizeConfig(JSON.parse(String(init.body)));
        envois.push(configServeur);
        return { ok: true, json: async () => ({ success: true, config: configServeur, jumeauReady: true }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, jumeauReady: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  // AUCUNE requête fournisseur depuis le navigateur — uniquement les routes Studiio.
  for (const a of appels) {
    expect(a.startsWith('/api/')).toBe(true);
    expect(a).not.toMatch(/heygen|elevenlabs|api\.pexels|api\.unsplash|\/api\/creer\/jumeau\/generer/i);
  }
  cleanup();
  vi.unstubAllGlobals();
});

async function ouvrir(attendreAvatar: 'oui' | 'non' = 'oui') {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-autopilot-sources]')).toBeTruthy());
  await waitFor(() => expect(document.querySelector(`[data-avatar-pret="${attendreAvatar}"]`)).toBeTruthy());
}
const suivant = () => document.querySelector('[data-autopilot-suivant]') as HTMLButtonElement;
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const texte = () => document.body.textContent ?? '';
const dernier = () => envois[envois.length - 1];

describe('Règle de validation — les 7 combinaisons et les deux blocages', () => {
  const combis: Array<[string, number, boolean, number]> = [
    ['rushes seuls', 2, false, 0],
    ['avatar seul (prêt)', 0, true, 0],
    ['stock seul (retenu)', 0, false, 2],
    ['rushes + avatar', 2, true, 0],
    ['rushes + stock', 2, false, 2],
    ['avatar + stock', 0, true, 2],
    ['rushes + avatar + stock', 2, true, 2],
  ];
  for (const [nom, r, av, st] of combis) {
    it(`${nom} → valide`, () => {
      expect(validerEtapeRushes({ nbRushes: r, avatarDemande: av, avatarPret: av ? true : null, stockRetenus: st }).bloque).toBe(false);
    });
  }
  it('rien → bloqué, avec la phrase « aucune source » (jamais « au moins un rush »)', () => {
    const v = validerEtapeRushes({ nbRushes: 0, avatarDemande: false, avatarPret: null, stockRetenus: 0 });
    expect(v).toEqual({ bloque: true, motif: 'sans-source', message: MESSAGES_RUSHES.sansSource });
    expect(v.message).not.toMatch(/au moins un rush/i);
  });
  it('avatar demandé mais pas prêt → bloqué, même avec d autres sources', () => {
    expect(validerEtapeRushes({ nbRushes: 2, avatarDemande: true, avatarPret: false, stockRetenus: 2 }).motif).toBe('avatar-non-pret');
  });
  it('plan suggéré : avatar en premier et en dernier, rushes d’abord, stock en complément', () => {
    expect(gabaritSuggere({ avatar: true, rushes: 1, stock: 2 }).map((c) => c.type)).toEqual(['avatar', 'rush', 'stock', 'stock', 'avatar']);
    expect(gabaritSuggere({ avatar: false, rushes: 0, stock: 1 }).map((c) => c.type)).toEqual(['stock', 'stock', 'stock']);
    // Jamais plus de créneaux stock que de médias stock distincts : le reste revient aux rushes.
    expect(gabaritSuggere({ avatar: false, rushes: 1, stock: 2 }).map((c) => c.type)).toEqual(['rush', 'stock', 'stock', 'rush']);
    expect(gabaritSuggere({ avatar: true, rushes: 1, stock: 1 }).map((c) => c.type)).toEqual(['avatar', 'rush', 'stock', 'rush', 'avatar']);
    expect(gabaritSuggere({ avatar: false, rushes: 0, stock: 0 })).toEqual([]);
  });
  it('gabaritSuggere : rushes personnels d’abord, le stock ne complète que les créneaux restants, nombre de créneaux inchangé', () => {
    const t = (avatar: boolean, rushes: number, stock: number) => gabaritSuggere({ avatar, rushes, stock }).map((c) => c.type);
    // Avatar + 2 rushes + stock : les deux rushes avant le stock.
    expect(t(true, 2, 3)).toEqual(['avatar', 'rush', 'rush', 'stock', 'avatar']);
    // 2 rushes + stock, sans avatar.
    expect(t(false, 2, 3)).toEqual(['rush', 'rush', 'stock', 'stock']);
    // Avatar + stock seul.
    expect(t(true, 0, 2)).toEqual(['avatar', 'stock', 'stock', 'avatar']);
    // 1 rush + stock + avatar : jamais d'alternance qui ramènerait un rush après le stock.
    expect(t(true, 1, 2)).toEqual(['avatar', 'rush', 'stock', 'stock', 'avatar']);
    // Rushes plus nombreux que les créneaux : tous les créneaux B-roll sont des rushes, le stock n'entre pas.
    expect(t(false, 5, 2)).toEqual(['rush', 'rush', 'rush', 'rush']);
    expect(t(true, 4, 2)).toEqual(['avatar', 'rush', 'rush', 'rush', 'avatar']);
    // Sans stock : les rushes se répètent.
    expect(t(false, 1, 0)).toEqual(['rush', 'rush', 'rush']);
    expect(t(true, 2, 0)).toEqual(['avatar', 'rush', 'rush', 'avatar']);
    // Avatar seul.
    expect(t(true, 0, 0)).toEqual(['avatar']);
    // Identifiants stables s1…sN.
    expect(gabaritSuggere({ avatar: true, rushes: 2, stock: 3 }).map((c) => c.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });
});

describe('Écran — validation par combinaison', () => {
  it('0 rush + avatar prêt : Continuer actif, « Vidéo multi-sources prête », aucun « au moins un rush »', async () => {
    configServeur = { ...configServeur, jumeauAvatar: true };
    await ouvrir();
    await waitFor(() => expect(suivant().disabled).toBe(false));
    expect(q('[data-autopilot-medias-rendu]')!.textContent).toBe('Vidéo multi-sources prête.');
    expect(texte()).not.toMatch(/au moins un rush/i);
    expect(envois).toEqual([]);
  });

  it('0 rush + stock retenu (photo Unsplash) : Continuer actif', async () => {
    configServeur = { ...configServeur, designStyle: { sources: sourcesCfg({ actives: { stock: true }, stock: [retenu('unsplash', 'photo', 'U9', HOTLINK('U9'))] }) } };
    await ouvrir();
    expect(suivant().disabled).toBe(false);
    expect(q('[data-autopilot-medias-unsplash]')!.getAttribute('data-autopilot-medias-unsplash')).toBe('1');
    expect(texte()).not.toMatch(/au moins un rush/i);
  });

  it('0 rush + rien : bloqué, message unique « aucune source »', async () => {
    await ouvrir();
    expect(suivant().disabled).toBe(true);
    expect(q('[data-autopilot-suivant-bloque]')!.textContent).toBe(MESSAGES_RUSHES.sansSource);
    expect(q('[data-autopilot-sources-aucune]')).toBeTruthy();
    expect(q('[data-autopilot-medias-prevus]')!.getAttribute('data-rendu')).toBe('rien');
    expect(texte()).not.toMatch(/au moins un rush/i);
  });

  it('avatar demandé mais pas prêt : bloqué, « Aucun avatar prêt » et lien « Configurer mon avatar »', async () => {
    etatJumeau = JUMEAU_ABSENT;
    configServeur = { ...configServeur, rushUrls: [A], jumeauAvatar: true };
    await ouvrir('non');
    expect(suivant().disabled).toBe(true);
    expect(q('[data-autopilot-suivant-bloque]')!.getAttribute('data-autopilot-suivant-bloque')).toBe('avatar-non-pret');
    expect(texte()).toContain('Aucun avatar prêt.');
    expect((q('[data-autopilot-avatar-case]') as HTMLInputElement).disabled).toBe(true);
    expect(q('[data-autopilot-avatar-configurer]')!.getAttribute('href')).toBe('/dashboard/avatar');
  });
});

describe('Persistance des sources', () => {
  it('configuration jamais touchée : PUT identique à avant, aucune clé `sources`', async () => {
    configServeur = { ...configServeur, rushUrls: [A, B] };
    const attendu = JSON.stringify(sanitizeConfig({ ...sanitizeConfig(configServeur), rushUrls: [A] }));
    await ouvrir();
    fireEvent.click(document.querySelectorAll('[aria-label="Retirer ce rush"]')[1]);
    await waitFor(() => expect(brut.length).toBe(1));
    expect(brut[0]).toBe(attendu);
    expect(JSON.parse(brut[0]).designStyle.sources).toBeUndefined();
  });

  it('avatar sans clé `sources` : seul jumeauAvatar part (le PUT d avant)', async () => {
    configServeur = { ...configServeur, rushUrls: [A] };
    const avant = sanitizeConfig(configServeur);
    await ouvrir();
    fireEvent.click(q('[data-autopilot-avatar-case]')!);
    await waitFor(() => expect(brut.length).toBe(1));
    expect(brut[0]).toBe(JSON.stringify(sanitizeConfig({ ...avant, jumeauAvatar: true })));
  });

  it('« Mes rushes » décoché → designStyle.sources.actives.rushes = false, le reste préservé', async () => {
    configServeur = { ...configServeur, rushUrls: [A], designStyle: { montage: { format: '9:16', dureeSecondes: 30 } } as AutopilotConfig['designStyle'] };
    await ouvrir();
    fireEvent.click(q('[data-autopilot-source-rushes]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(dernier().designStyle.sources).toEqual(sourcesCfg({ actives: { rushes: false } }));
    expect(dernier().designStyle.montage).toEqual({ format: '9:16', dureeSecondes: 30 });
    expect(dernier().rushUrls).toEqual([A]);
    // Plus de source : bloqué.
    await waitFor(() => expect(suivant().disabled).toBe(true));
  });

  it('avatar avec clé `sources` : jumeauAvatar ET sources.actives.avatar', async () => {
    configServeur = { ...configServeur, rushUrls: [A], designStyle: { sources: sourcesCfg() } };
    await ouvrir();
    fireEvent.click(q('[data-autopilot-avatar-case]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(dernier().jumeauAvatar).toBe(true);
    expect(dernier().designStyle.sources!.actives).toEqual({ rushes: true, avatar: true, stock: false });
  });

  it('« Compléter avec Pexels / Unsplash » → sources.actives.stock = true', async () => {
    configServeur = { ...configServeur, rushUrls: [A] };
    await ouvrir();
    fireEvent.click(q('[data-autopilot-completer-stock]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(dernier().designStyle.sources!.actives.stock).toBe(true);
    await waitFor(() => expect(q('[data-autopilot-stock-recherche="general"]')).toBeTruthy());
  });
});

describe('Retenir des médias stock', () => {
  beforeEach(() => {
    configServeur = { ...configServeur, rushUrls: [A], designStyle: { sources: sourcesCfg({ actives: { stock: true } }) } };
  });
  const chercher = async (mode: 'video' | 'photo') => {
    const zone = q('[data-autopilot-stock-recherche="general"]')!;
    fireEvent.click(zone.querySelector(`[data-autopilot-stock-mode="${mode}"]`)!);
    fireEvent.click(zone.querySelector('[data-autopilot-stock-lancer="general"]')!);
    await waitFor(() => expect(zone.querySelector('[data-autopilot-stock-resultat]')).toBeTruthy());
    return zone;
  };

  it('vidéo Pexels : importée (corps minimal), ajoutée à la banque ET aux sources, attribution gardée', async () => {
    await ouvrir();
    const zone = await chercher('video');
    fireEvent.click(zone.querySelector('[data-autopilot-stock-retenir="pexels-video-V1"]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(importes).toEqual([{ provider: 'pexels', type: 'video', providerAssetId: 'V1' }]);
    expect(dernier().rushUrls).toEqual([A, IMPORTE('V1')]);
    expect(dernier().designStyle.sources!.stock).toEqual([{ ...retenu('pexels', 'video', 'V1'), sourceUrl: 'https://www.pexels.com/video/V1/' }]);
    await waitFor(() => expect(q('[data-autopilot-stock-retenu="pexels-video-V1"]')).toBeTruthy());
    expect(q('[data-autopilot-stock-retenu="pexels-video-V1"] [data-autopilot-stock-attribution]')!.textContent).toContain('Vidéo de Auteur V1 sur Pexels');
  });

  it('photo Pexels : AUCUN import, URL Pexels retenue', async () => {
    await ouvrir();
    const zone = await chercher('photo');
    fireEvent.click(zone.querySelector('[data-autopilot-stock-retenir="pexels-photo-PH1"]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(importes).toEqual([]);
    expect(dernier().rushUrls).toEqual([A]);
    expect(dernier().designStyle.sources!.stock[0]).toMatchObject({ url: 'https://images.pexels.com/PH1/full.jpg', type: 'photo', provider: 'pexels', auteur: 'Auteur PH1', licence: 'Pexels License' });
  });

  it('photo Unsplash : importer appelé (signalement du téléchargement), URL hotlink retenue', async () => {
    await ouvrir();
    const zone = await chercher('photo');
    fireEvent.click(zone.querySelector('[data-autopilot-stock-retenir="unsplash-photo-U1"]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(importes).toEqual([{ provider: 'unsplash', type: 'photo', providerAssetId: 'U1' }]);
    expect(dernier().rushUrls).toEqual([A]);
    expect(dernier().designStyle.sources!.stock[0]).toMatchObject({ url: HOTLINK('U1'), provider: 'unsplash', type: 'photo', sourceUrl: 'https://www.unsplash.com/photo/U1/' });
    await waitFor(() => expect(texte()).toContain('Photo de Auteur U1 sur Unsplash'));
  });

  it('recherche en panne : message discret, aucun crash, rien d enregistré', async () => {
    rechercheEnPanne = true;
    await ouvrir();
    const zone = q('[data-autopilot-stock-recherche="general"]')!;
    fireEvent.click(zone.querySelector('[data-autopilot-stock-lancer="general"]')!);
    await waitFor(() => expect(within(zone).getByText(MESSAGE_RECHERCHE_INDISPONIBLE)).toBeTruthy());
    expect(suivant().disabled).toBe(false);
    expect(envois).toEqual([]);
  });

  it('import en panne : message discret, rien d enregistré', async () => {
    importEnPanne = true;
    await ouvrir();
    const zone = await chercher('photo');
    fireEvent.click(zone.querySelector('[data-autopilot-stock-retenir="unsplash-photo-U1"]')!);
    await waitFor(() => expect(zone.querySelector('[data-autopilot-stock-retenir-erreur]')).toBeTruthy());
    expect(envois).toEqual([]);
  });
});

describe('Résumé « Médias prévus »', () => {
  it('compte chaque source et montre les vignettes', async () => {
    configServeur = {
      ...configServeur,
      jumeauAvatar: true,
      rushUrls: [A, IMPORTE('V1'), IMPORTE('V2')],
      designStyle: { sources: sourcesCfg({
        actives: { avatar: true, stock: true },
        stock: [retenu('pexels', 'video', 'V1'), retenu('pexels', 'video', 'V2'), retenu('pexels', 'photo', 'PH1'), retenu('unsplash', 'photo', 'U1'), retenu('unsplash', 'photo', 'U2')],
      }) },
    };
    await ouvrir();
    await waitFor(() => expect(q('[data-autopilot-medias-avatar="oui"]')).toBeTruthy());
    expect(q('[data-autopilot-medias-rushes]')!.getAttribute('data-autopilot-medias-rushes')).toBe('1');
    expect(q('[data-autopilot-medias-pexels]')!.textContent).toBe('2 vidéos (+ 1 photo)');
    expect(q('[data-autopilot-medias-unsplash]')!.textContent).toBe('2 photos');
    expect(document.querySelectorAll('[data-autopilot-medias-stock-vignette]').length).toBe(5);
    expect(q('[data-autopilot-medias-rendu]')!.textContent).toBe('Vidéo multi-sources prête.');
    expect(texte()).not.toMatch(/secours|ne sont pas montés avec|au moins un rush/i);
  });
});

describe('Plan avant génération', () => {
  const stock = [retenu('unsplash', 'photo', 'U1', HOTLINK('U1')), retenu('pexels', 'photo', 'PH1')];
  beforeEach(() => {
    configServeur = { ...configServeur, jumeauAvatar: true, rushUrls: [A], designStyle: { sources: sourcesCfg({ actives: { avatar: true, stock: true }, stock }) } };
  });
  const types = () => Array.from(document.querySelectorAll('[data-plan-ligne]')).map((l) => l.getAttribute('data-plan-type'));

  it('suggestion dérivée des sources, CTA fixe à la fin, rien enregistré tant qu on n y touche pas', async () => {
    await ouvrir();
    await waitFor(() => expect(types()).toEqual(['avatar', 'rush', 'stock', 'stock', 'avatar']));
    expect(q('[data-plan-suggere]')).toBeTruthy();
    expect(q('[data-plan-cta]')!.textContent).toContain('CTA');
    expect(q('[data-plan-ligne="0"]')!.textContent).toContain('Séquence 1 — Avatar');
    expect(q('[data-plan-ligne="1"]')!.textContent).toContain('Séquence 2 — Rush personnel');
    expect(q('[data-plan-ligne="2"]')!.textContent).toContain('Séquence 3 — Unsplash / Pexels');
    expect(q('[data-plan-ligne="0"] [data-avatar-vignette]')).toBeTruthy();
    expect(envois).toEqual([]);
  });

  it('descendre / supprimer / forcer / remplacer : chaque geste persiste le gabarit', async () => {
    await ouvrir();
    await waitFor(() => expect(types().length).toBe(5));
    fireEvent.click(q('[data-plan-descendre="0"]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(dernier().designStyle.sources!.gabarit.map((c) => c.type)).toEqual(['rush', 'avatar', 'stock', 'stock', 'avatar']);
    await waitFor(() => expect(q('[data-autopilot-plan]')!.getAttribute('data-plan-fixe')).toBe('oui'));

    fireEvent.click(q('[data-plan-monter="1"]')!);
    await waitFor(() => expect(envois.length).toBe(2));
    expect(dernier().designStyle.sources!.gabarit.map((c) => c.type)).toEqual(['avatar', 'rush', 'stock', 'stock', 'avatar']);

    fireEvent.click(q('[data-plan-supprimer="3"]')!);
    await waitFor(() => expect(envois.length).toBe(3));
    expect(dernier().designStyle.sources!.gabarit.map((c) => c.type)).toEqual(['avatar', 'rush', 'stock', 'avatar']);

    fireEvent.change(q('[data-plan-forcer="1"]')!, { target: { value: 'auto' } });
    await waitFor(() => expect(envois.length).toBe(4));
    expect(dernier().designStyle.sources!.gabarit[1]).toMatchObject({ type: 'auto' });

    fireEvent.change(q('[data-plan-media="2"]')!, { target: { value: HOTLINK('U1') } });
    await waitFor(() => expect(envois.length).toBe(5));
    expect(dernier().designStyle.sources!.gabarit[2]).toMatchObject({ type: 'stock', media: HOTLINK('U1') });
    await waitFor(() => expect(q('[data-plan-ligne="2"]')!.textContent).toContain('Unsplash · photo de Auteur U1'));
    // Le reste de la configuration n'a pas bougé.
    expect(dernier().jumeauAvatar).toBe(true);
    expect(dernier().designStyle.sources!.stock).toHaveLength(2);
  });

  it('« Rechercher » une ligne : le média retenu remplit CETTE ligne (stock) et rejoint les sources', async () => {
    await ouvrir();
    await waitFor(() => expect(types().length).toBe(5));
    fireEvent.click(q('[data-plan-rechercher="1"]')!);
    const zone = await waitFor(() => { const z = q('[data-autopilot-stock-recherche^="ligne-"]'); expect(z).toBeTruthy(); return z!; });
    expect(zone.textContent).toContain('séquence 2');
    fireEvent.click(zone.querySelector('[data-autopilot-stock-mode="video"]')!);
    fireEvent.click(zone.querySelector('[data-autopilot-stock-lancer]')!);
    await waitFor(() => expect(zone.querySelector('[data-autopilot-stock-retenir="pexels-video-V2"]')).toBeTruthy());
    fireEvent.click(zone.querySelector('[data-autopilot-stock-retenir="pexels-video-V2"]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    const g = dernier().designStyle.sources!.gabarit;
    expect(g.map((c) => c.type)).toEqual(['avatar', 'stock', 'stock', 'stock', 'avatar']);
    expect(g[1].media).toBe(IMPORTE('V2'));
    expect(dernier().designStyle.sources!.stock.map((m) => m.providerAssetId)).toEqual(['U1', 'PH1', 'V2']);
    expect(dernier().rushUrls).toEqual([A, IMPORTE('V2')]);
    await waitFor(() => expect(q('[data-autopilot-stock-recherche^="ligne-"]')).toBeNull());
  });

  it('« Laisser Studiio décider » vide le gabarit', async () => {
    configServeur = { ...configServeur, designStyle: { sources: { ...configServeur.designStyle.sources!, gabarit: [{ id: 's1', type: 'rush' }] } } };
    await ouvrir();
    fireEvent.click(q('[data-plan-reinitialiser]')!);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(dernier().designStyle.sources!.gabarit).toEqual([]);
  });
});

describe('Vérification — check-list et récapitulatif multi-sources', () => {
  it('0 rush + stock retenu : prêt, sources résumées, « Produire » possible', async () => {
    configServeur = { ...configServeur, designStyle: { sources: sourcesCfg({ actives: { stock: true }, stock: [retenu('pexels', 'photo', 'PH1')] }) } };
    await ouvrir();
    fireEvent.click(q('[data-autopilot-etape="5"]')!);
    await waitFor(() => expect(q('[data-autopilot-checklist]')!.getAttribute('data-autopilot-pret')).toBe('oui'));
    expect(q('[data-autopilot-check="rushes"]')!.textContent).toContain('Sources : 1 média stock');
    expect((q('[data-autopilot-produire-maintenant]') as HTMLButtonElement).disabled).toBe(false);
    expect(q('[data-autopilot-toggle]')!.getAttribute('data-cta')).toBe('principal');
    expect(texte()).not.toMatch(/au moins un rush/i);
  });
});
