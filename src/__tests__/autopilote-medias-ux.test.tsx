import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import CarteMedia from '@/components/medias/CarteMedia';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import { mediasSuggeres } from '@/lib/autopilot/medias-prevus';
import { CREDIT_FOURNISSEURS, NOMS_FOURNISSEURS, dureeLisible } from '@/lib/medias/libelles';
import type { ConfigSources, MediaStockRetenu } from '@/lib/autopilot/sources';
import type { MediaStock } from '@/lib/stock/types';
import { vignettesPourTests } from '@/lib/medias/vignette-video';

/**
 * AUTOPILOTE — MÉDIAS SANS FOURNISSEUR, EN CARTES.
 *
 * Règle produit : l'utilisateur ne voit jamais « Pexels » ni « Unsplash »
 * (ni un nom de fichier en libellé). Seuls les CRÉDITS exigés par les
 * plateformes les nomment, dans des éléments `data-credit-media`.
 *
 * Et rien ne change côté données : les PUT sont ceux d'avant, au caractère près.
 */

const ORIGINE = 'https://studiio.pro/storage/v1/object/public/media/u';
const A = `${ORIGINE}/a.mp4`;
const B = `${ORIGINE}/b.mp4`;
const DEAD = `${ORIGINE}/mort.mp4`;
const IMPORTE = (id: string) => `${ORIGINE}/library/stock-pexels-video-${id}.mp4`;
const HOTLINK = (id: string) => `https://images.unsplash.com/photo-${id}?ixid=x`;

function media(provider: 'pexels' | 'unsplash', type: 'video' | 'photo', id: string): MediaStock {
  return {
    id: `${provider}-${type}-${id}`, provider, providerAssetId: id, type,
    largeur: 1080, hauteur: 1920, orientation: 'portrait', dureeSecondes: type === 'video' ? 12 : undefined,
    vignetteUrl: `https://cdn.${provider}.test/${id}/thumb.jpg`,
    apercuUrl: `https://cdn.${provider}.test/${id}/apercu.jpg`,
    fichierUrl: type === 'photo' ? `https://images.${provider}.com/${id}/full.jpg` : `https://cdn.${provider}.test/${id}/full.mp4`,
    sourceUrl: `https://www.${provider}.com/${type}/${id}/`, auteur: `Auteur ${id}`,
    description: 'danse', licence: provider === 'unsplash' ? 'Unsplash License' : 'Pexels License',
    attribution: 'x',
  };
}
const retenu = (provider: 'pexels' | 'unsplash', type: 'video' | 'photo', id: string, url?: string): MediaStockRetenu => ({
  url: url ?? (type === 'video' ? IMPORTE(id) : `https://images.${provider}.com/${id}/full.jpg`),
  type, provider, providerAssetId: id, auteur: `Auteur ${id}`, sourceUrl: `https://www.${provider}.com/${type}/${id}/`,
  licence: provider === 'unsplash' ? 'Unsplash License' : 'Pexels License', vignetteUrl: `https://cdn.${provider}.test/${id}/thumb.jpg`,
});
const sourcesCfg = (p: { actives?: Partial<ConfigSources['actives']>; stock?: MediaStockRetenu[] } = {}): ConfigSources => ({
  actives: { rushes: true, avatar: false, stock: false, ...(p.actives ?? {}) },
  stock: p.stock ?? [],
  gabarit: [],
});

const JUMEAU_PRET = {
  pret: true, motif: null, message: null, moteurDisponible: true, messageMoteur: null,
  jumeau: { avatar: { id: 'av1', version: 2, nom: 'Moi', valideLe: '2026-10-01', fournisseur: 'heygen' }, voix: { id: 'v1', nom: 'Ma voix' }, prononciations: 0 },
};
const AVATARS = { avatars: [{ id: 'av1', nom: 'Moi', parDefaut: true, utilisable: true, type: 'photo', versionActive: { id: 'ver-1', version: 2, source: true, type: 'photo' } }] };

