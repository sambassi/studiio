// @vitest-environment node
/**
 * CINEMA IA — modifier le style ou la camera APRES une generation.
 *
 * Les medias deja generes sont conserves ; les plans dont la direction a change sont
 * signales « a regenerer » ; aucun ancien rendu n'est reutilise ; rien n'est depense sans
 * le devis habituel. Les films d'avant gardent leur comportement.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { preparerFilm } from '@/lib/cinema/atelier';
import { appliquerPatch } from '@/lib/cinema/patch';
import { empreinteScene, scenesAReproduire, scelleScene } from '@/lib/cinema/empreinte';
import { plansARegenerer, signatureDirection, signatureAncienne } from '@/lib/cinema/direction/signature';
import { importerResultatFournisseur } from '@/lib/cinema/generation/atelier';
import { genererMediaPlan } from '@/lib/cinema/generation/atelier';
import {
  enregistrerFournisseur, type DemandeImageGeneration, type DemandeVideoGeneration,
} from '@/lib/cinema/generation/fournisseur';
import { ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO } from '@/lib/cinema/generation/replicate';
import { devisFilm } from '@/lib/cinema/couts';
import { executer } from '@/lib/cinema/rendu-local';
import { depotFilmsMemoire, modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { reserverGeneration } from '@/lib/cinema/generation/suivi';
import { reprendreGenerationsInterrompues } from '@/lib/cinema/generation/reprise';
import { cheminFfmpeg, cheminFfprobe } from '@/lib/ffmpeg/binaires';
import type { Film, MediaPlan } from '@/lib/cinema/types';
import * as filmsRoute from '@/app/api/cinema/films/route';

const OUTILS = spawnSync(cheminFfmpeg(), ['-version']).status === 0 && spawnSync(cheminFfprobe(), ['-version']).status === 0;
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Marco la regarde sans bouger. Le jour se leve sur la salle vide.';
const neuf = (extra: Partial<Film> = {}): Film => ({
  ...preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }], idFilm: 'film-reg' }),
  proprietaire: 'u1', directionActive: true, ...extra,
});
const media = (o: Partial<MediaPlan> = {}): MediaPlan => ({
  url: 'cinema/film-reg/medias/p.mp4', genre: 'video', largeur: 64, hauteur: 64, dureeS: 2, octets: 10, origine: 'genere', ...o,
});
const avecMedia = (f: Film, m: MediaPlan | null, scene = 0, plan = 0): Film => {
  const c = structuredClone(f); c.scenes[scene].plans[plan].media = m; return c;
};

describe('anciens films', () => {
  it('un film d’avant n’est JAMAIS signale « a regenerer » : ses medias valent « aucun style, camera d’origine »', () => {
    const f = avecMedia(avecMedia(neuf(), media()), media({ genre: 'image', url: 'cinema/x/i.png' }), 1);
    delete f.directionActive;
    expect(plansARegenerer(f)).toEqual([]);
    expect(signatureDirection(f, f.scenes[0].plans[0].id, 'video')).toBe(signatureAncienne('video'));
    expect(signatureDirection(f, f.scenes[0].plans[0].id, 'image')).toBe(signatureAncienne('image'));
  });

  it('empreintes des scenes d’un film d’avant : inchangees (rien a re-rendre, rien a refacturer)', () => {
    const f = avecMedia(neuf(), media());
    delete f.directionActive;
    const sans = structuredClone(f);
    expect(empreinteScene(f.scenes[0], f.personnages)).toBe(empreinteScene(sans.scenes[0], sans.personnages));
    // Meme hash qu'avec un media genere SANS signature : le champ n'entre pas dans l'empreinte.
    const nu = avecMedia(neuf(), null);
    expect(empreinteScene(f.scenes[0], f.personnages)).toBe(empreinteScene(nu.scenes[0], nu.personnages));
    const scelle = { ...f, scenes: f.scenes.map((s) => scelleScene(s, f.personnages)) };
    expect(scenesAReproduire(scelle)).toEqual([]);
  });

  it('seul un reglage reel signale le plan : changer le style d’un film d’avant le signale, pas avant', () => {
    const f = avecMedia(neuf(), media());
    delete f.directionActive;
    expect(plansARegenerer(f)).toEqual([]);
    expect(plansARegenerer(appliquerPatch(f, { style: 'noir' }))).toHaveLength(1);
  });

  it('POST : un film neuf porte le drapeau « direction active » ; sans lui, camera d’origine', async () => {
    expect(neuf().directionActive).toBe(true);
    expect('directionActive' in preparerFilm({ histoire: HISTOIRE, personnages: [], idFilm: 'x' })).toBe(false);
    expect(typeof filmsRoute.POST).toBe('function');
  });
});

describe('changement de direction apres generation', () => {
  const planId = (f: Film, s = 0, p = 0) => f.scenes[s].plans[p].id;

  it('media genere sous « noir » : a jour tant que rien ne change', () => {
    let f = neuf({ styleCinema: 'noir' });
    f = avecMedia(f, media({ direction: signatureDirection(f, planId(f), 'video') }));
    expect(plansARegenerer(f)).toEqual([]);
  });

  it('changement de STYLE : le plan est signale ; l’ancien media est conserve a l’identique', () => {
    let f = neuf({ styleCinema: 'noir' });
    const m = media({ direction: signatureDirection(f, planId(f), 'video') });
    f = avecMedia(f, m);
    const apres = appliquerPatch(f, { style: 'romantique' });
    expect(plansARegenerer(apres)).toEqual([{ planId: planId(f), sceneId: f.scenes[0].id }]);
    expect(apres.scenes[0].plans[0].media).toEqual(m);
  });

  it('exception de SCENE : seule cette scene est signalee', () => {
    let f = neuf({ styleCinema: 'noir' });
    f = avecMedia(avecMedia(f, media({ direction: signatureDirection(f, planId(f, 0), 'video') }), 0),
      media({ url: 'cinema/x/b.mp4', direction: signatureDirection(f, planId(f, 1), 'video') }), 1);
    const apres = appliquerPatch(f, { scenes: [{ id: f.scenes[1].id, style: 'scifi' }] });
    expect(plansARegenerer(apres).map((x) => x.sceneId)).toEqual([f.scenes[1].id]);
  });

  it('changement de CAMERA : une VIDEO est signalee, une IMAGE non (l’image ne depend pas de la camera)', () => {
    let f = neuf();
    f = avecMedia(avecMedia(f, media({ direction: signatureDirection(f, planId(f, 0), 'video') }), 0),
      media({ genre: 'image', url: 'cinema/x/i.png', direction: signatureDirection(f, planId(f, 1), 'image') }), 1);
    const autre = signatureDirection(f, planId(f, 0), 'video').endsWith('orbite') ? 'fixe' : 'orbite';
    const apres = appliquerPatch(f, { plans: [{ id: planId(f, 0), camera: autre }, { id: planId(f, 1), camera: autre }] });
    expect(plansARegenerer(apres).map((x) => x.planId)).toEqual([planId(f, 0)]);
  });

  it('revenir au reglage d’origine retire le signalement', () => {
    let f = neuf({ styleCinema: 'noir' });
    f = avecMedia(f, media({ direction: signatureDirection(f, planId(f), 'video') }));
    const change = appliquerPatch(f, { style: 'scifi' });
    expect(plansARegenerer(change)).toHaveLength(1);
    expect(plansARegenerer(appliquerPatch(change, { style: 'noir' }))).toEqual([]);
  });

  it('un media IMPORTE n’est jamais signale (aucune direction ne s’y applique)', () => {
    const f = appliquerPatch(avecMedia(neuf(), media({ origine: 'import' })), { style: 'noir' });
    expect(plansARegenerer(f)).toEqual([]);
  });

  it('aucun ancien RENDU reutilise : un media genere sous une autre direction change l’empreinte de la scene', () => {
    const f = neuf({ styleCinema: 'noir' });
    const a = avecMedia(f, media({ direction: signatureDirection(f, planId(f), 'video') }));
    const b = avecMedia(f, media({ url: 'cinema/film-reg/medias/p2.mp4', direction: 's:romantique|c:fixe' }));
    expect(empreinteScene(a.scenes[0], a.personnages)).not.toBe(empreinteScene(b.scenes[0], b.personnages));
  });

  it('modifier la direction ne depense rien : devis identiques, aucune generation creee', () => {
    const f = avecMedia(neuf({ styleCinema: 'noir' }), media({ direction: 's:noir|c:fixe' }));
    const tout = f.scenes.map((s) => s.id);
    const apres = appliquerPatch(f, { style: 'scifi', plans: [{ id: planId(f), camera: 'orbite' }] });
    expect(devisFilm(apres, tout)).toEqual(devisFilm(f, tout));
    expect(apres.coutGenerationUsd ?? 0).toBe(f.coutGenerationUsd ?? 0);
    expect(apres.generations ?? []).toHaveLength(0);
  });
});

describe.skipIf(!OUTILS)('apres une VRAIE generation (fournisseur double, aucun appel reseau)', () => {
  let racine = '';
  const vues: { image: DemandeImageGeneration[]; video: DemandeVideoGeneration[] } = { image: [], video: [] };
  beforeEach(() => {
    racine = mkdtempSync(join(tmpdir(), 'cinema-reg-'));
    vues.image.length = 0; vues.video.length = 0;
    const faux = (id: string) => ({
      id, libelle: 'double', actif: true,
      async genererImage(d: DemandeImageGeneration) { vues.image.push(d); return { ok: false as const, erreur: 'double', jamaisEnvoye: true }; },
      async genererVideo(d: DemandeVideoGeneration) { vues.video.push(d); return { ok: false as const, erreur: 'double', jamaisEnvoye: true }; },
    });
    enregistrerFournisseur(faux(ID_REPLICATE_IMAGE));
    enregistrerFournisseur(faux(ID_REPLICATE_VIDEO));
  });

  it('le media importe porte la signature ; changer le style le signale ; l’ancien fichier est conserve ; la regeneration ne part qu’a la demande', async () => {
    const f0 = neuf({ styleCinema: 'noir' });
    const pid = f0.scenes[0].plans[0].id;
    mkdirSync(join(racine, 'tmp'), { recursive: true });
    const png = join(racine, 'tmp', 'r.png');
    expect((await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', '-y', png], { timeoutMs: 20_000 })).code).toBe(0);
    const r = await importerResultatFournisseur({ film: f0, planId: pid, fichier: png, nomSuggere: 'r.png', racinePublique: racine, fournisseurId: 'double', coutUsd: 0.01 });
    if (!r.ok) throw new Error(r.erreur);
    expect(r.media.direction).toBe('s:noir');
    expect(plansARegenerer(r.film)).toEqual([]);
    const fichier = join(racine, r.media.url);
    expect(existsSync(fichier)).toBe(true);

    const change = appliquerPatch(r.film, { style: 'romantique' });
    expect(plansARegenerer(change)).toEqual([{ planId: pid, sceneId: f0.scenes[0].id }]);
    expect(change.scenes[0].plans[0].media?.url).toBe(r.media.url);
    expect(existsSync(fichier)).toBe(true);
    // Changer le style n'a appele AUCUN fournisseur.
    expect(vues.image).toHaveLength(0);
    // Regenerer, c'est l'action explicite : le prompt porte alors le NOUVEAU style, pas l'ancien.
    await genererMediaPlan(change, pid, { fournisseurId: ID_REPLICATE_IMAGE, operation: 'image', racinePublique: racine });
    expect(vues.image).toHaveLength(1);
    expect(vues.image[0].promptConstruit).toContain('golden hour');
    expect(vues.image[0].promptConstruit).not.toContain('venetian blind');
    rmSync(racine, { recursive: true, force: true });
  });
});

describe.skipIf(!OUTILS)('REPRISE apres interruption : la direction ENVOYEE est conservee', () => {
  /** Generation interrompue, style change pendant l'arret, puis recuperation du resultat. */
  async function scenario(directionEnvoyee: string | undefined) {
    const dossier = mkdtempSync(join(tmpdir(), 'cinema-reprise-dir-'));
    const depot = depotFilmsMemoire();
    let film = neuf({ styleCinema: 'noir' });
    await depot.creer(film, 'u1');
    const planId = film.scenes[0].plans[0].id;
    const r = await reserverGeneration(depot, film.id, 'u1', { planId, operation: 'image', mode: 'reelle' });
    if (!r.ok) throw new Error('reservation');
    await modifierFilm(depot, film.id, 'u1', (x) => ({
      ...x,
      generations: x.generations!.map((g) => ({
        ...g, statut: 'interrompue' as const, bailJusqua: null,
        externe: {
          fournisseurId: 'fournisseur-test', cleIdempotence: 'c', idExterne: '3f2b8c1e-9a4d-4e7f-b6a1-0c5d2e8f9a71',
          coutEstimeUsd: 0.04, mediaAvantUrl: null, soumisLe: new Date().toISOString(),
          ...(directionEnvoyee === undefined ? null : { direction: directionEnvoyee }),
        },
      })),
    }));
    // PENDANT L'ARRET : l'utilisateur change le style du film.
    await modifierFilm(depot, film.id, 'u1', (x) => appliquerPatch(x, { style: 'romantique' }));
    const image = join(dossier, 'resultat.png');
    await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=green:s=64x64', '-frames:v', '1', '-y', image], { timeoutMs: 20_000 });
    const appels = { generer: 0, consulter: 0 };
    const issues = await reprendreGenerationsInterrompues(
      { films: depot, dossierTravail: join(dossier, 'travail'), objets: { deposerFichier: async () => {}, supprimer: async () => {}, telechargerVers: async () => true } } as never,
      film.id, 'u1',
      {
        fournisseur: () => ({
          id: 'fournisseur-test', libelle: 't', actif: true,
          genererImage: async () => { appels.generer++; return { ok: false as const, erreur: 'x' }; },
          genererVideo: async () => { appels.generer++; return { ok: false as const, erreur: 'x' }; },
          consulter: async () => { appels.consulter++; return { etat: 'termine' as const, fichier: image, nomSuggere: 'resultat.png' }; },
        }),
        confirmerDepense: async () => ({ ok: true, motif: null }), confirmerQuota: async () => ({ ok: true, motif: null }),
      } as never,
    );
    film = (await depot.lire(film.id, 'u1'))!.film;
    rmSync(dossier, { recursive: true, force: true });
    return { issues, film, planId, appels, generationId: r.generation.id };
  }

  it('video livree apres l’arret : garde le style d’ORIGINE, est signalee « a regenerer », aucun nouvel appel, un seul debit', async () => {
    const { issues, film, planId, appels, generationId } = await scenario('s:noir');
    expect(issues).toEqual([{ id: generationId, etat: 'livree' }]);
    const m = film.scenes[0].plans[0].media!;
    expect(m).not.toBeNull();                       // le media est CONSERVE
    expect(m.direction).toBe('s:noir');             // direction ENVOYEE, pas 'romantique'
    expect(film.styleCinema).toBe('romantique');    // le film a bien change entre-temps
    expect(plansARegenerer(film)).toEqual([{ planId, sceneId: film.scenes[0].id }]);
    expect(appels.generer).toBe(0);                 // aucune nouvelle generation payante
    expect(appels.consulter).toBe(1);               // une simple lecture de la demande existante
    expect(film.coutGenerationUsd).toBe(0.04);      // compte UNE fois
  });

  it('sans changement de style : la video recuperee est a jour (pas de faux signalement)', async () => {
    const dossierFilm = await scenario('s:romantique'); // direction envoyee = celle du film actuel
    expect(plansARegenerer(dossierFilm.film)).toEqual([]);
  });

  it('soumission SANS trace de direction : aucun style n’est attribue, le plan est signale', async () => {
    const { film, planId } = await scenario(undefined);
    const m = film.scenes[0].plans[0].media!;
    expect(m.direction).toBeUndefined();
    expect(plansARegenerer(film).map((x) => x.planId)).toEqual([planId]);
  });
});
