import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * /dashboard/avatar — STABILISATION UX de « Mon avatar » (présentation seule).
 *
 * Ces tests SPÉCIFIENT la page stabilisée. Ils ne décrivent que ce que la
 * personne voit : jamais l'implémentation.
 *
 *   1. L'offset du cadre d'aperçu (`--apercu-offset`) n'a QU'UNE source : le
 *      défaut de `.apercu-cadre` dans globals.css. Aucune page ne le pose en
 *      dur (plus de `11rem` sur Mon avatar, rien dans l'assistant de Créer).
 *   2. Le fil d'étapes vit DANS la carte principale de la colonne de travail,
 *      avec la notification de page, la consigne, l'étape et ses gestes. Le
 *      statut global reste rendu ; « Source » reste atteignable depuis le fil.
 *   3. Le titre de la zone d'aperçu est un libellé discret en capitales, avec
 *      une icône — comme le panneau d'aperçu de Créer.
 *   4. « Ma voix » : UNE section, APRÈS les deux colonnes, UN seul titre de
 *      niveau 2 ; enregistrer, voix utilisée, prononciations, aperçu prononcé
 *      et écoute sont des sous-titres (h3), sans carte propre. Toutes les
 *      fonctionnalités voix restent (composants RÉELS ici, pas de doublure).
 *   5. Structure responsive : aucun `order-*`, aucune largeur fixe > 390 px.
 *
 * ⚠️ Les composants voix ne sont PAS doublés (`vi.mock`) : c'est justement
 * leur intégration réelle dans la section qui est spécifiée. Le serveur voix
 * est décrit par le même `fetch` factice que le reste de la page.
 */

// La page peut naviguer (« Créer une vidéo ») : le routeur Next est factice, rien n'est asserté dessus.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => '/dashboard/avatar',
  useSearchParams: () => new URLSearchParams(),
}));

import AvatarPage from '../app/dashboard/avatar/page';
import { installerXhrDeTest, type XhrDeTest } from './aides/xhr-de-test';

const A = '11111111-1111-4111-8111-000000000001';
const G = '22222222-2222-4222-8222-000000000001';
const V1 = '44444444-4444-4444-8444-000000000001';
const V2 = '44444444-4444-4444-8444-000000000002';
const URL_APERCU = 'https://studiio.pro/storage/v1/object/public/media/u/avatar/g.mp4';

type Ligne = Record<string, unknown> | null;
type EtatAvatar = 'entrainement' | 'entraine_non_valide' | 'valide' | 'echec';
const STATUT_HEYGEN: Record<EtatAvatar, string> = { entrainement: 'training', entraine_non_valide: 'completed', valide: 'completed', echec: 'failed' };

/** L'état SERVEUR : la page ne montre que ce qu'il dit. */
const serveur = {
  avatar: null as Ligne,
  etape: 'consentement_a_demander',
  apercu: { statut: 'aucun' } as Record<string, unknown>,
  /** Réponse de POST /api/avatar/generate pour l'APERÇU : par défaut, la voix manque. */
  generate: { success: false, error: 'Voix indisponible', code: 'voix_indisponible' } as Record<string, unknown>,
  /** Le profil vocal (GET /api/voice/profil) : deux voix, l'une choisie → sélecteur ET voix sélectionnée. */
  profilVoix: {} as Record<string, unknown>,
};
const appels: Array<{ url: string; method: string }> = [];

const voix = (id: string, nom: string) => ({ id, nom, fournisseur: 'elevenlabs', langue: 'fr', creeeLe: '2026-08-01', utilisable: true });
const profilVoixBase = () => ({
  voix: [voix(V1, 'Bassi'), voix(V2, 'Radio')],
  choix: V1,
  voixResolue: voix(V1, 'Bassi'),
  motifVoix: null,
  messageVoix: null,
  prononciations: [{ affiche: 'Afroboost', prononce: 'Afro-boust' }],
  ecouteDisponible: true,
});

