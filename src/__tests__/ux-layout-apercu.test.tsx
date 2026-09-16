import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * UNE SEULE RÈGLE DE MISE EN PAGE pour les écrans « travail à gauche, aperçu à
 * droite » : Créer une vidéo (référence), le choix « Créer du contenu »,
 * l'Autopilote et Mon avatar.
 *
 * ⚠️ LE SYMPTÔME : sur desktop, l'aperçu vertical (9:16) de la colonne droite
 * est COUPÉ EN HAUT sur l'écran de choix et sur l'Autopilote, alors que
 * « Créer une vidéo » et « Mon avatar » s'affichent entiers. Les quatre
 * écrans partagent pourtant la même intention : une grille
 * `grid grid-cols-1 lg:grid-cols-5 gap-6 items-start`, une colonne de
 * travail `lg:col-span-3` AVANT une colonne d'aperçu
 * `lg:col-span-2 lg:sticky lg:top-20`.
 *
 * Ces tests sont STRUCTURELS (jsdom n'a pas de moteur de mise en page) : ils
 * lisent le DOM réellement rendu par chaque écran et vérifient les classes et
 * les styles en ligne qui, à eux seuls, produisent ou interdisent le rognage.
 * Ils ne décrivent aucune implémentation : un composant partagé ou des classes
 * recopiées à l'identique les satisfont pareillement.
 *
 * Ce qu'ils spécifient :
 *   1. chaque écran rend `[data-colonnes]` (grille) avec `[data-colonne="travail"]`
 *      AVANT `[data-colonne="apercu"]` — Mon avatar peut garder ses alias
 *      `data-avatar-colonnes` / `data-avatar-colonne="etape"|"apercu"` ;
 *   2. sur la colonne d'aperçu et ses ancêtres : ni rognage (`overflow-hidden`),
 *      ni hauteur d'écran (`h-screen`, `max-h-[calc(100vh…`), ni centrage
 *      vertical (`items-center`, `self-center`, `justify-center`), ni décalage
 *      négatif (`-mt-*`, `-translate-y-*`) — en classe COMME en style en ligne ;
 *   3. le cadre 9:16 n'est pas borné en `vh` et rien entre la colonne et lui ne
 *      rogne ni ne borne la hauteur à l'écran ;
 *   4. aucune largeur fixe > 390 px sur la chaîne des colonnes ;
 *   5. l'empilement mobile suit l'ordre DOM (aucun `order-*`) ;
 *   6. les classes de grille et de colonnes sont IDENTIQUES d'un écran à l'autre.
 *
 * Tant que les hooks `data-colonnes` / `data-colonne` manquent, les tests 2 à 6
 * retrouvent la grille par ses classes (`lg:grid-cols-5`, `lg:col-span-*`) :
 * ils mesurent donc DÈS AUJOURD'HUI le rognage réel, et le test 1 dit, seul,
 * que le hook manque.
 */

// jsdom ne connaît pas `ResizeObserver`, dont l'aperçu se sert pour mesurer
// son plateau. Un double inerte suffit : l'échelle ne concerne pas ces tests.
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
// Mon avatar : l'enregistreur vocal et le panneau « Ma voix » sont hors sujet.
vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));
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
// Le wizard lit la configuration de l'Autopilote et cherche une affiche ;
// Mon avatar lit l'état de l'avatar. Aucun appel ne doit faire échouer un
// test de mise en page.
function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body } as unknown as Response);
    if (u.startsWith('/api/pexels')) return json({ success: true, photos: [] });
    if (u.startsWith('/api/autopilot/config')) {
      return json({ success: true, ready: true, brandingReady: true, styleReady: true, config: DEFAULT_CONFIG });
    }
    if (u === '/api/avatar/create' && (init?.method ?? 'GET') === 'GET') {
      return json({ success: true, data: { avatar: null, voices: [], defaultVoiceId: null, didVideoActif: true, nomProfil: 'Test' } });
    }
    if (u.startsWith('/api/avatar')) return json({ success: true, data: { generations: [], apercu: { statut: 'aucun' } } });
    return json({ ok: true, success: true, sessions: [], luts: [], items: [] });
  }));
}

