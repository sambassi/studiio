// @vitest-environment node
/**
 * CINEMA IA — les ROUTES, de bout en bout, sur un contexte en memoire.
 *
 * Rien n'est simule dans la chaine HTTP -> depot -> objets -> executeur ; seuls
 * Chromium/ffmpeg/voix du RENDU sont remplaces (le banc `tests-cinema/` prouve
 * le rendu reel). ffprobe/ffmpeg reels servent a l'import et a la generation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, stat, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { NextRequest } from 'next/server';

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('@/lib/auth/config', () => ({
  auth: async () => (session.userId ? { user: { id: session.userId, email: 'x@example.org' } } : null),
}));

// Le verrou d'acces a ses propres tests (cinema-acces.test.ts) ; ici on teste l'isolation ENTRE comptes.
vi.mock('@/lib/cinema/garde', () => ({ accesCinemaAutorise: () => true }));

import { depotFilmsMemoire } from '@/lib/cinema/stockage/depot-films';
import { objetsMemoire } from '@/lib/cinema/stockage/objets';
import { depotTravauxMemoire } from '@/lib/cinema/travaux/depot-travaux';
import { attendreFile, reinitialiserLanceurPourTests } from '@/lib/cinema/travaux/lanceur';
import { plafondServeurUsd, type ContexteCinema } from '@/lib/cinema/contexte';
import type { MoteursProduction } from '@/lib/cinema/travaux/executeur';
import { cleMedia, cleScene, cleVoix, cleFilmMp4 } from '@/lib/cinema/stockage/cles';
import * as filmsRoute from '@/app/api/cinema/films/route';
import * as filmRoute from '@/app/api/cinema/films/[id]/route';
import * as produireRoute from '@/app/api/cinema/films/[id]/produire/route';
import * as travauxRoute from '@/app/api/cinema/films/[id]/travaux/route';
import * as travailRoute from '@/app/api/cinema/films/[id]/travaux/[travailId]/route';
import * as annulerRoute from '@/app/api/cinema/films/[id]/travaux/[travailId]/annuler/route';
import * as exportRoute from '@/app/api/cinema/films/[id]/travaux/[travailId]/export/route';
import * as mediasRoute from '@/app/api/cinema/films/[id]/medias/route';
import * as mediaPlanRoute from '@/app/api/cinema/films/[id]/medias/[planId]/route';
import * as voixRoute from '@/app/api/cinema/films/[id]/voix/[planId]/route';
import * as refsRoute from '@/app/api/cinema/films/[id]/references/route';
import * as refPersoRoute from '@/app/api/cinema/films/[id]/references/[personnageId]/route';
import * as generationRoute from '@/app/api/cinema/films/[id]/generation/route';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
// Sans guillemets : aucune replique, donc aucune synthese vocale dans ces tests.
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Marco hoche la tete. Le jour se leve sur la salle vide.';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let ctx: ContexteCinema;
let memTravaux: ReturnType<typeof depotTravauxMemoire>;
let memObjets: ReturnType<typeof objetsMemoire>;
let racine: string;
let rendus: string[];
let bloque: { attente: Promise<void> | null };

function req(url: string, init: { method?: string; json?: unknown; body?: Uint8Array; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: BodyInit | undefined;
  if (init.json !== undefined) { body = JSON.stringify(init.json); headers['content-type'] = 'application/json'; }
  if (init.body) body = init.body as unknown as BodyInit;
  return new NextRequest(`http://localhost${url}`, { method: init.method ?? 'GET', headers, body });
}

async function multipart(champs: Record<string, string | { nom: string; octets: Uint8Array; type?: string }>, extra: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(champs)) f.append(k, typeof v === 'string' ? v : new File([v.octets as BlobPart], v.nom, { type: v.type ?? 'application/octet-stream' }));
  const r = new Response(f);
  const octets = new Uint8Array(await r.arrayBuffer());
  return { body: octets, headers: { 'content-type': r.headers.get('content-type')!, 'content-length': String(octets.length), ...extra } };
}

async function creerFilm(userId = A): Promise<string> {
  session.userId = userId;
  const r = await filmsRoute.POST(req('/api/cinema/films', { method: 'POST', json: {
    titre: 'Test', histoire: HISTOIRE, format: '16:9', qualite: 'standard', nbScenes: 3,
    personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }],
  } }));
  expect(r.status).toBe(200);
  return (await r.json()).film.id;
}

beforeEach(async () => {
  racine = await mkdtemp(path.join(tmpdir(), 'cinema-routes-'));
  rendus = [];
  bloque = { attente: null };
  const moteurs: MoteursProduction = {
    synthetiser: async () => ({ voix: {}, details: [], echecs: [], moteur: 'edge', motifRepli: null }),
    mesurerVoix: async () => ({}),
    preparerRendu: async () => async (t) => {
      rendus.push(path.basename(t.sortie, '.mp4'));
      if (bloque.attente) await bloque.attente;
      await mkdir(path.dirname(t.sortie), { recursive: true });
      await writeFile(t.sortie, `mp4:${path.basename(t.sortie, '.mp4')}`);
      return { fichier: t.sortie, octets: 20, dureeS: 9, largeur: 1920, hauteur: 1080, codecVideo: 'h264', codecAudio: 'aac' };
    },
    concatener: async (fichiers, sortie) => {
      const { readFile } = await import('fs/promises');
      await writeFile(sortie, (await Promise.all(fichiers.map((f) => readFile(f, 'utf-8')))).join('+'));
      return { fichier: sortie, octets: 40, dureeS: 9, largeur: 1920, hauteur: 1080, codecVideo: 'h264', codecAudio: 'aac' };
    },
    controler: async (f) => ({ fichier: f, octets: 40, dureeS: 9, largeur: 1920, hauteur: 1080, codecVideo: 'h264', codecAudio: 'aac' }),
  };
  memTravaux = depotTravauxMemoire();
  memObjets = objetsMemoire();
  ctx = {
    mode: 'local', films: depotFilmsMemoire(), travaux: memTravaux, objets: memObjets,
    racine, dossierTravail: path.join(racine, 'var', 'cinema', 'travail'), plafondUsd: 2, moteurs,
    ressources: { lire: () => ({ rendusEnCours: 0, ramLibreMo: 64_000, cpus: 8 }), pause: async () => {} },
  };
  (globalThis as unknown as { __cinemaContexte?: ContexteCinema }).__cinemaContexte = ctx;
  session.userId = A;
});

afterEach(async () => {
  await attendreFile().catch(() => {});
  reinitialiserLanceurPourTests();
  delete (globalThis as unknown as { __cinemaContexte?: ContexteCinema }).__cinemaContexte;
  await rm(racine, { recursive: true, force: true });
});

// Les handlers attendent chacun leur propre forme de `params` : un seul constructeur, cast une fois.
const P = (id: string, extra: Record<string, string> = {}) => ({ params: { id, ...extra } }) as never;

describe('securite — session et isolation entre comptes', () => {
  it('sans session : 401 (ou 404 pour les lectures de fichier)', async () => {
    const id = await creerFilm();
    session.userId = null;
    expect((await filmsRoute.GET()).status).toBe(401);
    expect((await filmsRoute.POST(req('/x', { method: 'POST', json: {} }))).status).toBe(401);
    expect((await filmRoute.GET(req('/x'), P(id))).status).toBe(401);
    expect((await filmRoute.PATCH(req('/x', { method: 'PATCH', json: {} }), P(id))).status).toBe(401);
    expect((await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id))).status).toBe(401);
    expect((await travauxRoute.GET(req('/x'), P(id))).status).toBe(401);
    expect((await mediasRoute.POST(req('/x', { method: 'POST' }), P(id))).status).toBe(401);
    expect((await generationRoute.POST(req('/x', { method: 'POST', json: {} }), P(id))).status).toBe(401);
    expect((await refsRoute.POST(req('/x', { method: 'POST' }), P(id))).status).toBe(401);
    expect((await mediaPlanRoute.GET(req('/x'), P(id, { planId: 's1-p-1' }))).status).toBe(404);
    expect((await voixRoute.GET(req('/x'), P(id, { planId: 's1-p-1' }))).status).toBe(404);
  });

  it('un identifiant de compte qui n\'est pas un segment de chemin est refuse', async () => {
    session.userId = '../autre';
    expect((await filmsRoute.GET()).status).toBe(401);
    session.userId = 'a/b';
    expect((await filmsRoute.GET()).status).toBe(401);
  });

  it('un autre compte ne voit, ne modifie, ne produit, ne lit RIEN', async () => {
    const id = await creerFilm(A);
    const lu = (await ctx.films.lire(id, A))!.film;
    const planId = lu.scenes[0].plans[0].id;
    session.userId = B;
    expect(await (await filmsRoute.GET()).json()).toEqual({ ok: true, films: [] });
    expect((await filmRoute.GET(req('/x'), P(id))).status).toBe(404);
    expect((await filmRoute.PATCH(req('/x', { method: 'PATCH', json: { scenes: [] } }), P(id))).status).toBe(404);
    expect((await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id))).status).toBe(404);
    expect((await produireRoute.POST(req('/x', { method: 'POST', json: {} }), P(id))).status).toBe(404);
    expect((await generationRoute.POST(req('/x', { method: 'POST', json: { planId, operation: 'image' } }), P(id))).status).toBe(404);
    expect((await travauxRoute.GET(req('/x'), P(id))).status).toBe(404);
    expect((await mediaPlanRoute.GET(req('/x'), P(id, { planId }))).status).toBe(404);
    const m = await multipart({ planId, fichier: { nom: 'x.png', octets: PNG } });
    expect((await mediasRoute.POST(req('/x', { method: 'POST', ...m }), P(id))).status).toBe(404);
    expect(memTravaux.tous()).toEqual([]);
  });

  it('mediasId/voix invalides : 404, jamais 500', async () => {
    const id = await creerFilm();
    for (const planId of ['../x', 's1-p-1/../../y', '', 'abc']) {
      expect((await mediaPlanRoute.GET(req('/x'), P(id, { planId }))).status).toBe(404);
      expect((await voixRoute.GET(req('/x'), P(id, { planId }))).status).toBe(404);
    }
    expect((await filmRoute.GET(req('/x'), P('../../etc/passwd'))).status).toBe(404);
  });
});

describe('creation, sauvegarde, rechargement', () => {
  it('cree, recharge, liste, et le film porte le compte de la SESSION', async () => {
    const id = await creerFilm();
    const r = await filmRoute.GET(req('/x'), P(id));
    const donnees = await r.json();
    expect(donnees.film.proprietaire).toBe(A);
    expect(donnees.film.scenes.length).toBeGreaterThan(0);
    expect(donnees.devis.totalUsd).toBe(0);
    expect((await (await filmsRoute.GET()).json()).films.map((f: { id: string }) => f.id)).toEqual([id]);
  });

  it('le proprietaire du corps est ignore', async () => {
    session.userId = A;
    const r = await filmsRoute.POST(req('/x', { method: 'POST', json: { histoire: HISTOIRE, proprietaire: B, personnages: [{ nom: 'Nina', urlImage: 'http://169.254.169.254/x.png' }] } }));
    const film = (await r.json()).film;
    expect(film.proprietaire).toBe(A);
    expect(film.personnages[0].references.every((x: { urlImage: string | null }) => x.urlImage === null)).toBe(true);
  });

  it('refuse une histoire trop courte ou trop longue, et plus de 50 films', async () => {
    expect((await filmsRoute.POST(req('/x', { method: 'POST', json: { histoire: 'court', personnages: [{ nom: 'A' }] } }))).status).toBe(400);
    expect((await filmsRoute.POST(req('/x', { method: 'POST', json: { histoire: 'x'.repeat(20_001), personnages: [{ nom: 'A' }] } }))).status).toBe(400);
    const modele = (await ctx.films.lire(await creerFilm(), A))!.film;
    for (let i = 0; i < 49; i++) await ctx.films.creer({ ...modele, id: `film-plein-${i}` }, A);
    const r = await filmsRoute.POST(req('/x', { method: 'POST', json: { histoire: HISTOIRE, personnages: [{ nom: 'A' }] } }));
    expect(r.status).toBe(409);
  });

  it('PATCH : modification gardee, URL libre refusee', async () => {
    const id = await creerFilm();
    const planId = (await ctx.films.lire(id, A))!.film.scenes[0].plans[0].id;
    const ok = await filmRoute.PATCH(req('/x', { method: 'PATCH', json: { plans: [{ id: planId, texte: 'Description modifiee' }] } }), P(id));
    expect(ok.status).toBe(200);
    expect((await ctx.films.lire(id, A))!.film.scenes[0].plans[0].description).toBe('Description modifiee');
    expect((await ctx.films.lire(id, A))!.version).toBe(2);

    for (const json of [
      { plans: [{ id: planId, media: { url: 'http://169.254.169.254/' } }] },
      { plans: [{ id: planId, mediaUrl: 'http://x' }] },
      { reference: { personnageId: 'pers-nina', urlImage: 'https://exemple.org/x.png' } },
    ]) {
      expect((await filmRoute.PATCH(req('/x', { method: 'PATCH', json }), P(id))).status).toBe(400);
    }
  });
});

describe('import de medias — octets verifies, stockage prive', () => {
  it('importe une image, la depose hors de public/, la sert a son proprietaire seulement', async () => {
    const id = await creerFilm();
    const planId = (await ctx.films.lire(id, A))!.film.scenes[0].plans[0].id;
    const m = await multipart({ planId, fichier: { nom: 'photo.png', octets: PNG, type: 'image/png' } });
    const r = await mediasRoute.POST(req('/x', { method: 'POST', ...m }), P(id));
    const corps = await r.json();
    expect(r.status).toBe(200);

    const film = (await ctx.films.lire(id, A))!.film;
    const media = film.scenes[0].plans[0].media!;
    expect(media.genre).toBe('image');
    expect(media.largeur).toBe(1);
    const cle = cleMedia(A, id, media.url)!;
    expect(memObjets.cles()).toEqual([cle]);
    await expect(stat(path.join(racine, 'public'))).rejects.toThrow();             // jamais dans public/
    expect(await readdir(ctx.dossierTravail)).toEqual([]);                         // dossier de travail efface

    // Le navigateur ne recoit ni le compte dans un chemin, ni l'URL du relais de
    // stockage, ni un chemin servi tel quel : le chemin LOGIQUE du film ne
    // designe plus rien de lisible (`public/` n'existe pas pour Cinema IA).
    const json = JSON.stringify(corps);
    expect(json).not.toContain(`${A}/cinema`);
    expect(json).not.toContain('storage/v1');
    expect(corps.montage.segments.every((s: { media: { url: string } | null }) => !s.media || s.media.url.startsWith('/api/cinema/'))).toBe(true);
    expect(corps.montage.segments.find((s: { planId: string }) => s.planId === planId).media.url)
      .toMatch(/^\/api\/cinema\/films\/film-[a-z0-9-]+\/medias\/s1-p-1\?v=[0-9a-f]{8}$/);

    // Lecture : proprietaire seulement.
    const lecture = await mediaPlanRoute.GET(req('/x'), P(id, { planId }));
    expect(lecture.status).toBe(200);
    expect(lecture.headers.get('content-type')).toBe('image/png');
    expect(lecture.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await lecture.arrayBuffer()).equals(PNG)).toBe(true);
    session.userId = B;
    expect((await mediaPlanRoute.GET(req('/x'), P(id, { planId }))).status).toBe(404);
  });

  it('remplacer un media supprime l\'ancien objet', async () => {
    const id = await creerFilm();
    const planId = (await ctx.films.lire(id, A))!.film.scenes[0].plans[0].id;
    const envoi = async () => mediasRoute.POST(req('/x', { method: 'POST', ...(await multipart({ planId, fichier: { nom: 'p.png', octets: PNG } })) }), P(id));
    expect((await envoi()).status).toBe(200);
    const premiere = memObjets.cles()[0];
    expect((await envoi()).status).toBe(200);
    expect(memObjets.cles()).toHaveLength(1);
    expect(memObjets.cles()[0]).not.toBe(premiere);
  });

  it('refuse : faux PNG, extension inconnue, liste de lecture, plan inconnu, sans Content-Length, trop gros', async () => {
    const id = await creerFilm();
    const planId = (await ctx.films.lire(id, A))!.film.scenes[0].plans[0].id;
    const essayer = async (champs: Parameters<typeof multipart>[0], extra: Record<string, string> = {}) => {
      const m = await multipart(champs, extra);
      return mediasRoute.POST(req('/x', { method: 'POST', ...m, headers: { ...m.headers, ...extra } }), P(id));
    };
    expect((await essayer({ planId, fichier: { nom: 'x.png', octets: new TextEncoder().encode('<html><script>alert(1)</script>') } })).status).toBe(400);
    expect((await essayer({ planId, fichier: { nom: 'x.exe', octets: PNG } })).status).toBe(400);
    expect((await essayer({ planId, fichier: { nom: 'x.mp4', octets: new TextEncoder().encode('#EXTM3U\n#EXT-X-VERSION:3\nhttp://169.254.169.254/latest\n') } })).status).toBe(400);
    expect((await essayer({ planId: 's9-p-9', fichier: { nom: 'x.png', octets: PNG } })).status).toBe(400);
    expect((await essayer({ planId: '../../autre/x', fichier: { nom: 'x.png', octets: PNG } })).status).toBe(400);
    expect((await essayer({ planId, fichier: { nom: 'x.png', octets: PNG } }, { 'content-length': String(300 * 1024 * 1024) })).status).toBe(413);
    const sans = await multipart({ planId, fichier: { nom: 'x.png', octets: PNG } });
    const { 'content-length': _ignore, ...entetesSansLongueur } = sans.headers; void _ignore;
    expect((await mediasRoute.POST(req('/x', { method: 'POST', body: sans.body, headers: entetesSansLongueur }), P(id))).status).toBe(411);
    expect(memObjets.cles()).toEqual([]);
    expect(await readdir(ctx.dossierTravail)).toEqual([]);
  });
});

describe('references de personnage', () => {
  it('importe une image, en fait une version de plus, la sert a son proprietaire', async () => {
    const id = await creerFilm();
    const perso = (await ctx.films.lire(id, A))!.film.personnages[0];
    const m = await multipart({ personnageId: perso.id, fichier: { nom: 'nina.png', octets: PNG } });
    const r = await refsRoute.POST(req('/x', { method: 'POST', ...m }), P(id));
    expect(r.status).toBe(200);
    const apres = (await ctx.films.lire(id, A))!.film.personnages[0];
    expect(apres.references).toHaveLength(perso.references.length + 1);
    expect(apres.references.at(-1)!.urlImage).toMatch(/^cinema\/film-[a-z0-9-]+\/references\/pers-nina-[0-9a-f]{8}\.png$/);
    expect(apres.references.at(-1)!.version).toBe(perso.references.at(-1)!.version + 1);   // jamais d'ecrasement

    const lecture = await refPersoRoute.GET(req('/x'), P(id, { personnageId: perso.id }));
    expect(lecture.status).toBe(200);
    expect(lecture.headers.get('content-type')).toBe('image/png');
    session.userId = B;
    expect((await refPersoRoute.GET(req('/x'), P(id, { personnageId: perso.id }))).status).toBe(404);
  });

  it('refuse ce qui n\'est pas une image', async () => {
    const id = await creerFilm();
    const perso = (await ctx.films.lire(id, A))!.film.personnages[0];
    const essayer = async (nom: string, octets: Uint8Array) => refsRoute.POST(req('/x', { method: 'POST', ...(await multipart({ personnageId: perso.id, fichier: { nom, octets } })) }), P(id));
    expect((await essayer('x.png', new TextEncoder().encode('<svg onload=alert(1)>'))).status).toBe(400);
    expect((await essayer('x.svg', PNG)).status).toBe(400);
    expect((await essayer('x.gif', PNG)).status).toBe(400);
    expect((await essayer('x.mp4', PNG)).status).toBe(400);
    const inconnu = await refsRoute.POST(req('/x', { method: 'POST', ...(await multipart({ personnageId: 'pers-fantome', fichier: { nom: 'x.png', octets: PNG } })) }), P(id));
    expect(inconnu.status).toBe(404);
    expect(memObjets.cles()).toEqual([]);
  });
});

describe('apercu', () => {
  it('rend le montage et le devis sans lancer de travail, sans rien ecrire hors du stockage', async () => {
    const id = await creerFilm();
    const r = await produireRoute.POST(req('/x', { method: 'POST', json: {} }), P(id));
    const d = await r.json();
    expect(r.status).toBe(200);
    expect(d.mp4).toBeNull();
    expect(d.scenesAProduire.length).toBe(d.film.scenes.length);
    expect(d.devis.totalUsd).toBe(0);
    expect(memTravaux.tous()).toEqual([]);
    expect(rendus).toEqual([]);
    expect(await readdir(ctx.dossierTravail)).toEqual([]);
    await expect(stat(path.join(racine, 'public'))).rejects.toThrow();
  });
});

describe('production asynchrone', () => {
  it('rend 202 tout de suite, progresse, se termine, et le MP4 se lit (avec Range) par son proprietaire', async () => {
    const id = await creerFilm();
    let liberer!: () => void;
    bloque.attente = new Promise<void>((r) => { liberer = r; });

    const lancement = await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id));
    expect(lancement.status).toBe(202);
    const { travail, dejaEnCours } = await lancement.json();
    expect(dejaEnCours).toBe(false);
    expect(travail.statut).toBe('en_attente');
    // Aucune cle d'objet, aucun chemin du serveur dans ce que voit le navigateur.
    expect(JSON.stringify(travail)).not.toMatch(/exports\/|var\/cinema|[0-9a-f-]{36}\/cinema/);

    // Pendant le rendu : progression reelle, le navigateur n'est pas bloque.
    await vi.waitFor(async () => {
      const etat = (await (await travailRoute.GET(req('/x'), P(id, { travailId: travail.id }))).json()).travail;
      expect(etat.statut).toBe('en_cours');
      expect(etat.progression.etape).toBe('rendu');
    });

    liberer();
    await attendreFile();
    const fini = (await (await travailRoute.GET(req('/x'), P(id, { travailId: travail.id }))).json()).travail;
    expect(fini.statut).toBe('termine');
    expect(fini.progression.pourcent).toBe(100);
    expect(fini.resultat.aMp4).toBe(true);
    expect(fini.resultat.coutUsd).toBe(0);

    const complet = await exportRoute.GET(req('/x'), P(id, { travailId: travail.id }));
    expect(complet.status).toBe(200);
    expect(complet.headers.get('content-type')).toBe('video/mp4');
    expect((await complet.text()).startsWith('mp4:')).toBe(true);
    const partiel = await exportRoute.GET(req('/x', { headers: { range: 'bytes=0-2' } }), P(id, { travailId: travail.id }));
    expect(partiel.status).toBe(206);
    expect(await partiel.text()).toBe('mp4');

    // Un autre compte : introuvable, partout.
    session.userId = B;
    expect((await exportRoute.GET(req('/x'), P(id, { travailId: travail.id }))).status).toBe(404);
    expect((await travailRoute.GET(req('/x'), P(id, { travailId: travail.id }))).status).toBe(404);
    expect((await annulerRoute.POST(req('/x', { method: 'POST' }), P(id, { travailId: travail.id }))).status).toBe(404);
  });

  it('un second clic RETROUVE le travail actif au lieu d\'en lancer un autre', async () => {
    const id = await creerFilm();
    let liberer!: () => void;
    bloque.attente = new Promise<void>((r) => { liberer = r; });
    const un = await (await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id))).json();
    const deuxReponse = await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id));
    const deux = await deuxReponse.json();
    expect(deuxReponse.status).toBe(200);
    expect(deux.dejaEnCours).toBe(true);
    expect(deux.travail.id).toBe(un.travail.id);
    expect(memTravaux.tous()).toHaveLength(1);
    liberer();
    await attendreFile();
    expect(rendus).toHaveLength((await ctx.films.lire(id, A))!.film.scenes.length);   // chaque scene rendue UNE fois
  });

  it('relancer un film deja produit ne rend rien de plus', async () => {
    const id = await creerFilm();
    await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id));
    await attendreFile();
    const avant = rendus.length;
    const r = await (await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id))).json();
    await attendreFile();
    expect(rendus.length).toBe(avant);
    const fini = (await (await travailRoute.GET(req('/x'), P(id, { travailId: r.travail.id }))).json()).travail;
    expect(fini.statut).toBe('termine');
    expect(fini.resultat.scenesRendues).toEqual([]);
  });

  it('annulation : le travail s\'arrete, les scenes rendues restent', async () => {
    const id = await creerFilm();
    let liberer!: () => void;
    bloque.attente = new Promise<void>((r) => { liberer = r; });
    const { travail } = await (await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id))).json();
    await vi.waitFor(() => expect(rendus.length).toBe(1));
    const a = await annulerRoute.POST(req('/x', { method: 'POST' }), P(id, { travailId: travail.id }));
    expect((await a.json()).travail.annulationDemandee).toBe(true);
    liberer();
    await attendreFile();
    const fin = (await (await travailRoute.GET(req('/x'), P(id, { travailId: travail.id }))).json()).travail;
    expect(fin.statut).toBe('annule');
    expect(rendus).toHaveLength(1);
    expect(memObjets.cles().filter((c) => c.includes('/scenes/'))).toHaveLength(1);
  });

  it('echec de production : message court + reference, jamais le detail interne', async () => {
    const id = await creerFilm();
    ctx.moteurs!.preparerRendu = async () => { throw new Error('Chromium crashed at /srv/studiio/private/path'); };
    const { travail } = await (await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id))).json();
    await attendreFile();
    const fin = (await (await travailRoute.GET(req('/x'), P(id, { travailId: travail.id }))).json()).travail;
    expect(fin.statut).toBe('echec');
    expect(fin.erreur).toMatch(/reference [a-z0-9]+/);
    expect(JSON.stringify(fin)).not.toContain('/srv/studiio');
    // Le dernier travail du film est celui-la : l'ecran peut le retrouver apres rechargement.
    const dernier = (await (await travauxRoute.GET(req('/x'), P(id))).json()).travail;
    expect(dernier.id).toBe(travail.id);
  });

  it('plafond de depense du SERVEUR : 402 avant tout travail, et le client ne peut pas le relever', async () => {
    const id = await creerFilm();
    ctx.plafondUsd = Number.NaN;
    const r = await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true, plafondUsd: 1000 } }), P(id));
    expect(r.status).toBe(402);
    expect((await r.json()).erreur).toMatch(/plafond/);
    expect(memTravaux.tous()).toEqual([]);
  });

  it('un identifiant de travail mal forme ou d\'un autre film : 404', async () => {
    const id = await creerFilm();
    const { travail } = await (await produireRoute.POST(req('/x', { method: 'POST', json: { rendre: true } }), P(id))).json();
    await attendreFile();
    for (const travailId of ['../x', 'abc', '']) {
      expect((await travailRoute.GET(req('/x'), P(id, { travailId }))).status).toBe(404);
      expect((await exportRoute.GET(req('/x'), P(id, { travailId }))).status).toBe(404);
    }
    const autre = await creerFilm();
    expect((await travailRoute.GET(req('/x'), P(autre, { travailId: travail.id }))).status).toBe(404);
    expect((await exportRoute.GET(req('/x'), P(autre, { travailId: travail.id }))).status).toBe(404);
  });
});

describe('generation IA simulee — plafond serveur, stockage prive', () => {
  it('genere une image avec le fournisseur simule, la depose hors de public/', async () => {
    const id = await creerFilm();
    const planId = (await ctx.films.lire(id, A))!.film.scenes[0].plans[0].id;
    const r = await generationRoute.POST(req('/x', { method: 'POST', json: { planId, operation: 'image', fournisseurId: 'simule' } }), P(id));
    const d = await r.json();
    expect(r.status).toBe(200);
    expect(d.ok).toBe(true);
    const film = (await ctx.films.lire(id, A))!.film;
    const media = film.scenes[0].plans[0].media!;
    expect(media.origine).toBe('genere');
    expect(media.fournisseurGeneration).toBe('simule');
    expect(film.coutGenerationUsd ?? 0).toBe(0);
    expect(memObjets.cles()).toEqual([cleMedia(A, id, media.url)]);
    await expect(stat(path.join(racine, 'public'))).rejects.toThrow();
    expect(await readdir(ctx.dossierTravail)).toEqual([]);
  }, 60_000);

  it('un fournisseur payant ou inconnu est refuse', async () => {
    const id = await creerFilm();
    const planId = (await ctx.films.lire(id, A))!.film.scenes[0].plans[0].id;
    for (const fournisseurId of ['openai', 'runway', 'nimporte-quoi']) {
      const r = await generationRoute.POST(req('/x', { method: 'POST', json: { planId, operation: 'image', fournisseurId } }), P(id));
      expect(r.status).toBe(400);
    }
    expect(memObjets.cles()).toEqual([]);
  });

  it('le plafond du serveur l\'emporte sur celui du client', async () => {
    const id = await creerFilm();
    const planId = (await ctx.films.lire(id, A))!.film.scenes[0].plans[0].id;
    ctx.plafondUsd = -1;       // invalide cote serveur
    const r = await generationRoute.POST(req('/x', { method: 'POST', json: { planId, operation: 'image', plafondUsd: 1000 } }), P(id));
    expect(r.status).toBe(402);
    expect(memObjets.cles()).toEqual([]);
  });

  it('refuse un plafond client invalide', async () => {
    const id = await creerFilm();
    const planId = (await ctx.films.lire(id, A))!.film.scenes[0].plans[0].id;
    for (const plafondUsd of ['abc', -3, null, '5']) {
      const r = await generationRoute.POST(req('/x', { method: 'POST', json: { planId, operation: 'image', plafondUsd } }), P(id));
      expect(r.status).toBe(400);
    }
  });
});

describe('plafond serveur — configuration', () => {
  it('defaut, valeur valide, valeur bornee, valeur invalide', () => {
    expect(plafondServeurUsd({} as NodeJS.ProcessEnv)).toBe(2);
    expect(plafondServeurUsd({ CINEMA_PLAFOND_USD: '5' } as unknown as NodeJS.ProcessEnv)).toBe(5);
    expect(plafondServeurUsd({ CINEMA_PLAFOND_USD: '999999' } as unknown as NodeJS.ProcessEnv)).toBe(10);
    expect(plafondServeurUsd({ CINEMA_PLAFOND_USD: 'abc' } as unknown as NodeJS.ProcessEnv)).toBe(2);
    expect(plafondServeurUsd({ CINEMA_PLAFOND_USD: '-4' } as unknown as NodeJS.ProcessEnv)).toBe(2);
    expect(plafondServeurUsd({ CINEMA_PLAFOND_USD: '' } as unknown as NodeJS.ProcessEnv)).toBe(2);
  });
});

describe('DELETE /films/[id] — suppression du film et de ses objets prives', () => {
  it('supprime le film et tous ses objets ; un autre compte recoit 404 et ne touche a rien', async () => {
    const id = await creerFilm(A);
    const miens = [cleScene(A, id, 's1', 'aaaaaaaa')!, cleVoix(A, id, 's1-p-1', 'bbbbbbbb')!, cleFilmMp4(A, id, 'cccccccc')!];
    const voisin = cleScene(B, 'film-voisin', 's1', 'aaaaaaaa')!;
    for (const k of [...miens, voisin]) await memObjets.deposerOctets(k, new Uint8Array([1]), 'video/mp4');

    session.userId = B;
    expect((await filmRoute.DELETE(req('/x', { method: 'DELETE' }), P(id))).status).toBe(404);
    for (const k of miens) expect(memObjets.contenu(k)).toBeDefined();

    session.userId = A;
    const r = await filmRoute.DELETE(req('/x', { method: 'DELETE' }), P(id));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, objetsSupprimes: 3 });
    for (const k of miens) expect(memObjets.contenu(k)).toBeUndefined();
    expect(memObjets.contenu(voisin)).toBeDefined();
    expect((await filmRoute.GET(req('/x'), P(id))).status).toBe(404);
    expect((await filmRoute.DELETE(req('/x', { method: 'DELETE' }), P(id))).status).toBe(404);
  });

  it('409 tant qu\'un rendu est actif, 502 si le stockage refuse (le film est conserve)', async () => {
    const id = await creerFilm(A);
    const lu = (await ctx.films.lire(id, A))!.film;
    const c = await ctx.travaux.creerOuRetrouver({ film: lu, proprietaire: A, cle: 'k', scenesDemandees: [], maxActifs: 2 });
    session.userId = A;
    const r409 = await filmRoute.DELETE(req('/x', { method: 'DELETE' }), P(id));
    expect(r409.status).toBe(409);
    expect((await r409.json()).erreur).toMatch(/arretez-le/);
    expect(await ctx.films.lire(id, A)).not.toBeNull();

    const pris = await ctx.travaux.reclamer(c.travail!.id, 90);
    await ctx.travaux.annuler(c.travail!.id, pris!.tentatives);
    await memObjets.deposerOctets(cleScene(A, id, 's1', 'aaaaaaaa')!, new Uint8Array([1]), 'video/mp4');
    const vrai = memObjets.supprimer.bind(memObjets);
    memObjets.supprimer = async () => { throw new Error('minio indisponible'); };
    const r502 = await filmRoute.DELETE(req('/x', { method: 'DELETE' }), P(id));
    expect(r502.status).toBe(502);
    expect(JSON.stringify(await r502.json())).not.toMatch(/minio indisponible/);
    expect(await ctx.films.lire(id, A)).not.toBeNull();
    memObjets.supprimer = vrai;
    expect((await filmRoute.DELETE(req('/x', { method: 'DELETE' }), P(id))).status).toBe(200);
  });
});
