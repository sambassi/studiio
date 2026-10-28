// @vitest-environment node
/**
 * CINEMA IA — le rendu du film final REGLE les minutes d'abonnement sur la duree produite.
 *
 * L'executeur de production tourne pour de vrai (depots en memoire, moteurs fictifs, comme
 * `cinema-travaux.test.ts`) ; le quota est un double qui enregistre ce qu'on lui demande.
 * L'arithmetique des minutes elle-meme est prouvee sur PostgreSQL
 * (`tests-pg/cinema-abonnements.pg.test.ts`, bloc 5).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { preparerFilm } from '@/lib/cinema/atelier';
import { depotFilmsMemoire } from '@/lib/cinema/stockage/depot-films';
import { objetsMemoire } from '@/lib/cinema/stockage/objets';
import { depotTravauxMemoire } from '@/lib/cinema/travaux/depot-travaux';
import { executerTravail, type DependancesExecuteur, type MoteursProduction } from '@/lib/cinema/travaux/executeur';
import { cleTravail } from '@/lib/cinema/travaux/types';
import type { QuotaProduction } from '@/lib/cinema/abonnement/production';
import { dureeFilm } from '@/lib/cinema/types';

const A = '11111111-1111-4111-8111-111111111111';
const HISTOIRE = 'Nina entre dans la salle. Marco la regarde. Le jour se leve sur la salle vide.';
const DUREE_MESUREE = 12.5;

let racines: string[] = [];
afterEach(async () => { for (const r of racines) await rm(r, { recursive: true, force: true }); racines = []; });

function quotaDouble(reponse: Awaited<ReturnType<QuotaProduction['reserver']>>) {
  const appels: Array<[string, ...unknown[]]> = [];
  const quota: QuotaProduction = {
    reserver: async (...a) => { appels.push(['reserver', ...a]); return reponse; },
    finaliser: async (...a) => { appels.push(['finaliser', ...a]); },
    liberer: async (...a) => { appels.push(['liberer', ...a]); },
  };
  return { quota, appels };
}

async function produire(quota: QuotaProduction, o: { rendEchoue?: boolean } = {}) {
  const racine = await mkdtemp(path.join(tmpdir(), 'cinema-abo-prod-'));
  racines.push(racine);
  const films = depotFilmsMemoire();
  const travaux = depotTravauxMemoire(() => new Date('2026-11-10T10:00:00Z'));
  const objets = objetsMemoire();
  const rendus: string[] = [];
  const controle = async (fichier: string) => ({
    fichier, octets: (await stat(fichier)).size, dureeS: DUREE_MESUREE, largeur: 1920, hauteur: 1080, codecVideo: 'h264', codecAudio: 'aac',
  });
  const moteurs: MoteursProduction = {
    synthetiser: async () => ({ voix: {}, details: [], echecs: [], moteur: 'edge', motifRepli: null }),
    mesurerVoix: async () => ({}),
    preparerRendu: async () => async (t) => {
      if (o.rendEchoue) throw new Error('chromium a plante');
      rendus.push(path.basename(t.sortie));
      await mkdir(path.dirname(t.sortie), { recursive: true });
      await writeFile(t.sortie, 'mp4');
      return controle(t.sortie);
    },
    concatener: async (fichiers, sortie) => {
      await mkdir(path.dirname(sortie), { recursive: true });
      await writeFile(sortie, (await Promise.all(fichiers.map((f) => readFile(f, 'utf-8')))).join('+'));
      return controle(sortie);
    },
    controler: controle,
  };
  const film = preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'x' }], idFilm: 'film-prod', maintenant: () => new Date('2026-11-10T09:00:00Z') });
  await films.creer(film, A);
  const dep: DependancesExecuteur = {
    films, travaux, objets, moteurs, racine, dossierTravail: path.join(racine, 'travail'), plafondUsd: 2,
    ressources: { lire: () => ({ rendusEnCours: 0, ramLibreMo: 64_000, cpus: 8 }), pause: async () => {} },
    quota,
  };
  const lu = (await films.lire(film.id, A))!;
  const t = (await travaux.creerOuRetrouver({ film: lu.film, proprietaire: A, cle: cleTravail(lu.film, []), scenesDemandees: [], maxActifs: 2 })).travail!;
  const issue = await executerTravail(t.id, A, dep);
  return { issue, rendus, travail: (await travaux.lire(t.id, A))!, dureePrevue: dureeFilm(film), travailId: t.id };
}

describe('production et minutes d’abonnement', () => {
  it('film concerne : reserve AVANT de rendre, finalise sur la duree MESUREE, jamais libere', async () => {
    const { quota, appels } = quotaDouble({ ok: true, reserve: true });
    const { issue, dureePrevue, travailId } = await produire(quota);
    expect(issue).toBe('termine');
    expect(appels.map((a) => a[0])).toEqual(['reserver', 'finaliser']);
    const ref = appels[0][4] as string;
    expect(ref).toMatch(new RegExp(`^cinema-production:${travailId}:`));
    expect(appels[0]).toEqual(['reserver', A, 'film-prod', dureePrevue, ref]);
    expect(appels[1]).toEqual(['finaliser', A, ref, DUREE_MESUREE]);
  });

  it('minutes insuffisantes : RIEN n’est rendu, le travail echoue avec la raison', async () => {
    const { quota, appels } = quotaDouble({ ok: false, message: 'Vous avez utilise toutes les minutes incluses ce mois-ci.' });
    const { issue, rendus, travail } = await produire(quota);
    expect(issue).toBe('echec');
    expect(rendus).toEqual([]);
    expect(travail.erreur).toMatch(/minutes incluses/);
    expect(appels.map((a) => a[0])).toEqual(['reserver']);
  });

  it('rendu non abouti : l’ajustement reserve est LIBERE (rien n’a ete produit)', async () => {
    const { quota, appels } = quotaDouble({ ok: true, reserve: true });
    const { issue } = await produire(quota, { rendEchoue: true });
    expect(issue).toBe('echec');
    expect(appels.map((a) => a[0])).toEqual(['reserver', 'liberer']);
    expect(appels[1][2]).toBe(appels[0][4]);
  });

  it('film non concerne (aucune generation payante, ou hors abonnement) : ni finalisation ni liberation', async () => {
    const { quota, appels } = quotaDouble({ ok: true, reserve: false });
    expect((await produire(quota)).issue).toBe('termine');
    expect(appels.map((a) => a[0])).toEqual(['reserver']);
  });
});