beforeEach(() => {
  // ⚠️ Le wizard enregistre son brouillon : sans ce nettoyage, un test repart
  // dans l'état où le précédent s'est arrêté (déjà démarré, sans écran de choix).
  window.localStorage.clear();
  stubApi();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ── Lecture du DOM ───────────────────────────────────────────────────────
const q = (sel: string, root: ParentNode = document) => root.querySelector<HTMLElement>(sel);
const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const precede = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const tourner = async (n = 4) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); };

/** LA règle, telle que « Créer une vidéo » la rend aujourd'hui (référence). */
const REGLE = {
  grille: ['grid', 'grid-cols-1', 'lg:grid-cols-5', 'gap-6', 'items-start'],
  travail: ['lg:col-span-3'],
  apercu: ['lg:col-span-2', 'lg:sticky', 'lg:top-20'],
};

/** Hooks attendus (Mon avatar peut garder ses alias déjà testés ailleurs). */
const SEL = {
  grille: '[data-colonnes], [data-avatar-colonnes]',
  travail: '[data-colonne="travail"], [data-avatar-colonne="etape"]',
  apercu: '[data-colonne="apercu"], [data-avatar-colonne="apercu"]',
};

/** La grille : par son hook, sinon (repli tant que le hook manque) par ses classes. */
function grille(): HTMLElement {
  const parHook = q(SEL.grille);
  if (parHook) return parHook;
  const parClasse = [...document.querySelectorAll<HTMLElement>('*')].find((e) => tokens(e).includes('lg:grid-cols-5'));
  if (!parClasse) throw new Error('Aucune grille deux colonnes (ni [data-colonnes], ni lg:grid-cols-5) dans cet écran.');
  return parClasse;
}
/** Une colonne, ENFANT DIRECT de la grille : par son hook, sinon par son `lg:col-span-*`. */
function colonne(g: HTMLElement, role: 'travail' | 'apercu'): HTMLElement {
  const enfants = [...g.children] as HTMLElement[];
  const parHook = enfants.find((c) => c.matches(SEL[role]));
  if (parHook) return parHook;
  const span = role === 'travail' ? 'lg:col-span-3' : 'lg:col-span-2';
  const parClasse = enfants.find((c) => tokens(c).includes(span));
  if (!parClasse) throw new Error(`Aucune colonne « ${role} » (ni hook, ni ${span}) sous la grille.`);
  return parClasse;
}
/** L'élément et ses ancêtres, jusqu'au conteneur de rendu (exclu). */
function chaine(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let e: HTMLElement | null = el; e && e !== document.body; e = e.parentElement) out.push(e);
  return out;
}
/** Les éléments STRICTEMENT entre `ancetre` et `descendant`. */
function entre(ancetre: HTMLElement, descendant: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (let e = descendant.parentElement; e && e !== ancetre; e = e.parentElement) out.push(e);
  return out;
}
/**
 * Le cadre d'aperçu : `[data-cadre-apercu]` s'il existe, sinon le premier
 * élément qui porte un ratio (style `aspectRatio` — jamais une classe
 * arbitraire, purgée en production — ou `aspect-*`), sinon la `ZoneApercu`.
 */
function cadre(colApercu: HTMLElement): HTMLElement {
  const parHook = q('[data-cadre-apercu]', colApercu);
  if (parHook) return parHook;
  const parRatio = [...colApercu.querySelectorAll<HTMLElement>('*')].find((e) => e.style.aspectRatio || tokens(e).some((t) => /^aspect-/.test(t)));
  if (parRatio) return parRatio;
  const zone = q('[data-apercu]', colApercu);
  if (!zone) throw new Error('Aucun cadre d’aperçu (ratio ou [data-apercu]) dans la colonne d’aperçu.');
  return zone;
}
const decrire = (el: HTMLElement) => `<${el.tagName.toLowerCase()}${[...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => ` ${a.name}`).join('')} class="${el.className}"${el.getAttribute('style') ? ` style="${el.getAttribute('style')}"` : ''}>`;

