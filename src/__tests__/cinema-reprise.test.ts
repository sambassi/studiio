// @vitest-environment node
/**
 * CINEMA IA — REPRISE APRES UN ARRET DU SERVEUR : aucun film facture perdu, aucun double
 * paiement, aucune livraison incorrecte.
 *
 * Tout tourne pour de vrai (depot de films en memoire, ecritures gardees, import du media
 * par le MEME controle qu'une generation, sur une vraie image produite par ffmpeg). Seuls
 * le fournisseur (`consulter`), le stockage objet et les compteurs de depense/quota sont
 * simules — ces derniers sont prouves sur PostgreSQL ailleurs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { preparerFilm } from '@/lib/cinema/atelier';
import { depotFilmsMemoire, modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { reserverGeneration, filmPublic } from '@/lib/cinema/generation/suivi';
import { reprendreGenerationsInterrompues, MESSAGES_REPRISE, DUREE_REPRISE_MAX_MS } from '@/lib/cinema/generation/reprise';
import type { EtatExterne, FournisseurGenerationIA } from '@/lib/cinema/generation/fournisseur';
import { executer } from '@/lib/cinema/rendu-local';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import type { GenerationSuivie } from '@/lib/cinema/types';

const U = '11111111-1111-4111-8111-111111111111';
const ID_EXTERNE = '3f2b8c1e-9a4d-4e7f-b6a1-0c5d2e8f9a71';

/** Une vraie image, comme celle qu'un fournisseur rendrait. */
async function imageReelle(): Promise<string> {
  const f = join(mkdtempSync(join(tmpdir(), 'cinema-reprise-img-')), 'resultat.png');
  const r = await executer(cheminFfmpeg(), ['-f', 'lavfi', '-i', 'color=c=green:s=64x64', '-frames:v', '1', '-y', f], { timeoutMs: 20_000 });
  if (r.code !== 0) throw new Error('ffmpeg');
  return f;
}

interface Monde {
  depot: ReturnType<typeof depotFilmsMemoire>;
  ctx: Parameters<typeof reprendreGenerationsInterrompues>[0];
  deposes: string[]; supprimes: string[];
  confirmerDepense: ReturnType<typeof vi.fn>; confirmerQuota: ReturnType<typeof vi.fn>;
  consulter: ReturnType<typeof vi.fn>; generer: ReturnType<typeof vi.fn>;
  fournisseur: FournisseurGenerationIA;
  planId: string; generationId: string;
}

/**
 * Un film dont la generation REELLE a ete interrompue (bail expire : le serveur est mort).
 * `g` complete l'etat conserve sur la generation (soumission, credits, references).
 */
async function monde(g: Partial<GenerationSuivie> = {}, reponses: Array<EtatExterne | (() => Promise<EtatExterne>)> = []): Promise<Monde> {
  const depot = depotFilmsMemoire();
  const film = { ...preparerFilm({ histoire: 'Nina entre. Marco la regarde.', personnages: [], idFilm: 'film-rep', titre: 't' }), proprietaire: U };
  await depot.creer(film, U);
  const planId = film.scenes[0].plans[0].id;
  const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'image', mode: 'reelle' });
  if (!r.ok) throw new Error('reservation');
  await modifierFilm(depot, film.id, U, (f) => ({
    ...f,
    generations: f.generations!.map((x) => ({
      ...x, statut: 'interrompue' as const, bailJusqua: null, referenceDepense: 'dep-1', referenceQuota: 'cinema-quota:g',
      externe: {
        fournisseurId: 'fournisseur-test', cleIdempotence: 'cle-1', idExterne: ID_EXTERNE, coutEstimeUsd: 0.04,
        mediaAvantUrl: null, soumisLe: new Date().toISOString(), accepteLe: new Date().toISOString(),
      },
      ...g,
    })),
  }));
  const deposes: string[] = [];
  const supprimes: string[] = [];
  let i = 0;
  const consulter = vi.fn(async (): Promise<EtatExterne> => {
    const rep = reponses[Math.min(i++, reponses.length - 1)] ?? { etat: 'en_cours' };
    return typeof rep === 'function' ? rep() : rep;
  });
  const generer = vi.fn(async () => ({ ok: false as const, erreur: 'jamais appele' }));
  const fournisseur: FournisseurGenerationIA = { id: 'fournisseur-test', libelle: 't', actif: true, genererImage: generer, genererVideo: generer, consulter };
  const ctx = {
    films: depot, dossierTravail: mkdtempSync(join(tmpdir(), 'cinema-reprise-')),
    objets: {
      deposerFichier: async (k: string) => { deposes.push(k); },
      supprimer: async (k: string) => { supprimes.push(k); },
      telechargerVers: async () => true,
    },
  } as unknown as Monde['ctx'];
  return {
    depot, ctx, deposes, supprimes, consulter, generer, fournisseur, planId, generationId: r.generation.id,
    confirmerDepense: vi.fn(async () => ({ ok: true, motif: null })),
    confirmerQuota: vi.fn(async () => ({ ok: true, motif: null })),
  };
}

