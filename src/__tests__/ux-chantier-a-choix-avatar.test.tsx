import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * CHANTIER A — le sélecteur de mode « Créer du contenu » et la carte
 * principale de « Mon avatar » (présentation seule, aucune logique).
 *
 * Ces tests SPÉCIFIENT l'écran, écrits AVANT l'implémentation : ils échouent
 * sur le code actuel là où le chantier n'est pas fait (attendu) et passent
 * une fois livré. Ils sont STRUCTURELS (jsdom n'a pas de moteur de mise en
 * page) : ils lisent le DOM réellement rendu, ses hooks `data-*`, ses classes
 * et ses styles en ligne — jamais des pixels.
 *
 * Ce qu'ils spécifient :
 *   A. « Créer du contenu » (choix) : les deux cartes et le lien « éditeur
 *      avancé » restent ; PLUS de colonne d'aperçu ni de vide réservé à
 *      droite ; « Créer une vidéo » et l'Autopilote GARDENT leur aperçu ;
 *      aucune requête `/api/pexels` ne part depuis le choix.
 *   B. « Mon avatar » : le fil d'étapes vit DANS la carte principale de la
 *      colonne travail ; une seule `ZoneApercu` ; la notification de la page
 *      est rendue DANS la carte principale, sous le fil ; les panneaux voix
 *      sont regroupés dans UNE section `[data-avatar-ma-voix]` rendue APRÈS
 *      les colonnes (carte → aperçu → voix), avec un seul titre « Ma voix ».
 *   C. Responsive (structure) : aucune largeur fixe > 390 px, aucun
 *      `order-*`, les jetons de grille identiques à `DeuxColonnes`.
 *
 * Hooks exigés (exhaustif) :
 *   Créer : `[data-colonnes]`, `[data-colonne="travail"|"apercu"]`,
 *     `[data-parcours-choix]`, `[data-parcours-assistant]`,
 *     `[data-parcours-autopilote]`, `[data-editeur-avance]`,
 *     `[data-parcours-autopilote-panneau]`, `[data-autopilot-apercu]`,
 *     `[data-apercu-vide]`.
 *   Mon avatar : `[data-entete] [data-entete-titre]`, `[data-entete-statut]`,
 *     `[data-avatar-colonnes]`, `[data-avatar-colonne="etape"|"apercu"]`,
 *     `[data-fil-etapes]`, `[data-apercu]`, `[data-notification]`,
 *     `[data-avatar-apercu="generer"]`, `[data-avatar-ma-voix]`,
 *     `[data-avatar-carte-principale]` (NOUVEAU — sur la carte principale ;
 *     à défaut, le `.card-base` de la colonne travail qui contient le fil),
 *     `[data-avatar-ma-voix] [data-entete-titre]` ou un `h2` unique.
 */

// jsdom ne connaît pas `ResizeObserver` (l'aperçu mesure son plateau).
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
// Le catalogue de polices déclenche des requêtes réseau : inutile ici.
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
// Mon avatar : les deux panneaux voix sont factices mais REPÉRABLES — c'est
// leur regroupement dans une seule section qui est spécifié ici.
vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => <div data-voice-recorder /> }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => <div data-ma-voix-panel /> }));
// Le routeur Next est factice : rien n'est asserté dessus.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/creer',
  useSearchParams: () => new URLSearchParams(),
}));

import CreerPage from '@/app/dashboard/creer/page';
import AvatarPage from '@/app/dashboard/avatar/page';
import { DEFAULT_CONFIG } from '@/lib/autopilot/rules';

// ── Le réseau, neutralisé ────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-000000000001';
const G = '22222222-2222-4222-8222-000000000001';

/** L'état SERVEUR de Mon avatar : la page ne montre que ce qu'il dit. */
const serveur = {
  avatar: null as Record<string, unknown> | null,
  apercu: { statut: 'aucun' } as Record<string, unknown>,
  /** POST /api/avatar/generate (aperçu HeyGen) : par défaut, la voix manque. */
  generate: { success: false, error: 'Voix indisponible', code: 'voix_indisponible' } as Record<string, unknown>,
};
const appels: Array<{ url: string; method: string }> = [];