// ── Les classes et styles qui rognent ────────────────────────────────────
const PREFIXE = '(?:(?:sm|md|lg|xl|2xl):)?';
/** Rogne, borne à l'écran, centre verticalement ou décale vers le haut. */
const CLASSES_ROGNANTES = new RegExp(`^${PREFIXE}(overflow-hidden|overflow-clip|overflow-y-hidden|h-screen|max-h-screen|h-\\[calc\\(100vh|max-h-\\[calc\\(100vh|h-\\[\\d+(?:d|s|l)?vh\\]|max-h-\\[\\d+(?:d|s|l)?vh\\]|items-center|self-center|justify-center|-mt-|-translate-y-)`);
/** Borne la hauteur à l'écran (classe) — pour le cadre et ses intermédiaires. */
const CLASSES_HAUTEUR_ECRAN = new RegExp(`^${PREFIXE}(h-screen|max-h-screen|(?:max-)?h-\\[calc\\(100vh|(?:max-)?h-\\[\\d+(?:d|s|l)?vh\\])`);
const CLASSES_OVERFLOW_HIDDEN = new RegExp(`^${PREFIXE}overflow-(hidden|clip|y-hidden)$`);
const CLASSES_LARGEUR_FIXE = new RegExp(`^${PREFIXE}(?:min-)?w-\\[(\\d+)px\\]$`);
const CLASSES_ORDRE = new RegExp(`^${PREFIXE}order-`);
const enVh = (v: string) => /\d(?:d|s|l)?vh\b/.test(v);
const pxSuperieurA = (v: string, max: number) => { const m = /^(\d+(?:\.\d+)?)px$/.exec(v.trim()); return !!m && Number(m[1]) > max; };