const reprendre = (m: Monde, maintenant?: () => number) => reprendreGenerationsInterrompues(m.ctx, 'film-rep', U, {
  fournisseur: (id) => (id === 'fournisseur-test' ? m.fournisseur : null),
  confirmerDepense: m.confirmerDepense as never, confirmerQuota: m.confirmerQuota as never, maintenant,
});
const lire = async (m: Monde) => (await m.depot.lire('film-rep', U))!.film;
const gen = async (m: Monde) => (await lire(m)).generations![0];
const statutsSoldes = (m: Monde) => [...m.confirmerDepense.mock.calls, ...m.confirmerQuota.mock.calls].map((c) => c[2]);

let IMAGE = '';
beforeEach(async () => { IMAGE = await imageReelle(); });
const termine = (): EtatExterne => ({ etat: 'termine', fichier: IMAGE, nomSuggere: 'resultat.png' });

describe('arret AVANT d’avoir l’identifiant : rien n’est verifiable, rien n’est relance', () => {
  it.each([
    ['arret avant soumission', { soumisLe: new Date().toISOString() }],
    ['arret apres acceptation, avant enregistrement de l’identifiant', { soumisLe: new Date().toISOString() }],
  ])('%s : introuvable, depense laissee incertaine, AUCUN appel au fournisseur', async (_cas, extra) => {
    const m = await monde({
      externe: { fournisseurId: 'fournisseur-test', cleIdempotence: 'cle-1', coutEstimeUsd: 0.04, mediaAvantUrl: null, ...extra },
    });
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'introuvable' }]);
    expect(m.consulter).not.toHaveBeenCalled();
    expect(m.generer).not.toHaveBeenCalled();
    expect(statutsSoldes(m)).toEqual([]); // ni liberee, ni confirmee : la reconciliation l'a mise en incertaine
    expect(await gen(m)).toMatchObject({ statut: 'interrompue', erreur: MESSAGES_REPRISE.sansIdentifiant });
    expect((await gen(m)).erreur).not.toMatch(/rembours|rendu/i);
  });
});

describe('arret APRES l’identifiant : la demande est RELUE, jamais resoumise', () => {
  it('video/image disponible au redemarrage : recuperee, controlee, LIVREE une fois ; facturee une fois', async () => {
    const m = await monde({}, [termine()]);
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'livree' }]);
    const f = await lire(m);
    expect(f.scenes[0].plans[0].media?.url).toMatch(/^cinema\/film-rep\/medias\//);
    expect(f.coutGenerationUsd).toBeCloseTo(0.04, 4);
    expect(await gen(m)).toMatchObject({ statut: 'reussie', reprise: { etat: 'livree' } });
    expect(m.deposes).toHaveLength(1);
    expect(statutsSoldes(m)).toEqual(['confirmee', 'confirmee']);
    expect(m.generer).not.toHaveBeenCalled();
    // Une nouvelle reprise ne fait plus rien : pas de seconde livraison, pas de second solde.
    expect(await reprendre(m)).toEqual([]);
    expect(m.consulter).toHaveBeenCalledTimes(1);
  });

  it('encore en cours chez le fournisseur : rien n’est conclu ; une reprise suivante livre', async () => {
    const m = await monde({}, [{ etat: 'en_cours' }, termine()]);
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'a_verifier' }]);
    expect(statutsSoldes(m)).toEqual([]);
    expect(await gen(m)).toMatchObject({ statut: 'interrompue', erreur: MESSAGES_REPRISE.verification });
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'livree' }]);
    expect((await gen(m)).reprise).toMatchObject({ etat: 'livree', tentatives: 2 });
  });

  it('fournisseur injoignable : rien n’est conclu, on retentera', async () => {
    const m = await monde({}, [{ etat: 'injoignable', erreur: 'reseau' }]);
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'a_verifier' }]);
    expect(statutsSoldes(m)).toEqual([]);
  });

  it('echec que le fournisseur s’engage a ne pas facturer : quota ET depense liberes (preuve ecrite)', async () => {
    const m = await monde({}, [{ etat: 'echec', nonFacture: true, erreur: 'nsfw' }]);
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'echec_non_facture' }]);
    expect(statutsSoldes(m)).toEqual(['liberee', 'liberee']);
    expect((await lire(m)).coutGenerationUsd ?? 0).toBe(0);
  });

  it('echec SANS engagement de non-facturation : facture, cout compte, rien n’est annonce rembourse', async () => {
    const m = await monde({}, [{ etat: 'echec', nonFacture: false, erreur: 'failed' }]);
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'echec_facture' }]);
    expect(statutsSoldes(m)).toEqual(['confirmee', 'confirmee']);
    expect((await lire(m)).coutGenerationUsd).toBeCloseTo(0.04, 4);
    expect((await gen(m)).erreur).not.toMatch(/rembours/i);
  });

  it('introuvable chez le fournisseur : incertaine conservee, explication claire', async () => {
    const m = await monde({}, [{ etat: 'introuvable', erreur: '404' }]);
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'introuvable' }]);
    expect(statutsSoldes(m)).toEqual([]);
    expect((await gen(m)).erreur).toBe(MESSAGES_REPRISE.introuvable);
  });

  it('au-dela de la conservation du fournisseur : expiree, sans meme le consulter', async () => {
    const m = await monde({}, [termine()]);
    const plusTard = Date.now() + DUREE_REPRISE_MAX_MS + 60_000;
    expect(await reprendre(m, () => plusTard)).toEqual([{ id: m.generationId, etat: 'expiree' }]);
    expect(m.consulter).not.toHaveBeenCalled();
  });
});