type EtatAvatar = 'entrainement' | 'entraine_non_valide' | 'valide' | 'echec';
const STATUT_HEYGEN: Record<EtatAvatar, string> = { entrainement: 'training', entraine_non_valide: 'completed', valide: 'completed', echec: 'failed' };
const avatarHeygen = (etat: EtatAvatar, extra: Record<string, unknown> = {}) => {
  serveur.avatar = { id: A, name: 'Mon avatar', status: STATUT_HEYGEN[etat], avatar_type: 'photo', provider: 'heygen', created_at: '2026-09-16T10:00:00Z', consent_at: '2026-09-16T10:00:00Z', etat, version: 1, validated_at: etat === 'valide' ? '2026-09-16T11:00:00Z' : null, ...extra };
};

function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    appels.push({ url: u, method });
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body } as unknown as Response);
    // Créer
    if (u.startsWith('/api/pexels')) return json({ success: true, photos: [] });
    if (u.startsWith('/api/autopilot/config')) {
      return json({ success: true, ready: true, brandingReady: true, styleReady: true, config: DEFAULT_CONFIG });
    }
    // Mon avatar
    if (u === '/api/avatar/create' && method === 'GET') {
      return json({ success: true, data: { avatar: serveur.avatar, voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', didVideoActif: true, nomProfil: 'Henri Bassi' } });
    }
    if (u === '/api/avatar/generate' && method === 'POST') {
      return json(serveur.generate.success ? { success: true, data: { generationId: G } } : serveur.generate, serveur.generate.success ? 200 : 409);
    }
    if (u === '/api/avatar/apercu') return json({ success: true, data: { avatarId: A, version: 1, etat: serveur.avatar?.etat, apercu: serveur.apercu } });
    if (u.startsWith('/api/avatar/status')) return json({ success: true, data: { generationId: G, status: 'processing', videoUrl: null, error: null } });
    if (u.startsWith('/api/avatar')) return json({ success: true, data: { generations: [], apercu: serveur.apercu } });
    return json({ ok: true, success: true, sessions: [], luts: [], items: [] });
  }));
}

beforeEach(() => {
  // ⚠️ Le wizard enregistre son brouillon : sans ce nettoyage, un test repart
  // dans l'état où le précédent s'est arrêté (déjà démarré, sans écran de choix).
  window.localStorage.clear();
  appels.length = 0;
  serveur.avatar = null; serveur.apercu = { statut: 'aucun' };
  serveur.generate = { success: false, error: 'Voix indisponible', code: 'voix_indisponible' };
  stubApi();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ── Lecture du DOM ───────────────────────────────────────────────────────
const q = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
const qa = (sel: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>(sel)];
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const precede = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const tourner = async (n = 6) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); };
const decrire = (el: HTMLElement) => `<${el.tagName.toLowerCase()}${[...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => ` ${a.name}`).join('')} class="${el.className}"${el.getAttribute('style') ? ` style="${el.getAttribute('style')}"` : ''}>`;
/** L'élément et ses ancêtres, jusqu'au `body` (exclu). */
function chaine(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let e: HTMLElement | null = el; e && e !== document.body; e = e.parentElement) out.push(e);
  return out;
}
/** Les notifications DE LA PAGE avatar (hors panneau D-ID, qui garde les siennes). */
const notifsPage = () => qa('[data-notification]').filter((e) => !e.closest('[data-avatar-did]'));

/** LA règle de `DeuxColonnes` (la même que « Créer une vidéo », référence). */
const REGLE = {
  grille: ['grid', 'grid-cols-1', 'lg:grid-cols-5', 'gap-6', 'items-start'],
  travail: ['lg:col-span-3'],
  apercu: ['lg:col-span-2', 'lg:sticky', 'lg:top-20'],
};
const PREFIXE = '(?:(?:sm|md|lg|xl|2xl):)?';
const CLASSES_LARGEUR_FIXE = new RegExp(`^${PREFIXE}(?:min-)?w-\\[(\\d+)px\\]$`);
const CLASSES_ORDRE = new RegExp(`^${PREFIXE}order-`);
const pxSuperieurA = (v: string, max: number) => { const m = /^(\d+(?:\.\d+)?)px$/.exec(v.trim()); return !!m && Number(m[1]) > max; };
function largeurFixe(el: HTMLElement): string[] {
  const fautes = tokens(el).filter((t) => { const m = CLASSES_LARGEUR_FIXE.exec(t); return !!m && Number(m[1]) > 390; });
  if (pxSuperieurA(el.style.width, 390)) fautes.push(`style.width=${el.style.width}`);
  if (pxSuperieurA(el.style.minWidth, 390)) fautes.push(`style.minWidth=${el.style.minWidth}`);
  return fautes;
}
/** Les seuls jetons qui font la mise en page des colonnes (l'aération `space-*` ne compte pas). */
const JETONS_LAYOUT = new RegExp(`^${PREFIXE}(grid|grid-cols-|col-span-|col-start-|gap-|items-|justify-|self-|sticky|static|relative|absolute|fixed|top-|bottom-|order-|overflow-|h-|max-h-|min-h-|w-|max-w-|min-w-|flex|block|hidden)`);
const jetonsLayout = (el: HTMLElement) => tokens(el).filter((t) => JETONS_LAYOUT.test(t)).sort();