function stubApi() {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    appels.push({ url: u, method });
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() } as unknown as Response);
    const ligne = () => (serveur.avatar ? { ...serveur.avatar, etape_did: serveur.etape, provider_consent_text: null, consent_name: null, consent_expire_le: null } : null);
    // ── Avatar ──
    if (u === '/api/avatar/create' && method === 'GET') return json(200, { success: true, data: { avatar: ligne(), voices: [{ voiceId: 'v1', name: 'Voix' }], defaultVoiceId: 'v1', didVideoActif: true, nomProfil: 'Henri' } });
    if (u === '/api/avatar' && method === 'DELETE') { serveur.avatar = null; return json(200, { success: true, data: { sourceRetiree: true } }); }
    if (u === '/api/avatar/apercu') return json(200, { success: true, data: { avatarId: A, version: 1, etat: serveur.avatar?.etat, apercu: serveur.apercu } });
    if (u === '/api/avatar/generate') {
      const corps = JSON.parse(String(init?.body ?? '{}')) as { intention?: string };
      if (corps.intention === 'apercu') {
        if (serveur.generate.success) serveur.apercu = { statut: 'en_cours', generationId: G };
        return json(serveur.generate.success ? 200 : 409, serveur.generate.success ? { success: true, data: { generationId: G } } : serveur.generate);
      }
      return json(200, { success: true, data: { generationId: 'g2' } });
    }
    if (u === '/api/avatar/did/consentement' && method === 'GET') return json(200, { success: true, data: { etape: serveur.etape } });
    if (u.startsWith('/api/avatar/status')) return json(200, { success: true, data: { generationId: G, status: 'processing', videoUrl: null, error: null } });
    // ── Voix (composants RÉELS) ──
    if (u === '/api/voice/profil') return json(200, { success: true, data: serveur.profilVoix });
    if (u === '/api/voice/clone' && method === 'GET') return json(200, { success: true, voices: [] });
    return json(404, { success: false, error: `route inattendue ${method} ${u}` });
  }) as unknown as typeof fetch;
}

const avatarHeygen = (etat: EtatAvatar, extra: Record<string, unknown> = {}) => {
  serveur.avatar = { id: A, name: 'Mon avatar', status: STATUT_HEYGEN[etat], avatar_type: 'photo', provider: 'heygen', created_at: '2026-09-16T10:00:00Z', consent_at: '2026-09-16T10:00:00Z', etat, version: 1, validated_at: etat === 'valide' ? '2026-09-16T11:00:00Z' : null, ...extra };
};

// ── Lecture de l'écran ───────────────────────────────────────────────────
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const tourner = async (n = 6) => { for (let i = 0; i < n; i += 1) await act(async () => { await Promise.resolve(); }); };
const precede = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const etatsFil = () => Object.fromEntries(qa('[data-fil-etapes] [data-etape]').map((e) => [e.getAttribute('data-etape'), e.getAttribute('data-etape-etat')]));
/** La Consigne DE LA PAGE (pas celle, interne, du panneau de consentement D-ID). */
const consignePage = () => qa('[data-consigne]').find((e) => !e.closest('[data-avatar-did]')) ?? null;
/** Les notifications DE LA PAGE (hors panneau D-ID). */
const notifsPage = () => qa('[data-notification]').filter((e) => !e.closest('[data-avatar-did]'));
const carte = () => q('[data-avatar-carte-principale]');
const sectionVoix = () => q('[data-avatar-ma-voix]');
/** Rend la page, attend le fil d'étapes ET le profil vocal (composants voix réels), rend la main. */
const monter = async () => {
  cleanup();
  render(<AvatarPage />);
  await waitFor(() => expect(q('[data-fil-etapes]')).not.toBeNull());
  await waitFor(() => expect(q('[data-voix-panel]')).not.toBeNull());
  await tourner();
};
const lire = (chemin: string) => readFileSync(resolve(process.cwd(), chemin), 'utf8');