/** Ce que l'élément porte de rognant, en classe ET en style en ligne (vide = rien). */
function rognant(el: HTMLElement): string[] {
  const fautes = tokens(el).filter((t) => CLASSES_ROGNANTES.test(t));
  const s = el.style;
  if (/hidden|clip/.test(s.overflow) || /hidden|clip/.test(s.overflowY)) fautes.push(`style.overflow=${s.overflow || s.overflowY}`);
  if (enVh(s.height)) fautes.push(`style.height=${s.height}`);
  if (enVh(s.maxHeight)) fautes.push(`style.maxHeight=${s.maxHeight}`);
  if (s.marginTop.startsWith('-')) fautes.push(`style.marginTop=${s.marginTop}`);
  if (/translateY\(\s*-/.test(s.transform)) fautes.push(`style.transform=${s.transform}`);
  if (s.alignItems === 'center' || s.alignSelf === 'center' || s.justifyContent === 'center') fautes.push('style.*=center');
  return fautes;
}
function borneHauteurEcran(el: HTMLElement): string[] {
  const fautes = tokens(el).filter((t) => CLASSES_HAUTEUR_ECRAN.test(t));
  if (enVh(el.style.height)) fautes.push(`style.height=${el.style.height}`);
  if (enVh(el.style.maxHeight)) fautes.push(`style.maxHeight=${el.style.maxHeight}`);
  return fautes;
}
function rogneDebordement(el: HTMLElement): boolean {
  return tokens(el).some((t) => CLASSES_OVERFLOW_HIDDEN.test(t)) || /hidden|clip/.test(el.style.overflow) || /hidden|clip/.test(el.style.overflowY);
}
function largeurFixe(el: HTMLElement): string[] {
  const fautes = tokens(el).filter((t) => { const m = CLASSES_LARGEUR_FIXE.exec(t); return !!m && Number(m[1]) > 390; });
  if (pxSuperieurA(el.style.width, 390)) fautes.push(`style.width=${el.style.width}`);
  if (pxSuperieurA(el.style.minWidth, 390)) fautes.push(`style.minWidth=${el.style.minWidth}`);
  return fautes;
}
/** Les seuls jetons qui font la mise en page des colonnes (l'aération `space-*` ne compte pas). */
const JETONS_LAYOUT = new RegExp(`^${PREFIXE}(grid|grid-cols-|col-span-|col-start-|gap-|items-|justify-|self-|sticky|static|relative|absolute|fixed|top-|bottom-|order-|overflow-|h-|max-h-|min-h-|w-|max-w-|min-w-|flex|block|hidden)`);
const jetonsLayout = (el: HTMLElement) => tokens(el).filter((t) => JETONS_LAYOUT.test(t)).sort();

// ── Les quatre écrans ────────────────────────────────────────────────────
type Ecran = { nom: string; monter: () => Promise<void> };

/** Créer du contenu (choix des parcours) : la page `/dashboard/creer` telle quelle. */
const monterChoix = async () => {
  render(<CreerPage />);
  await waitFor(() => expect(q('[data-parcours-choix]')).not.toBeNull());
  await waitFor(() => expect(q('[data-autopilot-apercu]')).not.toBeNull());
  await tourner();
};
/** Autopilote : depuis le choix, « Configurer l'Autopilote ». */
const monterAutopilote = async () => {
  await monterChoix();
  fireEvent.click(q('[data-parcours-autopilote]')!);
  await waitFor(() => expect(q('[data-parcours-autopilote-panneau]')?.hidden).toBe(false));
  await tourner();
};
/** Créer une vidéo (RÉFÉRENCE) : depuis le choix, « Créer une vidéo ». */
const monterAssistant = async () => {
  await monterChoix();
  fireEvent.click(q('[data-parcours-assistant]')!);
  await waitFor(() => expect(q('[data-apercu-vide]')).not.toBeNull());
  await tourner();
};
/** Mon avatar, sans avatar (zone d'aperçu vide). */
const monterAvatar = async () => {
  render(<AvatarPage />);
  await waitFor(() => expect(q('[data-fil-etapes]')).not.toBeNull());
  await tourner();
};

const ECRANS: Ecran[] = [
  { nom: 'Créer une vidéo (référence)', monter: monterAssistant },
  { nom: 'Créer du contenu (choix)', monter: monterChoix },
  { nom: 'Autopilote', monter: monterAutopilote },
  { nom: 'Mon avatar', monter: monterAvatar },
];

// ─────────────────────────────────────────────────────────────────────────
for (const ecran of ECRANS) {
  describe(`Écran « ${ecran.nom} »`, () => {
    it('⚠️ rend [data-colonnes] en grille commune, avec [data-colonne="travail"] (lg:col-span-3) AVANT [data-colonne="apercu"] (lg:col-span-2 lg:sticky lg:top-20)', async () => {
      await ecran.monter();
      const g = q(SEL.grille);
      expect(g, 'la grille doit porter data-colonnes (ou data-avatar-colonnes)').not.toBeNull();
      for (const t of REGLE.grille) expect(tokens(g!), `grille : classe « ${t} » attendue — ${decrire(g!)}`).toContain(t);

      const enfants = [...g!.children] as HTMLElement[];
      const travail = enfants.find((c) => c.matches(SEL.travail));
      const apercu = enfants.find((c) => c.matches(SEL.apercu));
      expect(travail, 'la colonne de travail doit être un ENFANT DIRECT de la grille, avec data-colonne="travail" (ou data-avatar-colonne="etape")').toBeDefined();
      expect(apercu, 'la colonne d’aperçu doit être un ENFANT DIRECT de la grille, avec data-colonne="apercu" (ou data-avatar-colonne="apercu")').toBeDefined();
      for (const t of REGLE.travail) expect(tokens(travail!), `colonne travail : « ${t} » — ${decrire(travail!)}`).toContain(t);
      for (const t of REGLE.apercu) expect(tokens(apercu!), `colonne aperçu : « ${t} » — ${decrire(apercu!)}`).toContain(t);
      expect(precede(travail!, apercu!), 'la colonne de travail précède l’aperçu dans le DOM (= empilement mobile)').toBe(true);
      // Le cadre d'aperçu vit DANS la colonne d'aperçu, pas ailleurs.
      expect(apercu!.contains(cadre(apercu!))).toBe(true);
    });

    it('⚠️ la chaîne de l’aperçu ne rogne pas : ni overflow-hidden, ni hauteur d’écran, ni centrage vertical, ni décalage négatif — de la colonne au conteneur de page, et de la colonne au cadre 9:16', async () => {
      await ecran.monter();
      const g = grille();
      const colApercu = colonne(g, 'apercu');

      // 2. La colonne et ses ancêtres : ce qui centre une colonne plus haute
      //    que la fenêtre, ou la borne à sa hauteur, en coupe le haut.
      const fautesChaine = chaine(colApercu).flatMap((el) => rognant(el).map((f) => `${f} sur ${decrire(el)}`));
      expect(fautesChaine, 'colonne d’aperçu et ancêtres').toEqual([]);

      // 3. Le cadre : son ratio n'est pas cassé par une borne en vh ; son
      //    parent ne le rogne pas ; rien, entre la colonne et lui, ne borne
      //    la hauteur à l'écran ni ne coupe ce qui déborde.
      const c = cadre(colApercu);
      expect(borneHauteurEcran(c), `le cadre lui-même — ${decrire(c)}`).toEqual([]);
      expect(rogneDebordement(c.parentElement!), `parent du cadre — ${decrire(c.parentElement!)}`).toBe(false);
      const fautesIntermediaires = entre(colApercu, c).flatMap((el) => [
        ...borneHauteurEcran(el).map((f) => `${f} sur ${decrire(el)}`),
        ...(rogneDebordement(el) ? [`overflow-hidden sur ${decrire(el)}`] : []),
      ]);
      expect(fautesIntermediaires, 'entre la colonne d’aperçu et le cadre').toEqual([]);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────
describe('Le fil d’étapes ne déborde pas de l’écran', () => {
  it('⚠️ chaque étape du wizard peut rétrécir (min-w-0) : mesuré au navigateur, sans lui la barre dépassait de 57 px à 390 px', async () => {
    await monterAssistant();
    const etapes = [...document.querySelectorAll<HTMLElement>('[data-step]')].map((e) => e.parentElement!);
    expect(etapes.length).toBeGreaterThan(0);
    for (const e of etapes) {
      expect(tokens(e), decrire(e)).toContain('flex-1');
      expect(tokens(e), `${decrire(e)} : un item flex sans min-w-0 refuse de rétrécir sous la largeur de son libellé`).toContain('min-w-0');
    }
    // La brique partagée suit la même règle.
    for (const li of document.querySelectorAll<HTMLElement>('[data-fil-etapes] li')) expect(tokens(li)).toContain('min-w-0');
  });
});

describe('Règle commune aux quatre écrans', () => {
  /** Monte chaque écran à son tour et relève ce qui compte. */
  async function releverTous<T>(lire: (g: HTMLElement, travail: HTMLElement, apercu: HTMLElement) => T): Promise<Array<{ nom: string; releve: T }>> {
    const releves: Array<{ nom: string; releve: T }> = [];
    for (const ecran of ECRANS) {
      cleanup(); window.localStorage.clear(); stubApi();
      await ecran.monter();
      const g = grille();
      releves.push({ nom: ecran.nom, releve: lire(g, colonne(g, 'travail'), colonne(g, 'apercu')) });
    }
    return releves;
  }

  it('⚠️ aucune largeur fixe > 390 px (w-[…px], min-w-[…px], style width/minWidth) sur la grille, les colonnes et leurs ancêtres', async () => {
    const releves = await releverTous((g, travail, apercu) =>
      [...new Set([...chaine(g), travail, apercu])].flatMap((el) => largeurFixe(el).map((f) => `${f} sur ${decrire(el)}`)));
    for (const r of releves) expect(r.releve, r.nom).toEqual([]);
  });

  it('⚠️ l’empilement mobile est l’ordre DOM : aucun order-* / lg:order-* sur les colonnes, travail avant aperçu partout', async () => {
    const releves = await releverTous((_g, travail, apercu) => ({
      ordres: [travail, apercu].flatMap((el) => tokens(el).filter((t) => CLASSES_ORDRE.test(t))),
      travailAvant: precede(travail, apercu),
    }));
    for (const r of releves) {
      expect(r.releve.ordres, `${r.nom} : classes order-*`).toEqual([]);
      expect(r.releve.travailAvant, `${r.nom} : travail avant aperçu`).toBe(true);
    }
  });

  it('⚠️ les classes de mise en page de la grille et des deux colonnes sont IDENTIQUES sur les quatre écrans (référence : Créer une vidéo)', async () => {
    const releves = await releverTous((g, travail, apercu) => ({
      grille: jetonsLayout(g), travail: jetonsLayout(travail), apercu: jetonsLayout(apercu),
    }));
    const reference = releves[0];
    expect(reference.releve.grille).toEqual([...REGLE.grille].sort());
    expect(reference.releve.apercu).toEqual([...REGLE.apercu].sort());
    for (const r of releves.slice(1)) {
      expect(r.releve, `${r.nom} ≠ ${reference.nom}`).toEqual(reference.releve);
    }
  });
});
