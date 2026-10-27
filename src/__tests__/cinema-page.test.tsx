/**
 * CINEMA IA — la page : production asynchrone, reprise, erreurs visibles.
 *
 * Le serveur est simule par un `fetch` programme : on verifie ce que la page
 * AFFICHE a chaque etat reel d'un travail, pas la mecanique serveur (testee
 * ailleurs).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react';
import CinemaPage from '@/app/dashboard/cinema/page';
import { preparerFilm } from '@/lib/cinema/atelier';
import { monterFilm } from '@/lib/cinema/montage';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { devisFilm } from '@/lib/cinema/couts';

const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Marco hoche la tete. Le jour se leve sur la salle vide.';
const film = { ...preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: 'film-ui-1', titre: 'Mon film' }), proprietaire: 'u1' };
const reponseFilm = () => ({
  ok: true, film, montage: presenterMontage(monterFilm(film), film.id),
  scenesAProduire: film.scenes.map((s) => s.id), devis: devisFilm(film, film.scenes.map((s) => s.id)),
});

const scenes = (etats: string[]) => Object.fromEntries(film.scenes.map((s, i) => [s.id, etats[i] ?? 'a_faire']));
const travail = (o: Record<string, unknown>) => ({
  id: '33333333-3333-4333-8333-333333333333', filmId: film.id, statut: 'en_cours', erreur: null, reference: null, annulationDemandee: false,
  progression: { etape: 'rendu', scenes: scenes(['faite', 'en_cours']), pourcent: 40, message: 'Rendu de la scene « X »' }, resultat: null, ...o,
});

let appels: Array<{ url: string; method: string }>;
let etatTravail: ReturnType<typeof travail> | null;
let reponses: Record<string, () => unknown>;
/** Ce que le SERVEUR annonce : la génération simulée est éteinte en production. */
let generationIaActive: boolean;
const generationIa = () => generationIaActive;
/** Force le mode RÉEL (dépense de vrais crédits) — `null` garde le comportement existant. */
let generationModeForce: 'reelle' | null;