describe('aucune livraison incorrecte', () => {
  it('reprise lancee DEUX fois en meme temps : une seule consultation, une seule livraison', async () => {
    let relacher!: () => void;
    const attente = new Promise<void>((r) => { relacher = r; });
    const m = await monde({}, [async () => { await attente; return termine(); }]);
    const deux = Promise.all([reprendre(m), reprendre(m)]);
    await new Promise((r) => setTimeout(r, 20));
    relacher();
    const [a, b] = await deux;
    // La seconde reprise voit la generation, mais ne peut pas prendre le bail : `non_prise`.
    expect([...a, ...b].map((x) => x.etat).sort()).toEqual(['livree', 'non_prise']);
    expect(m.consulter).toHaveBeenCalledTimes(1);
    expect(m.deposes).toHaveLength(1);
  });

  it('film modifie entre-temps (autre media sur le plan) : le plus recent n’est jamais ecrase', async () => {
    const m = await monde({}, [termine()]);
    await modifierFilm(m.depot, 'film-rep', U, (f) => ({
      ...f, scenes: f.scenes.map((s, i) => (i ? s : { ...s, plans: s.plans.map((p, j) => (j ? p : {
        ...p, media: { url: 'cinema/film-rep/medias/importe.png', genre: 'image' as const, largeur: 10, hauteur: 10, dureeS: null, octets: 10, origine: 'import' as const },
      })) })),
    }));
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'non_livree' }]);
    expect((await lire(m)).scenes[0].plans[0].media?.url).toBe('cinema/film-rep/medias/importe.png');
    expect(m.supprimes).toHaveLength(1);
    expect(statutsSoldes(m)).toEqual(['confirmee', 'confirmee']); // facture quand meme
    expect((await gen(m)).erreur).toMatch(/deja ete modifie/);
  });

  it('credits pris (et rendus a l’interruption) : jamais livre gratuitement, l’utilisateur est prevenu', async () => {
    const m = await monde({ creditsPris: 5, referenceCredits: 'cr-1', creditsRembourses: true }, [termine()]);
    expect(await reprendre(m)).toEqual([{ id: m.generationId, etat: 'non_livree' }]);
    expect((await lire(m)).scenes[0].plans[0].media).toBeNull();
    expect((await gen(m)).erreur).toMatch(/credits ont ete rendus/);
  });

  it('une generation encore vivante (bail valide) n’est jamais reprise', async () => {
    const m = await monde({ statut: 'en_cours', bailJusqua: new Date(Date.now() + 60_000).toISOString() }, [termine()]);
    expect(await reprendre(m)).toEqual([]);
    expect(m.consulter).not.toHaveBeenCalled();
  });

  it('le navigateur ne recoit ni l’identifiant externe, ni la cle, ni le bail', async () => {
    const m = await monde({}, [{ etat: 'en_cours' }]);
    await reprendre(m);
    const publie = JSON.stringify(filmPublic(await lire(m)));
    expect(publie).not.toContain(ID_EXTERNE);
    expect(publie).not.toContain('cle-1');
    expect(publie).not.toContain('fournisseur-test');
    expect(publie).toContain('a_verifier');
  });
});
