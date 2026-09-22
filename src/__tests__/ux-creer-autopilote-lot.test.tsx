/**
 * LOT UX « Créer / Autopilote » :
 *   1. le choix du mode n'a PLUS d'aperçu à droite (une colonne) ;
 *   2. l'assistant et l'Autopilote gardent les deux colonnes, et le cadre
 *      d'aperçu porte `.apercu-cadre` (largeur déduite de la hauteur de
 *      fenêtre : jamais coupé en bas) ;
 *   3. l'affiche : Médiathèque + Générer avec l'IA, à côté de « Ma photo » ;
 *   4. `AfficheIA` : états (repos → génération → résultat → utiliser),
 *      Régénérer, erreur ;
 *   5. `JumeauAutopilote` : l'état serveur, l'interrupteur qui ne branche que
 *      ce que le cron sait faire (la voix), le lien vers Mon avatar ;
 *   6. la série va de 2 à 10 (couvert par creer-serie-pilote.test.tsx).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';

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
import DeuxColonnes, { ColonneTravail, ColonneApercu } from '@/components/ux/DeuxColonnes';
import ZoneApercu, { ratioEnVariables } from '@/components/ux/ZoneApercu';
import AfficheIA from '@/components/creer/AfficheIA';
import JumeauAutopilote from '@/components/creer/JumeauAutopilote';

let configServeur: AutopilotConfig = DEFAULT_CONFIG;
let jumeauServeur: unknown = null;

beforeEach(() => {
  configServeur = DEFAULT_CONFIG;
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/pexels')) {
      return { ok: true, json: async () => ({ success: true, photos: [{ id: 1, url: 'https://exemple.test/affiche.jpg', medium: 'https://exemple.test/affiche.jpg' }] }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        configServeur = sanitizeConfig(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ success: true, brandingReady: true, config: configServeur }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, config: configServeur }) };
    }
    if (u.startsWith('/api/creer/jumeau')) {
      return { ok: true, json: async () => ({ success: jumeauServeur !== null, data: jumeauServeur }) };
    }
    if (u === '/api/voice/clone') {
      return { ok: true, json: async () => ({ success: true, configured: true, voices: [
        // Même nom que la voix du jumeau, autre compte : la correspondance ne doit JAMAIS se faire par le nom.
        { id: 'elevenlabs-ZZZ', accountVoiceId: 'voix-autre', name: 'Ma voix', lang: null, createdAt: '2026-09-01' },
        { id: 'elevenlabs-AAA', accountVoiceId: 'voix-1', name: 'Ma voix', lang: null, createdAt: '2026-09-02' },
      ] }) };
    }
    if (u.startsWith('/api/ai/image')) {
      const body = JSON.parse(String(init?.body || '{}'));
      if (!body.prompt) return { ok: false, status: 400, json: async () => ({ success: false, error: 'prompt requis' }) };
      return { ok: true, json: async () => ({ success: true, resultUrl: `https://replicate.test/${encodeURIComponent(body.prompt)}.webp`, creditsUsed: 5 }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// ── 1. Le choix du mode : UNE colonne, pas d'aperçu ─────────────────────────
describe('1. Choix du mode', () => {
  it('n a pas de colonne d aperçu, et une seule colonne centrée', async () => {
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-parcours-choix]')).not.toBeNull());
    const grille = document.querySelector('[data-colonnes="choix"]');
    expect(grille).not.toBeNull();
    expect(grille?.getAttribute('data-apercu-colonne')).toBe('non');
    expect(grille?.className).not.toContain('lg:grid-cols-5');
    expect(grille?.className).toContain('mx-auto');
    expect(document.querySelector('[data-colonne="apercu"]')).toBeNull();
    // La colonne travail n'est plus bornée aux 3/5 de la largeur.
    expect(document.querySelector('[data-colonne="travail"]')?.className).not.toContain('lg:col-span-3');
    // Les deux cartes et l'éditeur avancé en option secondaire.
    expect(document.querySelector('[data-parcours-assistant]')).not.toBeNull();
    expect(document.querySelector('[data-parcours-autopilote]')).not.toBeNull();
    expect(document.querySelector('[data-editeur-avance]')).not.toBeNull();
  });

  it('l Autopilote, une fois choisi, retrouve ses deux colonnes et son aperçu', async () => {
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-parcours-autopilote]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-parcours-autopilote]')!);
    await waitFor(() => expect(document.querySelector('[data-colonnes="autopilote"]')).not.toBeNull());
    const grille = document.querySelector('[data-colonnes="autopilote"]');
    expect(grille?.getAttribute('data-apercu-colonne')).toBe('oui');
    expect(grille?.className).toContain('lg:grid-cols-5');
    expect(document.querySelector('[data-colonne="apercu"]')).not.toBeNull();
    expect(document.querySelector('[data-autopilot-apercu-cadre]')).not.toBeNull();
  });

  it('l assistant garde ses deux colonnes', async () => {
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-parcours-assistant]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-parcours-assistant]')!);
    await waitFor(() => expect(document.querySelector('[data-colonnes="assistant"]')).not.toBeNull());
    expect(document.querySelector('[data-colonne="apercu"]')).not.toBeNull();
  });
});

// ── 2. Le cadre d'aperçu : jamais coupé ─────────────────────────────────────
describe('2. Cadre d aperçu', () => {
  it('DeuxColonnes sans aperçu = une colonne ; avec = cinq colonnes', () => {
    const { container, rerender } = render(
      <DeuxColonnes nom="x" apercu={false}><ColonneTravail>t</ColonneTravail></DeuxColonnes>,
    );
    expect(container.querySelector('[data-colonnes="x"]')?.className).not.toContain('lg:grid-cols-5');
    expect(container.querySelector('[data-colonne="travail"]')?.className).not.toContain('lg:col-span-3');
    rerender(<DeuxColonnes nom="x"><ColonneTravail>t</ColonneTravail><ColonneApercu>a</ColonneApercu></DeuxColonnes>);
    expect(container.querySelector('[data-colonnes="x"]')?.className).toContain('lg:grid-cols-5');
    expect(container.querySelector('[data-colonne="travail"]')?.className).toContain('lg:col-span-3');
    expect(container.querySelector('[data-colonne="apercu"]')?.className).toContain('lg:sticky');
  });

  it('ZoneApercu pose .apercu-cadre et les variables du ratio (prêt ET vide)', () => {
    const { container, rerender } = render(<ZoneApercu etat={{ statut: 'pret' }} ratio="9 / 16"><video /></ZoneApercu>);
    const media = container.querySelector('[data-apercu-media]') as HTMLElement;
    expect(media.className).toContain('apercu-cadre');
    expect(media.style.getPropertyValue('--apercu-w')).toBe('9');
    expect(media.style.getPropertyValue('--apercu-h')).toBe('16');
    rerender(<ZoneApercu etat={{ statut: 'vide', message: 'rien' }} ratio="16 / 9" />);
    const vide = container.querySelector('[role="status"]') as HTMLElement;
    expect(vide.className).toContain('apercu-cadre');
    expect(vide.style.getPropertyValue('--apercu-w')).toBe('16');
    expect(vide.style.getPropertyValue('--apercu-h')).toBe('9');
  });

  it('ratioEnVariables lit « 9 / 16 », « 1 / 1 », et retombe sur 9:16', () => {
    expect(ratioEnVariables('9 / 16')).toEqual({ '--apercu-w': '9', '--apercu-h': '16' });
    expect(ratioEnVariables('1 / 1')).toEqual({ '--apercu-w': '1', '--apercu-h': '1' });
    expect(ratioEnVariables('n importe quoi')).toEqual({ '--apercu-w': '9', '--apercu-h': '16' });
  });

  it('la règle CSS borne la largeur par la hauteur de fenêtre, sous lg seulement', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    const bloc = css.slice(css.indexOf('.apercu-cadre'));
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.apercu-cadre/);
    // Une seule source : le décalage est un jeton de :root, sans repli caché dans le calc.
    expect(css).toMatch(/:root\s*\{[^}]*--apercu-offset:\s*20rem/);
    expect(bloc).toContain('100vh - var(--apercu-offset)');
    expect(bloc).toContain('var(--apercu-w, 9) / var(--apercu-h, 16)');
    // Aucun défilement interne (règle #410) : pas d'overflow dans la règle.
    expect(bloc.slice(0, bloc.indexOf('}'))).not.toContain('overflow');
  });

  it('le cadre de l assistant porte aussi .apercu-cadre', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    expect(src).toMatch(/ref=\{frameRef\}[\s\S]{0,400}className="apercu-cadre w-full rounded-xl overflow-hidden relative"/);
  });
});

// ── 3 & 4. L'affiche : trois chemins, et la génération IA ───────────────────
describe('3. Sources de l affiche', () => {
  it('propose Médiathèque et Générer avec l IA à côté de Ma photo', async () => {
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-parcours-assistant]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-parcours-assistant]')!);
    // La section « Photo d'affiche » est dans l'étape Style : on l'atteint
    // par son bouton de section s'il est rendu, sinon on prouve par la source.
    const src = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    expect(src).toContain('data-poster-upload');
    expect(src).toContain('data-affiche-mediatheque');
    expect(src).toContain('data-affiche-generer-ia');
    expect(src).toMatch(/<MediaLibrary[\s\S]{0,200}mediaType="image"[\s\S]{0,200}applyPhoto\(url\)/);
    // La persistance : le SERVEUR enregistre l'image et renvoie une URL
    // durable. Le navigateur ne télécharge jamais l'URL du fournisseur et
    // n'envoie rien au stockage depuis ce chemin ; une URL non durable est
    // refusée, et l'image durable rejoint la grille en tête.
    const debut = src.indexOf('const utiliserAfficheIA = useCallback(');
    expect(debut).toBeGreaterThan(-1);
    const corps = src.slice(debut, src.indexOf('}, []);', debut) + '}, []);'.length);
    expect(corps).not.toContain('fetch(url)');
    expect(corps).not.toContain('uploadPosterFile(');
    expect(corps).toContain('estAfficheDurable(');
    expect(corps).toContain('setPosterPhotos((prev) => [perso, ...prev])');
  });
});

describe('4. AfficheIA', () => {
  it('génère, montre le résultat, régénère, et applique', async () => {
    const onUtiliser = vi.fn(async (_url: string) => {});
    render(<AfficheIA suggestion="danse au bord du lac" onUtiliser={onUtiliser} />);
    expect(document.querySelector('[data-affiche-ia-resultat]')).toBeNull();
    // Sans consigne : la suggestion sert de consigne.
    fireEvent.click(document.querySelector('[data-affiche-ia-generer]')!);
    expect(document.querySelector('[data-affiche-ia-etat="generation"]')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[data-affiche-ia-resultat]')).not.toBeNull());
    const img = document.querySelector('[data-affiche-ia-resultat] img') as HTMLImageElement;
    expect(img.src).toContain('danse%20au%20bord%20du%20lac');
    expect(screen.getByText('Régénérer')).toBeTruthy();
    // Régénérer avec une consigne explicite.
    fireEvent.change(document.querySelector('[data-affiche-ia-prompt]')!, { target: { value: 'salle sombre néons' } });
    fireEvent.click(document.querySelector('[data-affiche-ia-generer]')!);
    await waitFor(() => expect((document.querySelector('[data-affiche-ia-resultat] img') as HTMLImageElement).src).toContain('salle%20sombre'));
    // Utiliser : l'appelant reçoit l'URL.
    fireEvent.click(document.querySelector('[data-affiche-ia-utiliser]')!);
    await waitFor(() => expect(onUtiliser).toHaveBeenCalledTimes(1));
    expect(onUtiliser.mock.calls[0][0]).toContain('salle%20sombre');
  });

  it('dit l erreur du serveur, sans résultat', async () => {
    render(<AfficheIA suggestion="" onUtiliser={async () => {}} />);
    fireEvent.click(document.querySelector('[data-affiche-ia-generer]')!);
    await waitFor(() => expect(document.querySelector('[data-affiche-ia-etat="erreur"]')).not.toBeNull());
    expect(document.querySelector('[data-affiche-ia-resultat]')).toBeNull();
  });
});

// ── 5. Mon jumeau dans l'Autopilote ─────────────────────────────────────────
describe('5. JumeauAutopilote', () => {
  it('jumeau prêt : la voix est posée par son identifiant Studiio (exact, jamais par le nom) et, moteur vidéo dispo + migration, l interrupteur « Monter la vidéo de mon jumeau » apparaît', async () => {
    jumeauServeur = { pret: true, motif: null, message: null, moteurDisponible: true, messageMoteur: null,
      jumeau: { avatar: { id: 'a', version: 3, nom: 'Bassi', valideLe: '2026-09-01' }, voix: { id: 'voix-1', nom: 'Ma voix' }, prononciations: 0 } };
    const onChange = vi.fn();
    const onAvatarChange = vi.fn();
    const voixCompte = [
      { id: 'elevenlabs-ZZZ', accountVoiceId: 'voix-autre' },
      { id: 'elevenlabs-AAA', accountVoiceId: 'voix-1' },
    ];
    render(<JumeauAutopilote actif={false} onChange={onChange} onAvatarChange={onAvatarChange} avatarActif={false} jumeauReady voixCompte={voixCompte} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    const sw = document.querySelector('[data-jumeau-autopilote-interrupteur]') as HTMLInputElement;
    expect(sw.disabled).toBe(false);
    fireEvent.click(sw);
    // L'identifiant du MOTEUR (`elevenlabs-…`), jamais l'identifiant de compte du contrat Jumeau.
    expect(onChange).toHaveBeenCalledWith(true, 'elevenlabs-AAA');
    // Moteur vidéo disponible : l'interrupteur de montage de l'avatar apparaît et s'active.
    const avatar = document.querySelector('[data-jumeau-autopilote-avatar]') as HTMLInputElement;
    expect(avatar).not.toBeNull();
    fireEvent.click(avatar);
    expect(onAvatarChange).toHaveBeenCalledWith(true);
    expect(document.querySelector('[data-jumeau-autopilote-video="disponible"]')?.textContent).toContain('Monter la vidéo de mon jumeau');
    expect((document.querySelector('[data-jumeau-autopilote-lien]') as HTMLAnchorElement).getAttribute('href')).toBe('/dashboard/avatar');
  });

  it('jumeau non prêt : interrupteur inerte, le motif et le lien vers Mon avatar', async () => {
    jumeauServeur = { pret: false, motif: 'avatar_absent', message: 'Aucun avatar validé.', moteurDisponible: false, messageMoteur: null, jumeau: null };
    render(<JumeauAutopilote actif={true} onChange={() => {}} voixCompte={[]} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="avatar_absent"]')).not.toBeNull());
    const sw = document.querySelector('[data-jumeau-autopilote-interrupteur]') as HTMLInputElement;
    expect(sw.disabled).toBe(true);
    expect(sw.checked).toBe(false);
    expect(screen.getByText('Aucun avatar validé.')).toBeTruthy();
  });

  it('serveur injoignable : « n a pas pu être vérifié », jamais un faux prêt', async () => {
    jumeauServeur = null;
    render(<JumeauAutopilote actif={false} onChange={() => {}} voixCompte={[]} />);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="indisponible"]')).not.toBeNull());
    expect((document.querySelector('[data-jumeau-autopilote-interrupteur]') as HTMLInputElement).disabled).toBe(true);
  });

  it('dans l Autopilote, le bloc est monté et branche voiceEnabled + voiceId', async () => {
    jumeauServeur = { pret: true, motif: null, message: null, moteurDisponible: true, messageMoteur: null,
      jumeau: { avatar: { id: 'a', version: 1, nom: null, valideLe: '2026-09-01' }, voix: { id: 'voix-1', nom: 'Ma voix' }, prononciations: 0 } };
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-parcours-autopilote]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-parcours-autopilote]')!);
    // Le bloc vit à l'étape « Style » (celle de l'identité constante), avec la voix.
    await waitFor(() => expect(document.querySelector('[data-autopilot-etape="2"]')).not.toBeNull());
    await waitFor(() => expect((document.querySelector('[data-autopilot-etape="2"]') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(document.querySelector('[data-autopilot-etape="2"]')!);
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-jumeau-autopilote-etat="pret"]')).not.toBeNull());
    await act(async () => { fireEvent.click(document.querySelector('[data-jumeau-autopilote-interrupteur]')!); });
    await waitFor(() => expect(configServeur.voiceEnabled).toBe(true));
    expect(configServeur.voiceId).toBe('elevenlabs-AAA');
    // Et le switch RESTE allumé une fois la configuration relue.
    await waitFor(() => expect((document.querySelector('[data-jumeau-autopilote-interrupteur]') as HTMLInputElement).checked).toBe(true));
  });
});