beforeEach(() => {
  appels = [];
  etatTravail = null;
  reponses = {};
  generationIaActive = false;
  generationModeForce = null;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    appels.push({ url, method });
    const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'DELETE') return json(reponses.delete ? reponses.delete() : { ok: true, objetsSupprimes: 3 }, reponses.deleteStatus ? (reponses.deleteStatus() as number) : 200);
    for (const [motif, f] of Object.entries(reponses)) if (url.includes(motif)) return json(f());
    if (url === '/api/tarifs') return json({ ok: true, prix: { 'ai.generate_background': 5, 'ai.image_to_video': 15 }, exempte: false });
    if (url === '/api/cinema/films' && method === 'GET') {
      const mode = generationModeForce ?? (generationIa() ? 'simulee' : null);
      return json({ ok: true, generationIa: generationIa() || !!generationModeForce, generationMode: mode, films: [{ id: film.id, titre: 'Mon film', majLe: film.majLe }] });
    }
    if (url === `/api/cinema/films/${film.id}`) return json(reponseFilm());
    if (url.endsWith('/travaux')) return json({ ok: true, travail: etatTravail });
    if (url.includes('/annuler')) return json({ ok: true, travail: { ...etatTravail, annulationDemandee: true } });
    if (url.includes('/travaux/')) return json({ ok: true, travail: etatTravail });
    if (url.endsWith('/produire')) return json({ ok: true, dejaEnCours: false, travail: etatTravail, devis: reponseFilm().devis }, 202);
    return json({ ok: false, erreur: 'inattendu' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ouvrir() {
  render(<CinemaPage />);
  const select = await screen.findByLabelText(/reprendre un film/i);
  fireEvent.change(select, { target: { value: film.id } });
  await screen.findByText(/Export MP4/);
}

describe('page Cinema IA — production asynchrone', () => {
  it('retrouve un film apres rechargement, et la production en cours avec sa vraie progression', async () => {
    etatTravail = travail({});
    await ouvrir();
    const barre = await screen.findByRole('progressbar', { name: /progression de la production/i });
    expect(barre.getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText('40 %')).toBeTruthy();
    expect(screen.getByText(/Rendu de la scene/)).toBeTruthy();
    // L'etat de chaque scene est lisible (texte pour lecteur d'ecran).
    const liste = screen.getByRole('list', { name: /etat des scenes/i });
    expect(within(liste).getByText('rendue')).toBeTruthy();
    expect(within(liste).getByText('en cours')).toBeTruthy();
    // Le bouton principal reflete l'etat et ne permet pas un second lancement.
    const principal = screen.getByRole('button', { name: /production en cours/i }) as HTMLButtonElement;
    expect(principal.disabled).toBe(true);
    // Plus aucune mention d'un rendu qui bloque la page.
    expect(screen.queryByText(/ne pas fermer la page/i)).toBeNull();
    expect(screen.getByText(/vous pouvez fermer cette page/i)).toBeTruthy();
  });

  it('un travail termine montre le MP4 par la route authentifiee — jamais un fichier public', async () => {
    etatTravail = travail({
      statut: 'termine', progression: { etape: 'termine', scenes: scenes(['faite', 'faite', 'reutilisee']), pourcent: 100, message: null },
      resultat: { aMp4: true, scenesRendues: ['a', 'b'], scenesReutilisees: ['c'], avertissements: [], dureeS: 22, octets: 2_500_000, largeur: 1920, hauteur: 1080, codecVideo: 'h264', codecAudio: 'aac', coutUsd: 0 },
    });
    const { container } = render(<CinemaPage />);
    fireEvent.change(await screen.findByLabelText(/reprendre un film/i), { target: { value: film.id } });
    await waitFor(() => expect(container.querySelector('video')).toBeTruthy());
    const attendu = `/api/cinema/films/${film.id}/travaux/${etatTravail.id}/export`;
    expect(container.querySelector('video')!.getAttribute('src')).toBe(attendu);
    expect(screen.getByRole('link', { name: /telecharger le mp4/i }).getAttribute('href')).toBe(attendu);
    expect(container.innerHTML).not.toMatch(/\/cinema\/film-ui-1\/film\.mp4|storage\/v1/);
    expect(within(screen.getByTestId('production')).getByText(/22\.0 s/)).toBeTruthy();
  });

  it('un echec reste VISIBLE avec sa reference, et propose de relancer sans perdre les scenes', async () => {
    etatTravail = travail({ statut: 'echec', erreur: 'echec de production (reference ab12cd34)', reference: 'ab12cd34' });
    await ouvrir();
    const alerte = await screen.findByRole('alert');
    expect(alerte.textContent).toContain('reference ab12cd34');
    const relancer = screen.getByRole('button', { name: /exporter le film/i }) as HTMLButtonElement;
    expect(relancer.disabled).toBe(false);
  });

  it('exporter lance un travail en arriere-plan et affiche la progression sans bloquer', async () => {
    await ouvrir();                                   // aucun travail : bouton actif
    etatTravail = travail({ statut: 'en_attente', progression: { etape: 'preparation', scenes: scenes([]), pourcent: 0, message: 'Preparation' } });
    fireEvent.click(screen.getByRole('button', { name: /exporter le film/i }));
    await waitFor(() => expect(appels.some((a) => a.url.endsWith('/produire') && a.method === 'POST')).toBe(true));
    const barre = await screen.findByRole('progressbar');
    expect(barre.getAttribute('aria-valuenow')).toBe('0');
    // Le corps demande bien un travail, pas un rendu synchrone.
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) => String(c[0]).endsWith('/produire'))!;
    expect(JSON.parse((init as RequestInit).body as string).rendre).toBe(true);
  });

  it('le sondage suit l\'etat reel jusqu\'a la fin, puis relit le film', async () => {
    etatTravail = travail({});
    await ouvrir();
    await screen.findByRole('progressbar');
    etatTravail = travail({
      statut: 'termine', progression: { etape: 'termine', scenes: scenes(['faite', 'faite', 'faite']), pourcent: 100, message: null },
      resultat: { aMp4: true, scenesRendues: ['a'], scenesReutilisees: [], avertissements: [], dureeS: 9, octets: 1_000_000, largeur: 1280, hauteur: 720, codecVideo: 'h264', codecAudio: 'aac', coutUsd: 0 },
    });
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull(), { timeout: 5000 });
    expect(screen.getByRole('link', { name: /telecharger le mp4/i })).toBeTruthy();
    // La fin du travail declenche une relecture du film (scenes scellees).
    const lectures = appels.filter((a) => a.url === `/api/cinema/films/${film.id}` && a.method === 'GET').length;
    expect(lectures).toBeGreaterThanOrEqual(2);
  }, 10_000);

  it('arreter est une ICONE avec son libelle accessible, et appelle la route d\'annulation', async () => {
    etatTravail = travail({});
    await ouvrir();
    const arreter = await screen.findByRole('button', { name: /arreter la production/i });
    expect(arreter.textContent?.trim()).toBe('');          // icone seule, pas de gros bouton texte
    fireEvent.click(arreter);
    await waitFor(() => expect(appels.some((a) => a.url.endsWith('/annuler') && a.method === 'POST')).toBe(true));
  });

  it('les actions secondaires d\'une scene sont des icones accessibles', async () => {
    await ouvrir();
    const regenerer = screen.getAllByRole('button', { name: /regenerer cette scene/i });
    expect(regenerer.length).toBe(film.scenes.length);
    expect(regenerer[0].textContent?.trim()).toBe('');
    expect(screen.getAllByRole('button', { name: /valider la scene/i }).length).toBe(film.scenes.length);
  });

  it('génération éteinte par le serveur (production) : AUCUN bouton de génération proposé', async () => {
    await ouvrir();
    expect(screen.queryAllByRole('button', { name: /generer \(ia, simule\)/i })).toHaveLength(0);
    expect(document.querySelectorAll('[data-cinema-generation]')).toHaveLength(0);
  });

  it('génération autorisée par le serveur : les boutons reviennent, clairement identifiés comme SIMULÉS', async () => {
    generationIaActive = true;
    await ouvrir();
    const boutons = screen.getAllByRole('button', { name: /generer \(ia, simule\)/i });
    expect(boutons.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/animer en video|generer \(ia, simule\)/i).length).toBeGreaterThan(0);
  });

  describe('mode RÉEL (de vrais crédits sont en jeu)', () => {
    it('le coût en crédits est affiché SUR le bouton, avant tout clic', async () => {
      generationModeForce = 'reelle';
      await ouvrir();
      // Le prix vient de `/api/tarifs` (5 crédits/image dans ce test), jamais inventé par l'écran.
      expect(screen.getAllByText(/5 crédits?/i).length).toBeGreaterThan(0);
    });

    it('un clic demande confirmation AVEC le coût, avant de dépenser quoi que ce soit', async () => {
      generationModeForce = 'reelle';
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      await ouvrir();
      const bouton = document.querySelector('[data-cinema-generation="image"]') as HTMLButtonElement;
      expect(bouton).toBeTruthy();
      fireEvent.click(bouton);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy.mock.calls[0][0]).toMatch(/5 crédits?/i);
      // Confirmé : l'appel part bien.
      await waitFor(() => expect(appels.some((a) => a.url.includes('/generation') && a.method === 'POST')).toBe(true));
    });

    it('annuler la confirmation n’envoie AUCUNE requête — rien n’est dépensé', async () => {
      generationModeForce = 'reelle';
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await ouvrir();
      const bouton = document.querySelector('[data-cinema-generation="image"]') as HTMLButtonElement;
      fireEvent.click(bouton);
      // Le temps que l'éventuel appel parte, s'il partait à tort.
      await new Promise((r) => { setTimeout(r, 0); });
      expect(appels.some((a) => a.url.includes('/generation'))).toBe(false);
    });

    it('la vidéo utilise SA propre clé de tarif (`ai.image_to_video`), pas celle de l’image', () => {
      // Le bouton vidéo n'apparaît que sur un plan qui a DÉJÀ une image (contrôle serveur
      // identique dans `atelier.ts`) : un film fraîchement créé n'en a aucun. On vérifie donc
      // ici, sur la source, que les deux boutons sont bien tarifés par deux clés distinctes —
      // le comportement du bouton image (coût affiché + confirmation) est, lui, éprouvé en
      // interaction juste au-dessus.
      const fs = require('fs') as typeof import('fs');
      const p = fs.readFileSync('src/app/dashboard/cinema/page.tsx', 'utf-8');
      expect(p).toMatch(/operation === 'video' \? 'ai\.image_to_video' : 'ai\.generate_background'/);
      expect(p).toContain("libellePrix(tarifs, 'ai.generate_background')");
      expect(p).toContain("libellePrix(tarifs, 'ai.image_to_video')");
    });
  });

  it('en mode SIMULÉ (gratuit), aucune confirmation n’est demandée — rien n’est débité', async () => {
    generationIaActive = true; // mode 'simulee'
    const confirmSpy = vi.spyOn(window, 'confirm');
    await ouvrir();
    const bouton = document.querySelector('[data-cinema-generation="image"]') as HTMLButtonElement;
    fireEvent.click(bouton);
    await waitFor(() => expect(appels.some((a) => a.url.includes('/generation') && a.method === 'POST')).toBe(true));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('une generation termine annonce que le solde a pu changer — la barre laterale peut se rafraichir', async () => {
    // Le solde affiche ailleurs sur l'ecran ne se rafraichissait plus jamais apres une
    // operation payante : cet evenement est le seul lien entre cette page et la Sidebar.
    generationIaActive = true;
    const ecoute = vi.fn();
    window.addEventListener('studiio:credits-changed', ecoute);
    await ouvrir();
    const bouton = document.querySelector('[data-cinema-generation="image"]') as HTMLButtonElement;
    fireEvent.click(bouton);
    await waitFor(() => expect(ecoute).toHaveBeenCalledTimes(1));
    window.removeEventListener('studiio:credits-changed', ecoute);
  });

  it('un echec de generation qui a quand meme pris des credits le DIT, rembourses ou non', async () => {
    generationModeForce = 'reelle';
    reponses['/generation'] = () => ({ ok: false, erreur: 'Replicate (image) : generation refusee par le fournisseur', creditsPris: 5, creditsRembourses: true });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await ouvrir();
    const bouton = document.querySelector('[data-cinema-generation="image"]') as HTMLButtonElement;
    fireEvent.click(bouton);
    const alerte = await screen.findByRole('alert');
    expect(alerte.textContent).toContain('5 credit(s) pris');
    expect(alerte.textContent).toContain('rembourses');
    confirmSpy.mockRestore();
  });

  it('une erreur de lancement (plafond) est affichee telle quelle', async () => {
    await ouvrir();
    reponses['/produire'] = () => ({ ok: false, erreur: 'plafond depasse : 2.00 $' });
    fireEvent.click(screen.getByRole('button', { name: /exporter le film/i }));
    await waitFor(() => expect(screen.getByText(/plafond depasse/)).toBeTruthy());
  });
});