/** La grille d'un écran À aperçu, et ses deux colonnes, ENFANTS DIRECTS. */
function colonnes(): { grille: HTMLElement; travail: HTMLElement; apercu: HTMLElement } {
  const grille = q('[data-colonnes]');
  expect(grille, 'la grille [data-colonnes]').not.toBeNull();
  const enfants = [...grille!.children] as HTMLElement[];
  const travail = enfants.find((c) => c.matches('[data-colonne="travail"]'));
  const apercu = enfants.find((c) => c.matches('[data-colonne="apercu"]'));
  expect(travail, 'la colonne travail, ENFANT DIRECT de la grille').toBeDefined();
  expect(apercu, 'la colonne aperçu, ENFANT DIRECT de la grille').toBeDefined();
  return { grille: grille!, travail: travail!, apercu: apercu! };
}

// ── Les écrans ───────────────────────────────────────────────────────────
/** Créer du contenu (choix) : la page `/dashboard/creer` telle quelle. ⚠️ On n'attend PLUS l'aperçu de l'Autopilote : il n'y en a plus au choix. */
const monterChoix = async () => {
  render(<CreerPage />);
  await waitFor(() => expect(q('[data-parcours-choix]')).not.toBeNull());
  await tourner();
};
/** Autopilote : depuis le choix, « Configurer l'Autopilote ». */
const monterAutopilote = async () => {
  await monterChoix();
  fireEvent.click(q('[data-parcours-autopilote]')!);
  await waitFor(() => expect(q('[data-parcours-autopilote-panneau]')?.hidden).toBe(false));
  await waitFor(() => expect(q('[data-autopilot-apercu]')).not.toBeNull());
  await tourner();
};
/** Créer une vidéo (RÉFÉRENCE) : depuis le choix, « Créer une vidéo ». */
const monterAssistant = async () => {
  await monterChoix();
  fireEvent.click(q('[data-parcours-assistant]')!);
  await waitFor(() => expect(q('[data-apercu-vide]')).not.toBeNull());
  await tourner();
};
/** Mon avatar, dans l'état serveur posé avant. */
const monterAvatar = async () => {
  render(<AvatarPage />);
  await waitFor(() => expect(q('[data-fil-etapes]')).not.toBeNull());
  await tourner();
};

/**
 * La carte principale de Mon avatar : `[data-avatar-carte-principale]` si le
 * hook existe, sinon le `.card-base` de la colonne travail qui contient le fil.
 */
function cartePrincipale(): HTMLElement | null {
  const parHook = q('[data-avatar-carte-principale]');
  if (parHook) return parHook;
  const fil = q('[data-fil-etapes]');
  const carte = fil?.closest<HTMLElement>('.card-base') ?? null;
  return carte && carte.closest('[data-colonne="travail"], [data-avatar-colonne="etape"]') ? carte : null;
}
/** Le titre « Ma voix » de la section voix : `[data-entete-titre]` ou un `h2`. */
const titresMaVoix = (section: HTMLElement) =>
  [...new Set([...qa('[data-entete-titre]', section), ...qa('h2', section)])].filter((t) => /^\s*Ma voix\s*$/.test(t.textContent ?? ''));