let xhr: XhrDeTest;
beforeEach(() => {
  xhr = installerXhrDeTest();
  appels.length = 0; window.localStorage.clear();
  serveur.avatar = null; serveur.etape = 'consentement_a_demander'; serveur.apercu = { statut: 'aucun' };
  serveur.generate = { success: false, error: 'Voix indisponible', code: 'voix_indisponible' };
  serveur.profilVoix = profilVoixBase();
  (globalThis as unknown as { URL: typeof URL }).URL.createObjectURL = () => 'blob:apercu';
  (globalThis as unknown as { URL: typeof URL }).URL.revokeObjectURL = () => {};
  stubApi();
});
afterEach(() => { cleanup(); xhr.restaurer(); vi.useRealTimers(); });

// ─────────────────────────────────────────────────────────────────────────
describe('1. Offset d’aperçu : une seule source', () => {
  it('⚠️ globals.css : `--apercu-offset` a UNE valeur (en rem), définie une seule fois — jeton `:root` OU repli du `var()` de `.apercu-cadre`, jamais les deux', () => {
    const css = lire('src/app/globals.css');
    const bloc = css.slice(css.indexOf('.apercu-cadre'));
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.apercu-cadre/);
    // La valeur est LUE, pas supposée : toute déclaration (`--apercu-offset: Nrem`) et tout repli
    // (`var(--apercu-offset, Nrem)`) comptent comme une source. Il en faut exactement une.
    const declarations = [...css.matchAll(/--apercu-offset\s*:\s*([\d.]+rem)/g)].map((m) => m[1]);
    const replis = [...css.matchAll(/var\(--apercu-offset\s*,\s*([\d.]+rem)\)/g)].map((m) => m[1]);
    const sources = [...declarations, ...replis];
    expect(sources, `sources de --apercu-offset : déclarations ${JSON.stringify(declarations)}, replis ${JSON.stringify(replis)}`).toHaveLength(1);
    expect(sources[0]).toMatch(/^[\d.]+rem$/);
    // `.apercu-cadre` lit cette variable dans la borne de hauteur (ratio conservé), sans défilement interne (#410).
    expect(bloc).toMatch(/100vh - var\(--apercu-offset(?:\s*,\s*[\d.]+rem)?\)/);
    expect(bloc).toContain('var(--apercu-w, 9) / var(--apercu-h, 16)');
    expect(bloc.slice(0, bloc.indexOf('}'))).not.toContain('overflow');
    // Une seule LECTURE de la variable dans tout le CSS : personne d'autre ne la réinterprète.
    expect(css.match(/var\(--apercu-offset/g) ?? []).toHaveLength(1);
  });

  it('⚠️ aucune page ne POSE `--apercu-offset` (clé de style ou déclaration CSS) : ni Mon avatar (page.tsx) ni l’assistant de Créer (AssistantWizard.tsx)', () => {
    // Une clé de style (`{ '--apercu-offset': '11rem' }`) ou une déclaration (`--apercu-offset: 11rem`).
    // La citer dans un commentaire reste permis : c'est la surcharge qui est interdite.
    const pose = /['"`]--apercu-offset['"`]\s*:|--apercu-offset\s*:\s*[\d.]+\s*(?:rem|px|vh|em)/;
    for (const chemin of ['src/app/dashboard/avatar/page.tsx', 'src/app/dashboard/creer/AssistantWizard.tsx']) {
      const src = lire(chemin);
      const m = pose.exec(src);
      expect(m?.[0] ?? null, `${chemin} pose --apercu-offset`).toBeNull();
    }
  });

  it('⚠️ en rendu : aucun élément de la colonne d’aperçu ne porte un style `--apercu-offset` (1:1 sans avatar, 9:16 à l’aperçu)', async () => {
    const sansOffset = () => {
      const colonne = q('[data-colonne="apercu"]')!;
      expect(colonne).not.toBeNull();
      const porteurs = [colonne, ...colonne.querySelectorAll<HTMLElement>('*')].filter((e) => e.style.getPropertyValue('--apercu-offset') !== '');
      expect(porteurs.map((e) => e.outerHTML.slice(0, 120)), 'éléments qui posent --apercu-offset').toEqual([]);
    };
    await monter();
    expect(q('[data-avatar-apercu-cadre]')?.getAttribute('data-avatar-apercu-cadre')).toBe('1 / 1');
    sansOffset();
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'en_cours', generationId: G };
    await monter();
    expect(q('[data-avatar-apercu-cadre]')?.getAttribute('data-avatar-apercu-cadre')).toBe('9 / 16');
    sansOffset();
    // Le cadre partagé est bien là : c'est lui qui porte la règle, avec son ratio en variables.
    const cadre = q('[data-colonne="apercu"] .apercu-cadre')!;
    expect(cadre).not.toBeNull();
    expect(cadre.style.getPropertyValue('--apercu-w')).toBe('9');
    expect(cadre.style.getPropertyValue('--apercu-h')).toBe('16');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('2. Carte principale — le fil, le statut, la notification, la consigne et l’étape dans UNE carte de la colonne de travail', () => {
  it('⚠️ le fil d’étapes est DANS `[data-avatar-carte-principale]` (card-base), première carte de la colonne travail ; le statut global est rendu ; la consigne suit le fil', async () => {
    await monter();
    const c = carte()!;
    expect(c, 'la carte principale existe').not.toBeNull();
    expect(c.classList.contains('card-base')).toBe(true);
    expect(q('[data-colonne="travail"]')!.contains(c), 'dans la colonne travail').toBe(true);
    expect(q('[data-colonne="travail"]')!.firstElementChild).toBe(c);
    expect(qa('[data-avatar-carte-principale]')).toHaveLength(1);
    expect(c.querySelector('[data-fil-etapes]'), 'le fil vit dans la carte').not.toBeNull();
    expect(qa('[data-fil-etapes]')).toHaveLength(1);
    // Le statut global (StatutAvatar) est conservé, dans la colonne de travail, et dit « Aucun avatar ».
    const statut = q('[data-colonne="travail"] [data-avatar-statut]')!;
    expect(statut).not.toBeNull();
    expect(statut.getAttribute('data-avatar-statut')).toBe('aucun');
    expect(q('[data-avatar-statut-libelle]')?.textContent?.trim()).toBe('Aucun avatar');
    // La consigne est dans la carte, après le fil ; l'étape (choix de source) aussi.
    const consigne = consignePage()!;
    expect(c.contains(consigne), 'la consigne vit dans la carte').toBe(true);
    expect(precede(c.querySelector('[data-fil-etapes]')!, consigne)).toBe(true);
    expect(c.querySelector('input[type="file"]'), 'l’étape Source (import) vit dans la carte').not.toBeNull();
  });

  it('⚠️ « Source » reste atteignable depuis le fil : avatar validé → clic sur Source = retour à l’import, sans requête destructive', async () => {
    avatarHeygen('valide'); await monter();
    expect(etatsFil()).toEqual({ source: 'terminee', consentement: 'terminee', entrainement: 'terminee', apercu: 'terminee', validation: 'terminee' });
    const source = carte()!.querySelector<HTMLElement>('[data-fil-etapes] [data-etape="source"]')!;
    expect(source.getAttribute('role')).toBe('button');
    fireEvent.click(source);
    await tourner();
    expect(etatsFil().source).toBe('active');
    expect(q('[data-fil-etapes] [aria-current="step"]')?.getAttribute('data-etape')).toBe('source');
    expect(q('[data-avatar-statut]')?.getAttribute('data-avatar-statut')).toBe('aucun');
    expect(carte()!.querySelector('input[type="file"]')).not.toBeNull();
    expect(appels.some((a) => a.method === 'DELETE')).toBe(false);
    // Le fil est toujours dans la carte après le retour.
    expect(carte()!.querySelector('[data-fil-etapes]')).not.toBeNull();
  });

  it('⚠️ voix manquante (409 voix_indisponible) → la notification de page s’affiche DANS la carte, avant la consigne, et « Configurer ma voix » mène à la section Ma voix', async () => {
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'aucun' };
    await monter();
    expect(notifsPage()).toHaveLength(0);
    await act(async () => { fireEvent.click(q('[data-avatar-apercu="generer"]')!); });
    await waitFor(() => expect(notifsPage()).toHaveLength(1));
    const notif = notifsPage()[0];
    expect(notif.getAttribute('data-notification')).toBe('avertissement');
    expect(notif.querySelector('[data-notification-titre]')?.textContent).toMatch(/^Votre voix personnelle est nécessaire pour l['’]aperçu\.$/);
    expect(carte()!.contains(notif), 'la notification vit dans la carte principale').toBe(true);
    expect(precede(carte()!.querySelector('[data-fil-etapes]')!, notif), 'après le fil').toBe(true);
    expect(precede(notif, consignePage()!), 'avant la consigne').toBe(true);
    // « Configurer ma voix » fait défiler jusqu'à la section (réelle) Ma voix.
    const zone = sectionVoix()!;
    const defiler = vi.fn(); zone.scrollIntoView = defiler;
    fireEvent.click(notif.querySelector('[data-notification-action="principale"]')!);
    expect(defiler).toHaveBeenCalledTimes(1);
  });

  it('⚠️ UNE seule zone d’aperçu, dans la colonne aperçu, quel que soit l’état (sans avatar, à valider, validé)', async () => {
    await monter();
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(q('[data-colonne="apercu"] [data-apercu]')).not.toBeNull();
    expect(carte()!.querySelector('[data-apercu]'), 'jamais d’aperçu dans la carte').toBeNull();
    avatarHeygen('entraine_non_valide'); serveur.apercu = { statut: 'pret', generationId: G, url: URL_APERCU };
    await monter();
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(q('[data-colonne="apercu"] [data-apercu]')).not.toBeNull();
    avatarHeygen('valide');
    await monter();
    expect(qa('[data-apercu]')).toHaveLength(1);
    expect(q('[data-colonne="apercu"] [data-apercu]')).not.toBeNull();
    expect(carte()!.querySelector('[data-apercu]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('3. Aperçu — un titre discret en capitales, avec icône', () => {
  it('⚠️ `[data-apercu-titre]` porte `text-xs font-semibold uppercase tracking-wider text-gray-500` et contient une icône svg', async () => {
    await monter();
    const titre = q('[data-colonne="apercu"] [data-apercu-titre]')!;
    expect(titre).not.toBeNull();
    ['text-xs', 'font-semibold', 'uppercase', 'tracking-wider', 'text-gray-500'].forEach((cls) => expect(titre.classList.contains(cls), cls).toBe(true));
    expect(titre.querySelector('svg'), 'une icône dans le titre').not.toBeNull();
    expect(titre.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('4. Ma voix — UNE section après les colonnes, UN titre, composants voix RÉELS', () => {
  it('⚠️ une seule section `[data-avatar-ma-voix]`, hors des colonnes, après elles ; ordre DOM carte → colonne aperçu → Ma voix', async () => {
    await monter();
    expect(qa('[data-avatar-ma-voix]')).toHaveLength(1);
    const section = sectionVoix()!;
    const colonnes = q('[data-colonnes]')!;
    expect(colonnes).not.toBeNull();
    expect(colonnes.contains(section), 'Ma voix n’est pas dans les colonnes').toBe(false);
    expect(precede(colonnes, section), 'après les colonnes').toBe(true);
    expect(precede(carte()!, q('[data-colonne="apercu"]')!), 'carte → colonne aperçu').toBe(true);
    expect(precede(q('[data-colonne="apercu"]')!, section), 'colonne aperçu → Ma voix').toBe(true);
    // Aucun composant voix ne s'est glissé dans la colonne de travail.
    expect(q('[data-colonne="travail"] [data-voix-panel]')).toBeNull();
    expect(qa('[data-colonne="travail"] h3').map((h) => h.textContent?.trim())).not.toContain('Enregistrer ma voix');
  });

  it('⚠️ UN seul titre « Ma voix » : l’EnteteSection de niveau 2 (`[data-entete="ma-voix"] [data-entete-titre]`) — aucun h2 dans les composants voix', async () => {
    await monter();
    const section = sectionVoix()!;
    const entete = section.querySelector('[data-entete="ma-voix"]')!;
    expect(entete, 'l’en-tête de section vit dans la section').not.toBeNull();
    const titre = entete.querySelector('[data-entete-titre]')!;
    expect(titre.tagName).toBe('H2');
    expect(titre.textContent?.trim()).toBe('Ma voix');
    // Un seul h2 dans toute la section : celui de l'en-tête.
    expect([...section.querySelectorAll('h2')].map((h) => h.textContent?.trim())).toEqual(['Ma voix']);
    // Et un seul « Ma voix » en titre sur toute la page.
    expect(qa('h1, h2, h3, h4').filter((h) => h.textContent?.trim() === 'Ma voix')).toHaveLength(1);
    expect(precede(entete, section.querySelector('[data-voix-panel]')!), 'l’en-tête précède le panneau').toBe(true);
  });

  it('⚠️ sous-titres h3 dans l’ordre : « Enregistrer ma voix » (VoiceCloneRecorder) puis « Voix utilisée », « Prononciations », « Aperçu du texte prononcé » (MaVoixPanel) — sans card-base propre', async () => {
    await monter();
    const section = sectionVoix()!;
    const h3 = [...section.querySelectorAll('h3')].map((h) => h.textContent?.trim() ?? '');
    const attendus = ['Enregistrer ma voix', 'Voix utilisée', 'Prononciations', 'Aperçu du texte prononcé'];
    attendus.forEach((t) => expect(h3, t).toContain(t));
    const positions = attendus.map((t) => h3.indexOf(t));
    expect(positions, 'ordre des sous-titres').toEqual([...positions].sort((a, b) => a - b));
    // « Enregistrer ma voix » vient AVANT le panneau Ma voix (VoiceCloneRecorder puis MaVoixPanel).
    const enregistrer = [...section.querySelectorAll('h3')].find((h) => h.textContent?.trim() === 'Enregistrer ma voix')!;
    expect(precede(enregistrer, section.querySelector('[data-voix-panel]')!)).toBe(true);
    // Les composants n'ont pas de carte propre : le panneau ne porte pas card-base, et s'il y a une
    // carte autour, c'est la même pour l'enregistreur et le panneau (au plus une, portée par la page).
    const panneau = section.querySelector<HTMLElement>('[data-voix-panel]')!;
    expect(panneau.classList.contains('card-base')).toBe(false);
    expect(enregistrer.parentElement?.classList.contains('card-base')).toBe(false);
    expect(enregistrer.closest('.card-base')).toBe(panneau.closest('.card-base'));
    expect(section.querySelectorAll('.card-base').length).toBeLessThanOrEqual(1);
  });

  it('⚠️ toutes les fonctionnalités voix restent, dans la section : panneau, voix sélectionnée, sélecteur, prononciations (+ ajouter), aperçu texte / affiché / prononcé, écouter ; le serveur voix a été lu', async () => {
    await monter();
    const section = sectionVoix()!;
    const hooks = [
      '[data-voix-panel]',
      '[data-voix-selectionnee]',
      '[data-voix-selecteur]',
      '[data-prononciations]',
      '[data-prononciation-ajouter]',
      '[data-apercu-texte]',
      '[data-apercu-affiche]',
      '[data-apercu-prononce]',
      '[data-ecouter]',
    ];
    hooks.forEach((sel) => expect(section.querySelector(sel), sel).not.toBeNull());
    // Ce sont les composants réels : la voix et les prononciations viennent du serveur.
    expect(section.querySelector('[data-voix-selectionnee]')!.textContent).toContain('« Ma voix — Bassi »');
    expect(section.querySelector('[data-prononciation="Afroboost"]')).not.toBeNull();
    expect(section.querySelector('[data-apercu-affiche]')!.textContent).toContain('Afroboost');
    expect(section.querySelector('[data-apercu-prononce]')!.textContent).toContain('Afro-boust');
    expect(appels.some((a) => a.url === '/api/voice/profil' && a.method === 'GET'), 'GET /api/voice/profil').toBe(true);
    expect(appels.some((a) => a.url === '/api/voice/clone' && a.method === 'GET'), 'GET /api/voice/clone').toBe(true);
    // L'enregistreur est là (son bouton « Enregistrer » et son compteur), pas une doublure.
    const enregistrer = [...section.querySelectorAll('button')].find((b) => /^Enregistrer$/.test(b.textContent?.trim() ?? ''));
    expect(enregistrer, 'le bouton « Enregistrer » de l’enregistreur').toBeTruthy();
    expect(section.querySelector('[aria-live="polite"]')?.textContent).toMatch(/^\d+:\d{2}$/);
  });

  it('⚠️ la section est focalisable au clavier (tabIndex -1) : cible de « Configurer ma voix »', async () => {
    await monter();
    const section = sectionVoix()!;
    expect(section.tabIndex).toBe(-1);
    expect(section.getAttribute('tabindex')).toBe('-1');
    section.focus();
    expect(document.activeElement).toBe(section);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('5. Responsive (structure) — l’ordre DOM fait foi, aucune largeur fixe', () => {
  const structure = () => [q('[data-colonnes]')!, q('[data-colonne="travail"]')!, q('[data-colonne="apercu"]')!, carte()!, sectionVoix()!];

  it('⚠️ aucun `order-*` sur les colonnes, la carte principale ni la section Ma voix (ni dans leurs descendants)', async () => {
    await monter();
    for (const racine of structure()) {
      expect(racine).not.toBeNull();
      const fautifs = [racine, ...racine.querySelectorAll<HTMLElement>('*')]
        .filter((e) => /(?:^|\s)(?:[a-z]+:)?-?order-/.test(e.className ?? ''))
        .map((e) => e.className);
      expect(fautifs, racine.outerHTML.slice(0, 80)).toEqual([]);
    }
  });

  it('⚠️ aucune largeur fixe > 390 px (classe `w-[Npx]` / `min-w-[Npx]` ou style inline) sur les colonnes, la carte et la section voix', async () => {
    avatarHeygen('valide'); await monter();
    const px = (v: string | null | undefined) => { const m = /^(\d+(?:\.\d+)?)px$/.exec((v ?? '').trim()); return m ? Number(m[1]) : null; };
    for (const racine of structure()) {
      expect(racine).not.toBeNull();
      const fautifs: string[] = [];
      for (const e of [racine, ...racine.querySelectorAll<HTMLElement>('*')]) {
        const cls = typeof e.className === 'string' ? e.className : '';
        for (const m of cls.matchAll(/(?:^|\s)(?:[a-z]+:)?(?:min-)?w-\[(\d+(?:\.\d+)?)px\]/g)) if (Number(m[1]) > 390) fautifs.push(cls);
        const w = px(e.style.width); const mw = px(e.style.minWidth);
        if ((w !== null && w > 390) || (mw !== null && mw > 390)) fautifs.push(e.getAttribute('style') ?? '');
      }
      expect(fautifs, racine.outerHTML.slice(0, 80)).toEqual([]);
    }
  });
});