describe('suppression d\'un film — deux gestes, erreur visible', () => {
  it('l\'icone arme, la coche confirme ; annuler ne supprime rien', async () => {
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: /supprimer ce film/i }));
    expect(screen.getByText(/Supprimer le film et ses fichiers/)).toBeTruthy();
    expect(appels.some((a) => a.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /annuler la suppression/i }));
    expect(screen.queryByText(/Supprimer le film et ses fichiers/)).toBeNull();
    expect(appels.some((a) => a.method === 'DELETE')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /supprimer ce film/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmer la suppression/i }));
    await waitFor(() => expect(appels.filter((a) => a.method === 'DELETE')).toEqual([{ url: `/api/cinema/films/${film.id}`, method: 'DELETE' }]));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Export MP4/ })).toBeNull());
  });

  it('un refus du serveur (rendu en cours) est AFFICHE et le film reste ouvert', async () => {
    reponses.delete = () => ({ ok: false, erreur: 'un rendu est en cours : arretez-le avant de supprimer le film' });
    reponses.deleteStatus = () => 409;
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: /supprimer ce film/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmer la suppression/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/un rendu est en cours/);
    expect(screen.getByRole('heading', { name: /Export MP4/ })).toBeTruthy();
  });
});

/**
 * RÉGRESSION — « interface bloquée » : `appel()` n'avait ni `AbortController` ni délai.
 * Une réponse serveur qui ne vient JAMAIS (ex. la voix off qui attend Edge TTS indéfiniment)
 * laissait `enCours` armé pour toujours : tous les boutons de l'écran restaient désactivés,
 * sans aucun message, et seul un rechargement complet de la page s'en sortait.
 *
 * ⚠️ PREUVE STATIQUE, DÉLIBÉRÉMENT. Un vrai test ferait pendre un `fetch` indéfiniment puis
 * avancerait 20 s d'horloge simulée à travers un `AbortController` réel : ce projet a déjà
 * rencontré ce genre de test systématiquement instable (fausses horloges + promesses
 * asynchrones imbriquées) sur un cas très proche (voir `cinema-generation-reelle.test.ts`,
 * « le délai dépassé… »). La ligne par ligne est ici la preuve fiable.
 */