// ─────────────────────────────────────────────────────────────────────────
describe('Créer du contenu — sélecteur de mode', () => {
  it('⚠️ les deux cartes « Créer une vidéo » et « Autopilote » et le lien « Ouvrir l’éditeur avancé » sont là, dans [data-parcours-choix]', async () => {
    await monterChoix();
    const choix = q('[data-parcours-choix]')!;
    expect(q('[data-parcours-assistant]', choix), 'le bouton « Créer une vidéo »').not.toBeNull();
    expect(q('[data-parcours-autopilote]', choix), 'le bouton « Configurer l’Autopilote »').not.toBeNull();
    expect(q('[data-editeur-avance]', choix), 'le lien vers l’éditeur avancé').not.toBeNull();
    expect(q('[data-editeur-avance] a', choix)?.textContent).toMatch(/Ouvrir l['’]éditeur avancé/);
    expect(precede(q('[data-parcours-assistant]')!, q('[data-parcours-autopilote]')!), '« Créer une vidéo » d’abord').toBe(true);
  });

  it('⚠️ le choix n’a PLUS de colonne d’aperçu : ni [data-colonne="apercu"], ni [data-autopilot-apercu], ni [data-apercu]', async () => {
    await monterChoix();
    expect(q('[data-colonne="apercu"]'), 'colonne d’aperçu').toBeNull();
    expect(q('[data-autopilot-apercu]'), 'aperçu de l’Autopilote').toBeNull();
    expect(q('[data-autopilot-apercu-cadre]'), 'cadre de l’aperçu de l’Autopilote').toBeNull();
    expect(q('[data-apercu]'), 'ZoneApercu').toBeNull();
    expect(q('[data-apercu-vide]'), 'aperçu vide de l’assistant').toBeNull();
  });

  it('⚠️ aucun vide réservé à droite : [data-parcours-choix] n’est pas dans une colonne lg:col-span-3, et aucune colonne lg:col-span-2 ne l’accompagne', async () => {
    await monterChoix();
    const choix = q('[data-parcours-choix]')!;
    const ancetresTravail = chaine(choix).filter((el) => tokens(el).includes('lg:col-span-3'));
    expect(ancetresTravail.map(decrire), 'le contenu du choix n’est plus borné à 3/5 de la grille').toEqual([]);
    // Ni une colonne sœur vide qui réserverait la place de l'aperçu.
    const grille = choix.closest<HTMLElement>('[data-colonnes]');
    if (grille) {
      const soeursApercu = ([...grille.children] as HTMLElement[]).filter((c) => tokens(c).includes('lg:col-span-2') || c.matches('[data-colonne="apercu"]'));
      expect(soeursApercu.map(decrire), 'aucune colonne d’aperçu (lg:col-span-2) à côté du choix').toEqual([]);
    }
  });

  it('⚠️ « Créer une vidéo » GARDE son aperçu : [data-apercu-vide] dans [data-colonne="apercu"], enfant direct de [data-colonnes], après la colonne travail', async () => {
    await monterAssistant();
    const { travail, apercu } = colonnes();
    expect(apercu.contains(q('[data-apercu-vide]')!), 'l’aperçu vide vit dans la colonne d’aperçu').toBe(true);
    expect(precede(travail, apercu), 'travail avant aperçu (= empilement mobile)').toBe(true);
    expect(q('[data-parcours-choix]'), 'le choix a disparu une fois le parcours pris').toBeNull();
  });

  it('⚠️ l’Autopilote GARDE son aperçu : [data-parcours-autopilote-panneau] visible dans la colonne travail, [data-autopilot-apercu] dans [data-colonne="apercu"], enfant direct de [data-colonnes]', async () => {
    await monterAutopilote();
    const { travail, apercu } = colonnes();
    const panneau = q('[data-parcours-autopilote-panneau]')!;
    expect(panneau.hidden).toBe(false);
    expect(travail.contains(panneau), 'le panneau Autopilote vit dans la colonne travail').toBe(true);
    expect(apercu.contains(q('[data-autopilot-apercu]')!), 'l’aperçu de l’Autopilote vit dans la colonne d’aperçu').toBe(true);
    expect(precede(travail, apercu)).toBe(true);
    expect(q('[data-parcours-choix]'), 'le choix a disparu une fois le parcours pris').toBeNull();
  });

  it('⚠️ aucune requête /api/pexels ne part depuis l’écran de choix (plus d’affiche d’exemple à chercher tant qu’aucun mode n’est choisi)', async () => {
    await monterChoix();
    await tourner(8);
    const pexels = appels.filter((a) => a.url.startsWith('/api/pexels'));
    expect(pexels.map((a) => a.url), 'requêtes Pexels depuis le choix').toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Mon avatar — carte principale', () => {
  it('⚠️ le fil d’étapes vit DANS la carte principale de la colonne travail ([data-avatar-carte-principale], ou le .card-base de la colonne qui le contient)', async () => {
    await monterAvatar();
    const fil = q('[data-fil-etapes]')!;
    const carte = cartePrincipale();
    expect(carte, 'une carte principale dans la colonne travail, contenant le fil').not.toBeNull();
    expect(carte!.contains(fil), `le fil est dans la carte — ${decrire(carte!)}`).toBe(true);
    const travail = q('[data-colonne="travail"], [data-avatar-colonne="etape"]')!;
    expect(travail.contains(carte!), 'la carte principale est dans la colonne travail').toBe(true);
    expect(qa('[data-fil-etapes]'), 'un seul fil').toHaveLength(1);
    // Même chose avec un avatar (étapes 2–5) : le fil ne change pas de carte.
    cleanup(); avatarHeygen('entraine_non_valide');
    await monterAvatar();
    expect(cartePrincipale()?.contains(q('[data-fil-etapes]')!), 'avec un avatar aussi').toBe(true);
  });

  it('⚠️ une seule ZoneApercu, dans la colonne d’aperçu, enfant direct de [data-avatar-colonnes] — sans avatar comme avec', async () => {
    await monterAvatar();
    expect(qa('[data-apercu]')).toHaveLength(1);
    const { apercu } = colonnes();
    expect(apercu.matches('[data-avatar-colonne="apercu"]'), 'l’alias data-avatar-colonne="apercu" est préservé').toBe(true);
    expect(apercu.contains(q('[data-apercu]')!)).toBe(true);
    cleanup(); avatarHeygen('valide');
    await monterAvatar();
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(colonnes().apercu.contains(q('[data-apercu]')!)).toBe(true);
  });

  it('⚠️ voix manquante à l’étape Aperçu : la notification de la page est rendue DANS la carte principale, sous le fil d’étapes', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' };
    await monterAvatar();
    expect(notifsPage()).toHaveLength(0);
    await act(async () => { fireEvent.click(q('[data-avatar-apercu="generer"]')!); });
    await waitFor(() => expect(notifsPage()).toHaveLength(1));
    const notif = notifsPage()[0];
    expect(notif.getAttribute('data-notification')).toBe('avertissement');
    const carte = cartePrincipale();
    expect(carte, 'la carte principale').not.toBeNull();
    expect(carte!.contains(notif), `la notification vit dans la carte principale — ${decrire(carte!)}`).toBe(true);
    expect(precede(q('[data-fil-etapes]')!, notif), 'sous le fil d’étapes').toBe(true);
    expect(carte!.contains(q('[data-fil-etapes]')!)).toBe(true);
  });

  it('⚠️ les panneaux voix sont regroupés dans UNE section [data-avatar-ma-voix] rendue APRÈS [data-colonnes], avec un seul titre « Ma voix »', async () => {
    await monterAvatar();
    const sections = qa('[data-avatar-ma-voix]');
    expect(sections, 'une seule section voix').toHaveLength(1);
    const section = sections[0];
    expect(section.contains(q('[data-voice-recorder]')!), 'l’enregistreur vocal est dans la section').toBe(true);
    expect(section.contains(q('[data-ma-voix-panel]')!), 'le panneau « Ma voix » est dans la section').toBe(true);
    expect(qa('[data-voice-recorder]')).toHaveLength(1);
    expect(qa('[data-ma-voix-panel]')).toHaveLength(1);
    const grille = q('[data-colonnes]')!;
    expect(grille.contains(section), 'la section voix n’est PAS dans les colonnes').toBe(false);
    expect(precede(grille, section), 'la section voix vient APRÈS les colonnes').toBe(true);
    expect(titresMaVoix(section), 'un seul titre « Ma voix » dans la section').toHaveLength(1);
    // Le titre de la section précède ses deux panneaux.
    expect(precede(titresMaVoix(section)[0], q('[data-voice-recorder]')!)).toBe(true);
  });

  it('⚠️ ordre DOM : carte principale → aperçu → voix ; les hooks [data-avatar-colonnes], [data-avatar-colonne], [data-entete-titre] « Mon avatar » et [data-entete-statut] sont préservés', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' };
    await monterAvatar();
    const carte = cartePrincipale()!;
    const apercu = q('[data-apercu]')!;
    const voix = q('[data-avatar-ma-voix]')!;
    expect(carte).not.toBeNull(); expect(apercu).not.toBeNull(); expect(voix).not.toBeNull();
    expect(precede(carte, apercu), 'carte principale avant aperçu').toBe(true);
    expect(precede(apercu, voix), 'aperçu avant voix').toBe(true);
    expect(carte.contains(voix), 'la voix n’est pas dans la carte principale').toBe(false);
    // Hooks préservés.
    const g = q('[data-avatar-colonnes]')!;
    expect(g).not.toBeNull();
    expect(g.matches('[data-colonnes]'), 'la grille porte aussi data-colonnes').toBe(true);
    const enfants = [...g.children] as HTMLElement[];
    expect(enfants.find((c) => c.matches('[data-avatar-colonne="etape"]')), 'colonne étape, enfant direct').toBeDefined();
    expect(enfants.find((c) => c.matches('[data-avatar-colonne="apercu"]')), 'colonne aperçu, enfant direct').toBeDefined();
    expect(q('[data-entete] [data-entete-titre]')?.textContent).toBe('Mon avatar');
    expect(q('[data-entete] [data-entete-statut]')?.textContent?.trim()).toBe('À valider');
    expect(precede(q('[data-entete]')!, carte), 'l’en-tête précède la carte').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('Responsive (structure)', () => {
  type Releve = { nom: string; elements: HTMLElement[] };
  /** Monte chaque écran à son tour et relève les éléments dont la structure compte. */
  async function releverTous(): Promise<Releve[]> {
    const releves: Releve[] = [];
    const remonter = () => { cleanup(); window.localStorage.clear(); appels.length = 0; serveur.avatar = null; serveur.apercu = { statut: 'aucun' }; stubApi(); };
    remonter(); await monterChoix();
    releves.push({ nom: 'Créer du contenu (choix)', elements: chaine(q('[data-parcours-choix]')!) });
    remonter(); await monterAssistant();
    { const { grille, travail, apercu } = colonnes(); releves.push({ nom: 'Créer une vidéo', elements: [...new Set([...chaine(grille), travail, apercu])] }); }
    remonter(); await monterAutopilote();
    { const { grille, travail, apercu } = colonnes(); releves.push({ nom: 'Autopilote', elements: [...new Set([...chaine(grille), travail, apercu])] }); }
    remonter(); await monterAvatar();
    {
      const { grille, travail, apercu } = colonnes();
      const voix = q('[data-avatar-ma-voix]');
      releves.push({ nom: 'Mon avatar', elements: [...new Set([...chaine(grille), travail, apercu, ...(voix ? chaine(voix) : [])])] });
    }
    return releves;
  }

  it('⚠️ aucune largeur fixe > 390 px (w-[…px], min-w-[…px], style width/minWidth) sur la chaîne des colonnes, du choix et de la section voix', async () => {
    for (const r of await releverTous()) {
      const fautes = r.elements.flatMap((el) => largeurFixe(el).map((f) => `${f} sur ${decrire(el)}`));
      expect(fautes, r.nom).toEqual([]);
    }
  });

  it('⚠️ l’empilement mobile est l’ordre DOM : aucun order-* / lg:order-* sur les colonnes, le choix ni la section voix', async () => {
    for (const r of await releverTous()) {
      const ordres = r.elements.flatMap((el) => tokens(el).filter((t) => CLASSES_ORDRE.test(t)).map((t) => `${t} sur ${decrire(el)}`));
      expect(ordres, r.nom).toEqual([]);
    }
  });

  it('⚠️ les jetons de grille et de colonnes sont ceux de DeuxColonnes, identiques sur les trois écrans à aperçu (Créer une vidéo, Autopilote, Mon avatar)', async () => {
    const releves: Array<{ nom: string; grille: string[]; travail: string[]; apercu: string[] }> = [];
    const remonter = () => { cleanup(); window.localStorage.clear(); appels.length = 0; serveur.avatar = null; serveur.apercu = { statut: 'aucun' }; stubApi(); };
    for (const [nom, monter] of [['Créer une vidéo', monterAssistant], ['Autopilote', monterAutopilote], ['Mon avatar', monterAvatar]] as const) {
      remonter(); await monter();
      const { grille, travail, apercu } = colonnes();
      releves.push({ nom, grille: jetonsLayout(grille), travail: jetonsLayout(travail), apercu: jetonsLayout(apercu) });
    }
    for (const r of releves) {
      expect(r.grille, `${r.nom} : grille`).toEqual([...REGLE.grille].sort());
      expect(r.travail, `${r.nom} : colonne travail`).toEqual([...REGLE.travail].sort());
      expect(r.apercu, `${r.nom} : colonne aperçu`).toEqual([...REGLE.apercu].sort());
    }
  });
});
