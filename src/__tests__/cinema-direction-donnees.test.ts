// @vitest-environment node
/**
 * CINEMA IA — style et camera dans les DONNEES du projet : creation, modification,
 * sauvegarde, reouverture, regeneration, reprise, anciens films, et zero depense.
 *
 * Routes reelles sur un contexte en memoire (comme `cinema-routes.test.ts`). Le seul double
 * est le fournisseur de generation, qui CAPTURE ce qu'il recoit et n'engage rien.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import path, { join } from 'path';
import { NextRequest } from 'next/server';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId, email: 'x@example.org' } } : null),
}));
process.env.CINEMA_ACTIVE = 'true';
process.env.CINEMA_GENERATION_SIMULEE = 'true';

import { depotFilmsMemoire, modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { objetsMemoire } from '@/lib/cinema/stockage/objets';
import { depotTravauxMemoire } from '@/lib/cinema/travaux/depot-travaux';
import { reinitialiserLanceurPourTests, attendreFile } from '@/lib/cinema/travaux/lanceur';
import type { ContexteCinema } from '@/lib/cinema/contexte';
import * as filmsRoute from '@/app/api/cinema/films/route';
import * as filmRoute from '@/app/api/cinema/films/[id]/route';
import * as generationRoute from '@/app/api/cinema/films/[id]/generation/route';
import { attendreGenerations } from '@/lib/cinema/generation/executeur-generation';
import {
  enregistrerFournisseur, type DemandeImageGeneration, type DemandeVideoGeneration,
} from '@/lib/cinema/generation/fournisseur';
import { ID_FOURNISSEUR_SIMULE } from '@/lib/cinema/generation/simule';
import { appliquerPatch, erreurPatch } from '@/lib/cinema/patch';
import { preparerFilm } from '@/lib/cinema/atelier';
import { reserverGeneration } from '@/lib/cinema/generation/suivi';
import { reprendreGenerationsInterrompues } from '@/lib/cinema/generation/reprise';
import { executer } from '@/lib/cinema/rendu-local';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import { blocStyle } from '@/lib/cinema/direction/prompt';
import { styleCinema } from '@/lib/cinema/direction/styles';
import { cameraCinema } from '@/lib/cinema/direction/camera';
import type { Film } from '@/lib/cinema/types';

const A = '11111111-1111-4111-8111-111111111111';
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Marco hoche la tete. Le jour se leve sur la salle vide.';
const PERSONNAGES = [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }];
const OUTILS = spawnSync(cheminFfmpeg(), ['-version']).status === 0 && spawnSync(cheminFfprobe(), ['-version']).status === 0;

const P = (id: string) => ({ params: { id } }) as never;
const req = (url: string, init: { method?: string; json?: unknown } = {}) => new NextRequest(`http://localhost${url}`, {
  method: init.method ?? 'GET', headers: { 'content-type': 'application/json' }, body: init.json === undefined ? undefined : JSON.stringify(init.json),
});

let ctx: ContexteCinema;
let racine: string;
const appels = { image: [] as DemandeImageGeneration[], video: [] as DemandeVideoGeneration[], fetch: 0 };

beforeEach(async () => {
  racine = await mkdtemp(path.join(tmpdir(), 'cinema-dir-donnees-'));
  appels.image.length = 0; appels.video.length = 0; appels.fetch = 0;
  vi.stubGlobal('fetch', vi.fn(async () => { appels.fetch++; throw new Error('aucun appel reseau attendu'); }));
  // Le fournisseur SIMULE du serveur est remplace par un double qui capture et n'engage rien.
  enregistrerFournisseur({
    id: ID_FOURNISSEUR_SIMULE, libelle: 'double', actif: true,
    async genererImage(d) { appels.image.push(d); return { ok: false, erreur: 'double', jamaisEnvoye: true }; },
    async genererVideo(d) { appels.video.push(d); return { ok: false, erreur: 'double', jamaisEnvoye: true }; },
  });
  ctx = {
    mode: 'local', films: depotFilmsMemoire(), travaux: depotTravauxMemoire(), objets: objetsMemoire(),
    racine, dossierTravail: path.join(racine, 'var', 'cinema', 'travail'), plafondUsd: 2,
    moteurs: {} as never, ressources: { lire: () => ({ rendusEnCours: 0, ramLibreMo: 64_000, cpus: 8 }), pause: async () => {} },
  };
  (globalThis as unknown as { __cinemaContexte?: ContexteCinema }).__cinemaContexte = ctx;
  session.userId = A;
});
afterEach(async () => {
  await attendreGenerations().catch(() => {});
  await attendreFile().catch(() => {});
  reinitialiserLanceurPourTests();
  delete (globalThis as unknown as { __cinemaContexte?: ContexteCinema }).__cinemaContexte;
  vi.unstubAllGlobals();
  await rm(racine, { recursive: true, force: true });
});

async function creer(extra: Record<string, unknown> = {}) {
  return filmsRoute.POST(req('/api/cinema/films', { method: 'POST', json: { titre: 'T', histoire: HISTOIRE, nbScenes: 3, personnages: PERSONNAGES, ...extra } }));
}
const lireFilm = async (id: string): Promise<Film> => (await (await filmRoute.GET(req(`/api/cinema/films/${id}`), P(id))).json()).film;
const patch = (id: string, json: unknown) => filmRoute.PATCH(req(`/api/cinema/films/${id}`, { method: 'PATCH', json }), P(id));

describe('creation : le style global est sauvegarde avec le film', () => {
  it('un style valide est enregistre, renvoye et relu a la reouverture', async () => {
    const r = await creer({ styleCinema: 'noir' });
    expect(r.status).toBe(200);
    const { film } = await r.json();
    expect(film.styleCinema).toBe('noir');
    expect((await lireFilm(film.id)).styleCinema).toBe('noir');
    // Film neuf : camera automatique par defaut (un film d'avant n'a pas ce drapeau).
    expect(film.directionActive).toBe(true);
    expect((await lireFilm(film.id)).directionActive).toBe(true);
    expect((await ctx.films.lire(film.id, A))!.film.styleCinema).toBe('noir');
  });

  it('sans style (ou null) : AUCUN champ ajoute au film', async () => {
    for (const extra of [{}, { styleCinema: null }]) {
      const { film } = await (await creer(extra)).json();
      expect('styleCinema' in film).toBe(false);
    }
  });

  it('un style inconnu est refuse (400), aucun film n’est cree', async () => {
    const r = await creer({ styleCinema: 'psychedelique' });
    expect(r.status).toBe(400);
    expect(await ctx.films.lister(A)).toHaveLength(0);
  });
});

describe('modification : style du film, exception de scene, camera de plan', () => {
  it('chaque reglage est enregistre, relu, et retire sur demande', async () => {
    const { film } = await (await creer()).json();
    const f0 = film as Film;
    const [sceneId, planId] = [f0.scenes[0].id, f0.scenes[0].plans[0].id];

    expect((await patch(film.id, { style: 'romantique' })).status).toBe(200);
    expect((await patch(film.id, { scenes: [{ id: sceneId, style: 'scifi' }] })).status).toBe(200);
    expect((await patch(film.id, { plans: [{ id: planId, camera: 'orbite' }] })).status).toBe(200);

    const relu = await lireFilm(film.id);
    expect(relu.styleCinema).toBe('romantique');
    expect(relu.scenes[0].styleCinema).toBe('scifi');
    expect(relu.scenes[1].styleCinema).toBeUndefined();
    expect(relu.scenes[0].plans[0].camera).toBe('orbite');

    // Retrait : `null` efface le style ; `auto` retire la camera (l'absence EST l'automatique).
    await patch(film.id, { style: null });
    await patch(film.id, { scenes: [{ id: sceneId, style: null }] });
    await patch(film.id, { plans: [{ id: planId, camera: 'auto' }] });
    const efface = await lireFilm(film.id);
    expect('styleCinema' in efface).toBe(false);
    expect('styleCinema' in efface.scenes[0]).toBe(false);
    expect('camera' in efface.scenes[0].plans[0]).toBe(false);
  });

  it.each([
    [{ style: 'inconnu' }, /style de film/],
    [{ scenes: [{ id: 'x', style: 'inconnu' }] }, /style de scene/],
    [{ plans: [{ id: 'x', camera: 'zoom_fou' }] }, /mouvement de camera/],
  ])('valeur inconnue %j : refusee (400), rien n’est modifie', async (corps, motif) => {
    const { film } = await (await creer({ styleCinema: 'noir' })).json();
    const r = await patch(film.id, corps);
    expect(r.status).toBe(400);
    expect((await r.json()).erreur).toMatch(motif);
    expect((await lireFilm(film.id)).styleCinema).toBe('noir');
    expect(erreurPatch(corps)).toMatch(motif);
  });

  it('modifier un reglage ne touche ni personnages, ni repliques, ni lieux, ni durees', async () => {
    const { film } = await (await creer()).json();
    const avant = JSON.parse(JSON.stringify(film)) as Film;
    await patch(film.id, { style: 'documentaire', scenes: [{ id: avant.scenes[0].id, style: 'noir' }], plans: [{ id: avant.scenes[0].plans[0].id, camera: 'fixe' }] });
    const apres = await lireFilm(film.id);
    expect(apres.personnages).toEqual(avant.personnages);
    expect(apres.histoire).toBe(avant.histoire);
    for (const [i, s] of apres.scenes.entries()) {
      expect(s.lieu).toBe(avant.scenes[i].lieu);
      expect(s.titre).toBe(avant.scenes[i].titre);
      expect(s.intention).toBe(avant.scenes[i].intention);
      expect(s.empreinte).toBe(avant.scenes[i].empreinte);
      for (const [k, p] of s.plans.entries()) {
        expect(p.description).toBe(avant.scenes[i].plans[k].description);
        expect(p.dialogue).toEqual(avant.scenes[i].plans[k].dialogue);
        expect(p.dureeS).toBe(avant.scenes[i].plans[k].dureeS);
      }
    }
  });

  it('un autre reglage du MEME film (texte d’un plan, validation de scene) conserve les choix', async () => {
    const { film } = await (await creer({ styleCinema: 'scifi' })).json();
    const f0 = film as Film;
    await patch(film.id, { plans: [{ id: f0.scenes[0].plans[0].id, camera: 'pano_droite' }], scenes: [{ id: f0.scenes[1].id, style: 'noir' }] });
    await patch(film.id, { plans: [{ id: f0.scenes[0].plans[0].id, texte: 'Nina traverse la salle.' }], scenes: [{ id: f0.scenes[0].id, etat: 'validee' }] });
    const f = await lireFilm(film.id);
    expect(f.styleCinema).toBe('scifi');
    expect(f.scenes[0].plans[0].camera).toBe('pano_droite');
    expect(f.scenes[1].styleCinema).toBe('noir');
  });
});

describe('anciens films : aucun champ, aucun probleme', () => {
  it('un film d’avant se charge, se modifie et se relit sans jamais recevoir de champ de direction', async () => {
    const ancien = { ...preparerFilm({ histoire: HISTOIRE, personnages: PERSONNAGES, idFilm: 'film-ancien' }), proprietaire: A };
    expect(JSON.stringify(ancien)).not.toMatch(/styleCinema|"camera"/);
    await ctx.films.creer(ancien, A);
    const lu = await lireFilm('film-ancien');
    expect(JSON.stringify(lu)).not.toMatch(/styleCinema|"camera"/);
    expect((await patch('film-ancien', { scenes: [{ id: ancien.scenes[0].id, etat: 'validee' }] })).status).toBe(200);
    expect(JSON.stringify(await lireFilm('film-ancien'))).not.toMatch(/styleCinema|"camera"/);
    // Un corps de patch SANS direction laisse le film strictement identique (hors la modification demandee).
    expect(appliquerPatch(ancien, {})).toEqual(ancien);
  });

  it('JSON aller-retour (stockage) : les champs sont conserves tels quels', () => {
    let f = preparerFilm({ histoire: HISTOIRE, personnages: PERSONNAGES, idFilm: 'film-json' });
    f = appliquerPatch(f, { style: 'publicite', scenes: [{ id: f.scenes[0].id, style: 'noir' }], plans: [{ id: f.scenes[0].plans[0].id, camera: 'suivi_lateral' }] });
    expect(JSON.parse(JSON.stringify(f))).toEqual(f);
  });
});

describe('AUCUNE DEPENSE : choisir ne lance rien', () => {
  it('creer avec un style et regler style/camera : zero generation, zero appel reseau, zero appel fournisseur', async () => {
    const { film } = await (await creer({ styleCinema: 'noir' })).json();
    const f0 = film as Film;
    await patch(film.id, { style: 'romantique', scenes: [{ id: f0.scenes[0].id, style: 'scifi' }], plans: [{ id: f0.scenes[0].plans[0].id, camera: 'orbite' }] });
    const f = await lireFilm(film.id);
    expect(f.generations ?? []).toHaveLength(0);
    expect(f.coutGenerationUsd ?? 0).toBe(0);
    expect(f.budgetApprouve).toBeUndefined();
    expect(appels.image).toHaveLength(0);
    expect(appels.video).toHaveLength(0);
    expect(appels.fetch).toBe(0);
  });
});

describe('REGENERATION par la route : le choix courant atteint le fournisseur', () => {
  it('style change entre deux generations → le prompt change ; la camera n’est pas utilisee pour une image', async () => {
    const { film } = await (await creer({ styleCinema: 'noir' })).json();
    const planId = (film as Film).scenes[0].plans[0].id;
    const generer = async () => {
      const r = await generationRoute.POST(req(`/api/cinema/films/${film.id}/generation`, { method: 'POST', json: { planId, operation: 'image' } }), P(film.id));
      expect([202, 409]).toContain(r.status);
      await attendreGenerations();
    };
    await generer();
    await patch(film.id, { style: 'romantique' });
    await generer();
    expect(appels.image).toHaveLength(2);
    expect(appels.image[0].promptConstruit).toContain(blocStyle(styleCinema('noir')!));
    expect(appels.image[1].promptConstruit).toContain(blocStyle(styleCinema('romantique')!));
    expect(appels.image[1].promptConstruit).not.toContain(styleCinema('noir')!.prompt.profil);
    expect(appels.image[1].promptConstruit).not.toMatch(/dolly|orbit|pan to the/);
    // Le choix n'a declenche QUE les deux generations demandees.
    expect(appels.fetch).toBe(0);
  });
});

describe('REPRISE apres interruption : le film recupere garde sa direction', () => {
  it.skipIf(!OUTILS)('media livre par la reprise : style, exception et camera intacts', async () => {
    const dossier = mkdtempSync(join(tmpdir(), 'cinema-dir-reprise-'));
    try {
      const depot = depotFilmsMemoire();
      let film: Film = { ...preparerFilm({ histoire: HISTOIRE, personnages: PERSONNAGES, idFilm: 'film-rep' }), proprietaire: A };
      film = appliquerPatch(film, { style: 'noir', scenes: [{ id: film.scenes[1].id, style: 'scifi' }], plans: [{ id: film.scenes[0].plans[0].id, camera: 'travelling_arriere' }] });
      await depot.creer(film, A);
      const planId = film.scenes[0].plans[0].id;
      const r = await reserverGeneration(depot, film.id, A, { planId, operation: 'image', mode: 'reelle' });
      if (!r.ok) throw new Error('reservation');
      await modifierFilm(depot, film.id, A, (x) => ({
        ...x,
        generations: x.generations!.map((g) => ({
          ...g, statut: 'interrompue' as const, bailJusqua: null,
          externe: { fournisseurId: 'fournisseur-test', cleIdempotence: 'c', idExterne: '3f2b8c1e-9a4d-4e7f-b6a1-0c5d2e8f9a71', coutEstimeUsd: 0.04, mediaAvantUrl: null, soumisLe: new Date().toISOString() },
        })),
      }));
      const image = join(dossier, 'resultat.png');
      await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=green:s=64x64', '-frames:v', '1', '-y', image], { timeoutMs: 20_000 });
      const issues = await reprendreGenerationsInterrompues(
        { films: depot, dossierTravail: join(dossier, 'travail'), objets: { deposerFichier: async () => {}, supprimer: async () => {}, telechargerVers: async () => true } } as never,
        film.id, A,
        {
          fournisseur: () => ({ id: 'fournisseur-test', libelle: 't', actif: true, genererImage: async () => ({ ok: false as const, erreur: 'x' }), genererVideo: async () => ({ ok: false as const, erreur: 'x' }),
            consulter: async () => ({ etat: 'termine' as const, fichier: image, nomSuggere: 'resultat.png' }) }),
          confirmerDepense: async () => ({ ok: true, motif: null }), confirmerQuota: async () => ({ ok: true, motif: null }),
        } as never,
      );
      expect(issues).toEqual([{ id: r.generation.id, etat: 'livree' }]);
      const fin = (await depot.lire(film.id, A))!.film;
      expect(fin.scenes[0].plans[0].media).not.toBeNull();
      expect(fin.styleCinema).toBe('noir');
      expect(fin.scenes[1].styleCinema).toBe('scifi');
      expect(fin.scenes[0].plans[0].camera).toBe('travelling_arriere');
      expect(cameraCinema(fin.scenes[0].plans[0].camera!).prompt).toContain('dolly-out');
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  }, 60_000);
});