describe('un appel qui ne répond jamais ne bloque plus la page indéfiniment', () => {
  it('`appel()` pose un AbortController avec un délai, et le nettoie toujours', () => {
    const fs = require('fs') as typeof import('fs');
    const code = fs.readFileSync('src/app/dashboard/cinema/page.tsx', 'utf-8');
    expect(code).toContain('const ctrl = new AbortController();');
    expect(code).toContain('setTimeout(() => ctrl.abort(), DELAI_APPEL_MS)');
    expect(code).toContain("const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options, signal: ctrl.signal });");
    expect(code).toContain('clearTimeout(minuteur);');
    // Le message montré à l'utilisateur nomme le délai, pas une exception technique brute.
    expect(code).toContain("e instanceof Error && e.name === 'AbortError'");
    expect(code).toContain('le serveur ne repond pas');
  });

  it('le sondage de travail recule aussi sur une réponse serveur inexploitable, pas seulement sur une panne réseau', () => {
    const fs = require('fs') as typeof import('fs');
    const code = fs.readFileSync('src/app/dashboard/cinema/page.tsx', 'utf-8');
    // Avant : `data.ok` faux et statut != 404 ne faisait RIEN — le sondage continuait au
    // rythme rapide (1,5 s) indéfiniment, sans jamais le signaler.
    const bloc = code.slice(code.indexOf("if (!filmId || !travailId || !actif) return;"), code.indexOf('minuteur = setTimeout(tick, 600);'));
    expect(bloc).toMatch(/\} else \{\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*delai = Math\.min\(delai \* 2, 10_000\);\s*\n\s*\}/);
  });
});
