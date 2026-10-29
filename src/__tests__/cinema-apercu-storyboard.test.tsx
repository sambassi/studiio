/**
 * CINEMA IA — l'aperçu ne fait plus passer un texte pour une vidéo.
 *
 * Cause de l'ancien « grand écran violet » : le lecteur dessinait la carte du plan (dégradé
 * violet + titre + description) même sans aucun média. Ici : storyboard honnête sans média,
 * vrai média calé sur la chronologie avec média, démonstration gratuite sans rien enregistrer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import CinemaPage from '@/app/dashboard/cinema/page';
import { preparerFilm } from '@/lib/cinema/atelier';
import { monterFilm } from '@/lib/cinema/montage';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { devisFilm } from '@/lib/cinema/couts';
import { appliquerDemo, bilanMedias, CLIPS_DEMO } from '@/components/cinema/ApercuStoryboard';
import type { Film } from '@/lib/cinema/types';

const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Marco hoche la tete. Le jour se leve sur la salle vide.';
const base = (format: '16:9' | '9:16' = '16:9'): Film => ({
  ...preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: 'film-apercu', titre: 'Mon film', format }),
  proprietaire: 'u1',
});
const avecMedia = (f: Film, n: number, o: { sonActif?: boolean; genre?: 'video' | 'image' } = {}): Film => {
  const c = structuredClone(f);
  const plans = c.scenes.flatMap((s) => s.plans);
  for (let i = 0; i < n; i++) {
    plans[i].media = { url: `cinema/film-apercu/medias/m${i}.${o.genre === 'image' ? 'png' : 'mp4'}`, genre: o.genre ?? 'video', largeur: 1280, hauteur: 720, dureeS: o.genre === 'image' ? null : 3, octets: 10, origine: 'import', ...(o.sonActif ? { sonActif: true } : null) } as never;
  }
  return c;
};

let courant: Film;
let appels: Array<{ url: string; method: string }>;
beforeEach(() => {
  appels = [];
  courant = base();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    appels.push({ url, method });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/tarifs') return json({ ok: true, prix: {}, exempte: false });
    if (url === '/api/cinema/films' && method === 'GET') return json({ ok: true, generationIa: false, generationMode: null, films: [{ id: courant.id, titre: 'Mon film', majLe: courant.majLe }] });
    if (url === `/api/cinema/films/${courant.id}`) {
      return json({ ok: true, film: { ...courant, generations: [] }, montage: presenterMontage(monterFilm(courant), courant.id), scenesAProduire: courant.scenes.map((s) => s.id), devis: devisFilm(courant, courant.scenes.map((s) => s.id)) });
    }
    if (url.includes('/travaux')) return json({ ok: true, travail: null });
    return json({ ok: false, erreur: 'inattendu' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ouvrir() {
  render(<CinemaPage />);
  fireEvent.change(await screen.findByLabelText(/reprendre un film/i), { target: { value: courant.id } });
  await screen.findByText(/Export MP4/);
}
const zone = () => document.querySelector('[aria-label="Storyboard du film"]') as HTMLElement;

describe('sans aucun média : un storyboard honnête, jamais une fausse vidéo', () => {
  it('titre « Prévisualisation du scénario », dit que ce n’est pas un film, aucun dégradé violet', async () => {
    await ouvrir();
    expect(screen.getByText(/6\. Prévisualisation du scénario/)).toBeTruthy();
    expect(screen.getByText(/pas un film/)).toBeTruthy();
    expect(screen.getByText('Média manquant')).toBeTruthy();
    expect(screen.getAllByText('Prévisualisation').length).toBeGreaterThan(0);
    // Le fond du cadre est sombre et neutre : plus de dégradé violet imitant un écran de film.
    const cadre = document.querySelector('section .relative.overflow-hidden.rounded-xl') as HTMLElement;
    expect(cadre.style.background).not.toMatch(/radial-gradient/);
    expect(document.querySelector('video')).toBeNull();
  });

  it('un storyboard : une vignette par plan, chacune annoncée « média manquant », cliquable', async () => {
    await ouvrir();
    const plans = courant.scenes.flatMap((s) => s.plans);
    const vignettes = within(zone()).getAllByRole('button');
    expect(vignettes).toHaveLength(plans.length);
    for (const v of vignettes) expect(v.getAttribute('aria-label')).toMatch(/média manquant/);
    fireEvent.click(vignettes[2]);
    expect(vignettes[2].getAttribute('aria-current')).toBe('true');
  });

  it('plus de texte superposé inutile : pas de filigrane « STUDIIO CINEMA IA » ni de lieu — cadre dans l’image', async () => {
    await ouvrir();
    expect(screen.queryByText('STUDIIO CINEMA IA')).toBeNull();
  });
});

describe('avec des médias : le VRAI fichier est affiché', () => {
  it('une vidéo réelle est montée dans le lecteur, calée et sans titre « prévisualisation »', async () => {
    courant = avecMedia(base(), 3);
    await ouvrir();
    const cadre = document.querySelector('section .relative.overflow-hidden.rounded-xl') as HTMLElement;
    const v = cadre.querySelector('video') as HTMLVideoElement;
    expect(v.getAttribute('src')).toMatch(/^\/api\/cinema\/films\/film-apercu\/medias\//);
    expect(screen.queryByText(/Prévisualisation du scénario/)).toBeNull();
    expect(screen.getByText(/3 plans sur \d+ avec média · \d+ manquants?/)).toBeTruthy();
    // Les plans sans média sont signalés comme tels, les autres non.
    const labels = within(zone()).getAllByRole('button').map((b) => b.getAttribute('aria-label')!);
    expect(labels.filter((l) => /manquant/.test(l))).toHaveLength(labels.length - 3);
  });

  it('une image réelle est affichée telle quelle', async () => {
    courant = avecMedia(base(), 1, { genre: 'image' });
    await ouvrir();
    const cadre = document.querySelector('section .relative.overflow-hidden.rounded-xl') as HTMLElement;
    expect(cadre.querySelector('img')?.getAttribute('src')).toMatch(/^\/api\/cinema\/films\/film-apercu\/medias\//);
  });

  it('le son n’est proposé que si un plan le garde ; couper/activer bascule', async () => {
    courant = avecMedia(base(), 2);
    await ouvrir();
    expect(screen.queryByLabelText(/Couper le son|Activer le son/)).toBeNull();
    cleanup();
    courant = avecMedia(base(), 2, { sonActif: true });
    await ouvrir();
    const b = screen.getByLabelText('Couper le son');
    fireEvent.click(b);
    expect(screen.getByLabelText('Activer le son').getAttribute('aria-pressed')).toBe('true');
  });

  it('tous les plans ont un média : pas de bouton de démonstration', async () => {
    const f = base(); const n = f.scenes.flatMap((s) => s.plans).length;
    courant = avecMedia(f, n);
    await ouvrir();
    expect(screen.queryByText(/Mode démonstration/)).toBeNull();
    expect(screen.getByText(/vrais fichiers/)).toBeTruthy();
  });

  it('format 9:16 : le cadre reste vertical, en ligne comme agrandi', async () => {
    courant = avecMedia(base('9:16'), 2);
    await ouvrir();
    const cadre = document.querySelector('section .relative.overflow-hidden.rounded-xl') as HTMLElement;
    expect(cadre.style.aspectRatio.replace(/\s/g, '')).toMatch(/9\/16|0\.5625/);
    fireEvent.click(screen.getByLabelText(/Agrandir/));
    const fen = screen.getByRole('dialog');
    const grand = fen.querySelector('.relative.overflow-hidden.rounded-xl') as HTMLElement;
    expect(grand.style.aspectRatio.replace(/\s/g, '')).toMatch(/9\/16|0\.5625/);
    expect(grand.querySelector('video')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
  });
});

describe('mode démonstration : gratuit, à l’écran, rien d’enregistré', () => {
  it('remplace SEULEMENT les médias manquants, par des clips locaux, avec un badge explicite — zéro appel', async () => {
    courant = avecMedia(base(), 1);
    await ouvrir();
    const avant = appels.length;
    fireEvent.click(screen.getByRole('button', { name: /Mode démonstration/ }));
    // Plus aucun « média manquant » dans le storyboard ; le premier plan garde SON média.
    const labels = within(zone()).getAllByRole('button').map((b) => b.getAttribute('aria-label')!);
    expect(labels.some((l) => /manquant/.test(l))).toBe(false);
    expect(labels.filter((l) => /média d’exemple/.test(l))).toHaveLength(labels.length - 1);
    // Chaque vignette de démonstration porte son étiquette « démo » (jamais confondue avec un vrai média).
    expect(within(zone()).getAllByText('démo')).toHaveLength(labels.length - 1);
    // Un plan de démonstration est annoncé comme tel dans le cadre.
    fireEvent.click(within(zone()).getAllByRole('button')[3]);
    expect(screen.getByText(/Démonstration · clip d’exemple/)).toBeTruthy();
    const v = document.querySelector('section .relative.overflow-hidden.rounded-xl video') as HTMLVideoElement;
    expect(CLIPS_DEMO).toContain(v.getAttribute('src'));
    // Rien n'est parti vers le serveur : ni génération, ni enregistrement.
    expect(appels.slice(avant)).toEqual([]);
    // Le bilan reste celui du film réel.
    expect(screen.getByText(/1 plan sur \d+ avec média/)).toBeTruthy();
    // On peut en sortir.
    fireEvent.click(screen.getByRole('button', { name: /Quitter la démonstration/ }));
    expect(within(zone()).getAllByRole('button').some((b) => /manquant/.test(b.getAttribute('aria-label')!))).toBe(true);
  });

  it('sans aucun média, la démonstration montre des clips mais le titre reste honnête sur le film', async () => {
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: /Mode démonstration/ }));
    expect(screen.getByText(/Aucune image ni vidéo/)).toBeTruthy();
    expect(document.querySelector('video')).toBeTruthy();
  });
});

describe('les clips de démonstration existent vraiment, et sont locaux', () => {
  it('quatre clips mp4 h264 légers dans public/cinema-demo', () => {
    expect(CLIPS_DEMO).toHaveLength(4);
    for (const url of CLIPS_DEMO) {
      const f = `public${url}`;
      expect(statSync(f).size).toBeGreaterThan(5_000);
      expect(statSync(f).size).toBeLessThan(500_000);
      expect(readFileSync(f).subarray(4, 8).toString()).toBe('ftyp');
    }
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', 'public/cinema-demo/demo-1.mp4'], { encoding: 'utf8' });
    if (p.status === 0) expect(p.stdout.trim()).toBe('h264');
  });

  it('appliquerDemo / bilanMedias : purs, ne modifient pas leur entrée', () => {
    const seg = [{ planId: 'a', media: null }, { planId: 'b', media: { url: 'x.mp4', genre: 'video' as const } }, { planId: 'c', media: null }] as never[];
    const copie = JSON.stringify(seg);
    const d = appliquerDemo(seg, true) as Array<{ media: { url: string } | null; demo?: boolean }>;
    expect(JSON.stringify(seg)).toBe(copie);
    expect(d[0].demo).toBe(true); expect(d[1].demo).toBeUndefined(); expect(d[1].media!.url).toBe('x.mp4'); expect(d[2].demo).toBe(true);
    expect(d[0].media!.url).not.toBe(d[2].media!.url);
    expect(appliquerDemo(seg, false)).toEqual(seg);
    expect(bilanMedias(seg)).toEqual({ total: 3, avecMedia: 1, manquants: 2, aucun: false });
    expect(bilanMedias([{ media: null }]).aucun).toBe(true);
    expect(bilanMedias([]).aucun).toBe(false);
  });
});