let configServeur: AutopilotConfig;
let brut: string[];
let verif: Record<string, boolean>;

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* */ }
  configServeur = { ...DEFAULT_CONFIG, topics: ['yoga'], rushUrls: [] };
  brut = [];
  verif = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/creer/jumeau')) return { ok: true, json: async () => ({ success: true, data: JUMEAU_PRET }) };
    if (u.startsWith('/api/avatars')) return { ok: true, json: async () => ({ success: true, data: AVATARS }) };
    if (u.startsWith('/api/stock/importer')) {
      const c = JSON.parse(String(init?.body)) as { provider: 'pexels' | 'unsplash'; type: 'video' | 'photo'; providerAssetId: string };
      const rendue = c.provider === 'unsplash' ? HOTLINK(c.providerAssetId) : IMPORTE(c.providerAssetId);
      return { ok: true, json: async () => ({ success: true, url: rendue, importe: c.type === 'video', media: media(c.provider, c.type, c.providerAssetId) }) };
    }
    if (u.startsWith('/api/stock/recherche')) {
      const type = new URL(u, 'http://x').searchParams.get('type');
      const medias = type === 'photo'
        ? [media('pexels', 'photo', 'PH1'), media('unsplash', 'photo', 'U1')]
        : [media('pexels', 'video', 'V1'), media('pexels', 'video', 'V2'), media('pexels', 'video', 'V3')];
      return { ok: true, json: async () => ({ success: true, medias, echecs: [] }) };
    }
    if (u.startsWith('/api/voice/clone')) return { ok: true, json: async () => ({ success: true, voices: [] }) };
    if (u.startsWith('/api/autopilot/rush/verifier')) {
      const corps = JSON.parse(String(init?.body ?? '{}')) as { urls?: string[] };
      const rep: Record<string, boolean> = {};
      for (const x of corps.urls ?? []) if (x in verif) rep[x] = verif[x];
      return { ok: true, json: async () => ({ success: true, resultats: rep, refusees: [] }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        brut.push(String(init.body));
        configServeur = sanitizeConfig(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ success: true, config: configServeur, jumeauReady: true }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, jumeauReady: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ouvrir() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
  await waitFor(() => expect(document.querySelector('[data-autopilot-sources]')).toBeTruthy());
  await waitFor(() => expect(document.querySelector('[data-avatar-pret="oui"]')).toBeTruthy());
}
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;

/**
 * Le texte PRINCIPAL d'un élément : son texte, ses `aria-label`, `alt` et
 * `placeholder` — sans les éléments de crédit. (Le `title` peut porter un
 * nom de fichier technique : c'est sa place.)
 */
function textePrincipal(racine: Element): string {
  const copie = racine.cloneNode(true) as Element;
  copie.querySelectorAll('[data-credit-media]').forEach((e) => e.remove());
  const attrs = Array.from(copie.querySelectorAll('[aria-label], [alt], [placeholder]'))
    .flatMap((e) => ['aria-label', 'alt', 'placeholder'].map((a) => e.getAttribute(a) ?? ''));
  return [copie.textContent ?? '', ...attrs].join(' ');
}

async function lancerRecherche() {
  const zone = q('[data-autopilot-stock-recherche="general"]')!;
  fireEvent.click(zone.querySelector('[data-autopilot-stock-lancer="general"]')!);
  await waitFor(() => expect(zone.querySelectorAll('[data-autopilot-stock-resultat]').length).toBeGreaterThan(0));
  return zone;
}

describe('Aucun fournisseur à l’écran, quelle que soit la combinaison de sources', () => {
  const STOCK = [retenu('pexels', 'video', 'V9'), retenu('pexels', 'photo', 'PH9'), retenu('unsplash', 'photo', 'U9', HOTLINK('U9'))];
  const COMBINAISONS: Array<[string, Partial<AutopilotConfig>]> = [
    ['aucune source', {}],
    ['rushes seuls', { rushUrls: [A, B] }],
    ['avatar seul', { jumeauAvatar: true }],
    ['médias suggérés seuls', { designStyle: { sources: sourcesCfg({ actives: { stock: true }, stock: STOCK }) } }],
    ['rushes + médias suggérés (propositions par plan)', { rushUrls: [A, IMPORTE('V9')], designStyle: { sources: sourcesCfg({ actives: { stock: true }, stock: STOCK }) } }],
    ['tout actif', { rushUrls: [A, IMPORTE('V9')], jumeauAvatar: true, designStyle: { sources: sourcesCfg({ actives: { avatar: true, stock: true }, stock: STOCK }) } }],
  ];

  it.each(COMBINAISONS)('%s', async (_nom, patch) => {
    configServeur = { ...configServeur, ...patch };
    await ouvrir();
    const panneau = q('[data-autopilot-panel]') ?? document.body;
    // Laisser les propositions par plan arriver quand le stock est actif.
    if (q('[data-autopilot-stock-source]')) {
      await waitFor(() => expect(q('[data-autopilot-stock-slot] [data-carte-media], [data-autopilot-stock-suffisant]')).toBeTruthy());
      const zone = await lancerRecherche();
      // Le crédit collectif reste, discret, et c'est un élément de crédit.
      expect(zone.querySelector('[data-autopilot-stock-credit]')!.textContent).toBe(CREDIT_FOURNISSEURS);
      expect(zone.querySelector('[data-autopilot-stock-credit]')!.hasAttribute('data-credit-media')).toBe(true);
    }
    const t = textePrincipal(panneau);
    expect(t).not.toMatch(NOMS_FOURNISSEURS);
    expect(t).not.toMatch(/\bstock\b/i);
    expect(t).not.toMatch(/\.(mp4|jpg)\b/i);
    // Les sources s'appellent comme le produit les nomme.
    const sources = q('[data-autopilot-sources]')!.textContent!;
    expect(sources).toContain('Mes rushes');
    expect(sources).toContain('Mon avatar');
    expect(sources).toContain('Médias suggérés');
    expect(sources).toContain('Studiio recherche automatiquement des images et vidéos adaptées à votre contenu.');
  });

  it('l’aperçu ouvert ne nomme la plateforme que dans « Informations du média »', async () => {
    configServeur = { ...configServeur, designStyle: { sources: sourcesCfg({ actives: { stock: true }, stock: STOCK }) } };
    await ouvrir();
    fireEvent.click(q('[data-autopilot-stock-retenu="unsplash-photo-U9"] [data-carte-apercu]')!);
    const fenetre = q('[role="dialog"]')!;
    expect(textePrincipal(fenetre)).not.toMatch(NOMS_FOURNISSEURS);
    // Le lien de crédit n'existe qu'après un clic explicite.
    expect(fenetre.querySelector('a')).toBeNull();
    fireEvent.click(fenetre.querySelector('[data-carte-informations]')!);
    expect(fenetre.querySelector('[data-carte-credit]')!.textContent).toContain('Photo de Auteur U9 sur Unsplash');
    const lien = fenetre.querySelector('a') as HTMLAnchorElement;
    expect(lien.href).toBe('https://www.unsplash.com/photo/U9/');
    expect(lien.rel).toContain('noopener');
    expect(lien.closest('[data-credit-media]')).toBeTruthy();
  });
});

describe('Résumé « Médias prévus » sans répartition par plateforme', () => {
  it('Avatar : OUI · Rushes personnels : 1 · Vidéos suggérées : 1 · Photos suggérées : 2', async () => {
    configServeur = {
      ...configServeur, jumeauAvatar: true, rushUrls: [A, IMPORTE('V9')],
      designStyle: { sources: sourcesCfg({ actives: { avatar: true, stock: true }, stock: [retenu('pexels', 'video', 'V9'), retenu('pexels', 'photo', 'PH9'), retenu('unsplash', 'photo', 'U9')] }) },
    };
    await ouvrir();
    await waitFor(() => expect(q('[data-autopilot-medias-avatar="oui"]')).toBeTruthy());
    const dl = q('[data-autopilot-medias-prevus] dl')!.textContent!;
    expect(dl).toContain('Avatar :OUI');
    expect(dl).toContain('Rushes personnels :1');
    expect(dl).toContain('Vidéos suggérées :1');
    expect(dl).toContain('Photos suggérées :2');
    expect(dl).not.toMatch(NOMS_FOURNISSEURS);
  });

  it('mediasSuggeres additionne les photos de toutes les plateformes', () => {
    expect(mediasSuggeres({ pexelsVideos: 3, pexelsPhotos: 1, unsplashPhotos: 2 })).toEqual({ videos: 3, photos: 3 });
  });
});

describe('Banque de rushes en cartes', () => {
  it('libellé, actions, nom technique seulement en title, badge « expiré » conservé', async () => {
    configServeur = { ...configServeur, rushUrls: [A, DEAD, IMPORTE('V9')], designStyle: { sources: sourcesCfg({ actives: { stock: true }, stock: [retenu('pexels', 'video', 'V9')] }) } };
    verif = { [A]: true, [DEAD]: false, [IMPORTE('V9')]: true };
    await ouvrir();
    const carte = (url: string) => q(`[data-autopilot-rush="${url}"] [data-carte-media]`)!;
    expect(carte(A).querySelector('[data-carte-libelle]')!.textContent).toBe('Rush personnel');
    expect(carte(A).getAttribute('title')).toBe('a.mp4');
    expect(carte(IMPORTE('V9')).querySelector('[data-carte-libelle]')!.textContent).toBe('Vidéo suggérée');
    // Un nom qui trahit le fournisseur n'apparaît pas, même au survol.
    expect(carte(IMPORTE('V9')).getAttribute('title')).toBeNull();
    // Première image : une MINIATURE extraite une fois et gardée en cache
    // (`useVignetteVideo`) — plus de `<video>` qui retélécharge le rush.
    expect(carte(A).querySelector('[data-carte-miniature]')).toBeTruthy();
    expect(carte(A).querySelector('video')).toBeNull();
    // Expiré : toujours visible, sur la carte.
    await waitFor(() => expect(carte(DEAD).querySelector(`[data-autopilot-rush-expire="${DEAD}"]`)).toBeTruthy());
    expect(carte(DEAD).textContent).toContain('Expiré');
    expect(carte(A).querySelector(`[data-autopilot-rush-accessible="${A}"]`)).toBeTruthy();
    expect(q('[data-autopilot-rush-expire-lot]')).toBeTruthy();
    // Actions : Aperçu + Supprimer (icône + texte).
    for (const c of [carte(A), carte(DEAD)]) {
      expect(c.querySelector('[data-carte-apercu]')!.textContent).toContain('Aperçu');
      expect(c.querySelector('[aria-label="Supprimer ce rush"]')!.textContent).toContain('Supprimer');
      expect(c.querySelector('[aria-label="Supprimer ce rush"] svg')).toBeTruthy();
    }
  });
});

describe('CarteMedia', () => {
  it('rend libellé, durée « 0:12 », actions ; durée lue par l extraction de la miniature', async () => {
    vignettesPourTests.reinitialiser();
    vignettesPourTests.desactiverPersistance();
    vignettesPourTests.definirExtracteur(async () => ({ url: 'blob:v', ratio: 9 / 16, duree: 7.4 }));
    const supprimer = vi.fn();
    render(
      <ul>
        <li><CarteMedia url="https://x.test/v.mp4" type="video" origine="rush" nomTechnique="v.mp4" actions={[{ cle: 's', libelle: 'Supprimer', icone: Trash2, onClick: supprimer }]} /></li>
        <li><CarteMedia url="https://x.test/p.mp4" type="video" origine="video-suggeree" vignetteUrl="https://x.test/p.jpg" dureeSecondes={12} metadonnees={false} /></li>
        <li><CarteMedia url="https://x.test/i.jpg" type="photo" origine="photo-suggeree" /></li>
        <li><CarteMedia url="https://x.test/m.mp4" type="video" origine="mediatheque" dureeSecondes={75} /></li>
        <li><CarteMedia url="https://x.test/g.jpg" type="photo" origine="ia" /></li>
      </ul>,
    );
    const cartes = Array.from(document.querySelectorAll('[data-carte-media]')) as HTMLElement[];
    expect(cartes.map((c) => c.querySelector('[data-carte-libelle]')!.textContent))
      .toEqual(['Rush personnel', 'Vidéo suggérée', 'Photo suggérée', 'Ma médiathèque', 'Généré avec l’IA']);
    expect(cartes[1].querySelector('[data-carte-duree]')!.textContent).toBe('0:12');
    expect(cartes[3].querySelector('[data-carte-duree]')!.textContent).toBe('1:15');
    // Une proposition distante : rien n'est téléchargé (vignette seulement).
    expect(cartes[1].querySelector('video')).toBeNull();
    // Vidéo sans durée connue : la durée vient de l'extraction de la miniature.
    await waitFor(() => expect(cartes[0].querySelector('[data-carte-duree]')?.textContent).toBe('0:07'));
    expect(cartes[0].querySelector('video')).toBeNull();
    vignettesPourTests.reinitialiser();
    expect(cartes[0].getAttribute('title')).toBe('v.mp4');
    fireEvent.click(cartes[0].querySelector('button[aria-label="Aperçu — Rush personnel"][data-carte-apercu]') ?? cartes[0].querySelector('[data-carte-apercu]')!);
    fireEvent.click(screen.getByLabelText('Fermer l’aperçu'));
    fireEvent.click(screen.getByText('Supprimer'));
    expect(supprimer).toHaveBeenCalledTimes(1);
    expect(dureeLisible(0)).toBe('');
  });

  it('« Aperçu » ouvre un lecteur dans la page : muet, Lecture / Pause, cover — aucune navigation', () => {
    const ouvrirFenetre = vi.spyOn(window, 'open').mockImplementation(() => null);
    const avant = window.location.href;
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
    render(<CarteMedia url="https://x.test/v.mp4" type="video" origine="video-suggeree" vignetteUrl="https://x.test/v.jpg" dureeSecondes={9}
      credit={{ texte: 'Vidéo de X sur Pexels', lien: 'https://www.pexels.com/video/1/' }} />);
    const carte = q('[data-carte-media]')!;
    expect(carte.querySelector('a')).toBeNull();
    // Clic sur la vignette = aperçu.
    fireEvent.click(carte.querySelector('[data-carte-vignette]')!);
    const fenetre = screen.getByRole('dialog');
    const video = fenetre.querySelector('video') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(video.className).toContain('object-cover');
    expect(video.getAttribute('src')).toBe('https://x.test/v.mp4');
    expect(play).toHaveBeenCalled();
    fireEvent.click(fenetre.querySelector('[data-carte-apercu-lecture]')!);
    expect(pause).toHaveBeenCalled();
    expect(fenetre.querySelector('[data-carte-apercu-lecture]')!.textContent).toContain('Lecture');
    // Échap ferme.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Le bouton « Aperçu » rouvre.
    fireEvent.click(carte.querySelector('[data-carte-apercu]')!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(ouvrirFenetre).not.toHaveBeenCalled();
    expect(window.location.href).toBe(avant);
  });
});

describe('Recherche de médias (Autopilote)', () => {
  beforeEach(() => {
    configServeur = { ...configServeur, rushUrls: [A], designStyle: { sources: sourcesCfg({ actives: { stock: true } }) } };
  });

  it('filtre Tout / Vidéos / Photos, champ « Que recherchez-vous ? », cartes Aperçu / Ajouter → Ajouté, sans window.open', async () => {
    const ouvrirFenetre = vi.spyOn(window, 'open').mockImplementation(() => null);
    await ouvrir();
    const zone = q('[data-autopilot-stock-recherche="general"]')!;
    expect(Array.from(zone.querySelectorAll('[data-autopilot-stock-mode]')).map((b) => b.textContent)).toEqual(['Tout', 'Vidéos', 'Photos']);
    expect(zone.querySelector('[data-autopilot-stock-mode="tout"]')!.getAttribute('aria-pressed')).toBe('true');
    expect((zone.querySelector('[data-autopilot-stock-requete="general"]') as HTMLInputElement).placeholder).toBe('Que recherchez-vous ?');
    await lancerRecherche();
    // « Tout » : vidéos et photos entrelacées.
    const libelles = Array.from(zone.querySelectorAll('[data-autopilot-stock-resultat] [data-carte-libelle]')).map((e) => e.textContent);
    expect(libelles.slice(0, 4)).toEqual(['Vidéo suggérée', 'Photo suggérée', 'Vidéo suggérée', 'Photo suggérée']);
    expect(zone.querySelector('[data-autopilot-stock-resultat="pexels-video-V1"] [data-carte-duree]')!.textContent).toBe('0:12');
    expect(zone.querySelector('a')).toBeNull();
    // Clic sur une carte = aperçu dans la page.
    fireEvent.click(zone.querySelector('[data-autopilot-stock-resultat="unsplash-photo-U1"] [data-carte-vignette]')!);
    expect(screen.getByRole('dialog').querySelector('img')!.getAttribute('src')).toBe('https://cdn.unsplash.test/U1/apercu.jpg');
    fireEvent.click(screen.getByLabelText('Fermer l’aperçu'));
    // Ajouter → Ajouté.
    fireEvent.click(zone.querySelector('[data-autopilot-stock-retenir="unsplash-photo-U1"]')!);
    await waitFor(() => expect(zone.querySelector('[data-autopilot-stock-ajoute="unsplash-photo-U1"]')).toBeTruthy());
    expect(zone.querySelector('[data-autopilot-stock-ajoute="unsplash-photo-U1"]')!.textContent).toContain('Ajouté');
    // Filtre Photos : une seule recherche, photo.
    fireEvent.click(zone.querySelector('[data-autopilot-stock-mode="photo"]')!);
    await lancerRecherche();
    expect(Array.from(zone.querySelectorAll('[data-autopilot-stock-resultat] [data-carte-libelle]')).every((e) => e.textContent === 'Photo suggérée')).toBe(true);
    expect(ouvrirFenetre).not.toHaveBeenCalled();
  });
});

describe('Éditeur du plan', () => {
  it('libellés produit, boutons icône + texte, Remplacer passe au média suivant (même donnée que la liste)', async () => {
    const stock = [retenu('unsplash', 'photo', 'U1', HOTLINK('U1')), retenu('pexels', 'photo', 'PH1')];
    configServeur = { ...configServeur, jumeauAvatar: true, rushUrls: [A, B], designStyle: { sources: sourcesCfg({ actives: { avatar: true, stock: true }, stock }) } };
    await ouvrir();
    await waitFor(() => expect(document.querySelectorAll('[data-plan-ligne]').length).toBe(5));
    const libelles = Array.from(document.querySelectorAll('[data-plan-libelle]')).map((e) => e.textContent);
    expect(libelles).toEqual(['Mon avatar', 'Mes rushes', 'Mes rushes', 'Média suggéré', 'Mon avatar']);
    expect(Array.from((q('[data-plan-forcer="0"]') as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Auto', 'Mon avatar', 'Mes rushes', 'Média suggéré']);
    const ligne = q('[data-plan-ligne="3"]')!;
    for (const [sel, texte] of [['[data-plan-rechercher="3"]', 'Rechercher'], ['[data-plan-remplacer="3"]', 'Remplacer'], ['[data-plan-supprimer="3"]', 'Supprimer']] as const) {
      const b = ligne.querySelector(sel)!;
      expect(b.textContent).toContain(texte);
      expect(b.querySelector('svg')).toBeTruthy();
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('title')).toBeTruthy();
    }
    expect(ligne.textContent).toContain('Déplacer');
    expect(ligne.querySelector('[data-plan-monter="3"]')!.getAttribute('aria-label')).toBe('Déplacer la séquence 4 vers le haut');
    expect(Array.from((q('[data-plan-media="3"]') as HTMLSelectElement).options).map((o) => o.text)).toEqual(['Au choix à chaque montage', 'Photo suggérée 1', 'Photo suggérée 2']);
    // Remplacer = le geste de la liste « média » : même gabarit enregistré.
    fireEvent.click(q('[data-plan-remplacer="3"]')!);
    await waitFor(() => expect(brut.length).toBe(1));
    const g = (JSON.parse(brut[0]) as AutopilotConfig).designStyle.sources!.gabarit;
    expect(g[3]).toEqual({ id: 's4', type: 'stock', media: HOTLINK('U1') });
    await waitFor(() => expect(q('[data-plan-ligne="3"] [data-plan-libelle]')!.textContent).toBe('Photo suggérée'));
    expect(textePrincipal(q('[data-autopilot-plan]')!)).not.toMatch(NOMS_FOURNISSEURS);
  });
});

describe('Données persistées inchangées', () => {
  it('mêmes gestes, mêmes PUT qu’avant (au caractère près)', async () => {
    const STOCK = [retenu('pexels', 'video', 'V9'), retenu('unsplash', 'photo', 'U9', HOTLINK('U9'))];
    const depart: AutopilotConfig = { ...configServeur, rushUrls: [A, B, IMPORTE('V9')], designStyle: { sources: sourcesCfg({ actives: { stock: true }, stock: STOCK }) } };
    configServeur = depart;
    await ouvrir();
    const base = sanitizeConfig(depart);

    // 1. Supprimer un rush depuis sa carte : seule la banque change.
    fireEvent.click(q(`[data-autopilot-rush="${B}"] [aria-label="Supprimer ce rush"]`)!);
    await waitFor(() => expect(brut.length).toBe(1));
    const apres1 = sanitizeConfig({ ...base, rushUrls: [A, IMPORTE('V9')] });
    expect(brut[0]).toBe(JSON.stringify(apres1));

    // 2. Supprimer un média suggéré retenu : sources.stock ET la banque (vidéo).
    await waitFor(() => expect(q('[data-autopilot-stock-retirer="pexels-video-V9"]')).toBeTruthy());
    fireEvent.click(q('[data-autopilot-stock-retirer="pexels-video-V9"]')!);
    await waitFor(() => expect(brut.length).toBe(2));
    const apres2 = sanitizeConfig({ ...apres1, rushUrls: [A], designStyle: { ...apres1.designStyle, sources: { ...apres1.designStyle.sources!, stock: [STOCK[1]] } } });
    expect(brut[1]).toBe(JSON.stringify(apres2));

    // 3. Décocher « Médias suggérés » : sources.actives.stock = false, rien d'autre.
    fireEvent.click(q('[data-autopilot-completer-stock]')!);
    await waitFor(() => expect(brut.length).toBe(3));
    const apres3 = sanitizeConfig({ ...apres2, designStyle: { ...apres2.designStyle, sources: { ...apres2.designStyle.sources!, actives: { rushes: true, avatar: false, stock: false } } } });
    expect(brut[2]).toBe(JSON.stringify(apres3));
  });
});
