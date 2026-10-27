/**
 * CINEMA IA — CORRECTIF SÉCURITÉ : le bail (lease) d'une génération, pas son âge.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA FAILLE (revue automatique, 2026-10-27)
 * ─────────────────────────────────────────────────────────────────────────
 * `statutEffectif` déclarait une génération `en_cours` depuis plus de 15 min
 * (`DELAI_GENERATION_PERIMEE_MS`) comme `interrompue` — et `solderGenerationsInterrompues`
 * la REMBOURSAIT — sur la seule foi de son AGE DEPUIS CRÉATION, jamais sur l'état réel de
 * l'exécuteur. Un appel vidéo Replicate légitime (jusqu'à 10 min, `DELAI_VIDEO_MS`) plus
 * le téléchargement et le dépôt du résultat pouvait suffire à dépasser les 15 min SOUS
 * CHARGE, pendant que l'exécuteur tournait toujours. Le résultat tardif écrivait alors
 * `reussie` PAR-DESSUS un remboursement déjà effectué : l'utilisateur récupérait ses
 * crédits ET la vidéo, pendant que le compte Replicate du propriétaire avait été facturé
 * pour rien.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE CORRECTIF
 * ─────────────────────────────────────────────────────────────────────────
 * Un BAIL persistant (`bailJusqua`, même principe que `travaux/types.ts` → `bailJusqua`,
 * `BAIL_S`), renouvelé par battement de cœur PENDANT l'exécution (`executeur-generation.ts`).
 * `statutEffectif` juge sur l'ÉCHÉANCE DU BAIL, jamais sur l'âge. Toute écriture TERMINALE
 * (succès, échec, interruption) est GARDÉE : elle ne s'applique QUE si la génération est
 * encore `en_cours` au moment exact de l'écriture (atomique, `modifierFilm` rejoue sur
 * conflit) — jamais par-dessus un état déjà tranché ailleurs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preparerFilm } from '@/lib/cinema/atelier';
import { depotFilmsMemoire, modifierFilm } from '@/lib/cinema/stockage/depot-films';
import {
  reserverGeneration, statutEffectif, renouvelerBailGeneration, appliquerPatchTerminal,
  DELAI_GENERATION_PERIMEE_MS, BAIL_GENERATION_S,
} from '@/lib/cinema/generation/suivi';
import type { GenerationSuivie } from '@/lib/cinema/types';

const rembourser = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: async () => null }));
vi.mock('@/lib/cinema/generation/credits', async (orig) => ({
  ...(await orig<typeof import('@/lib/cinema/generation/credits')>()),
  rembourserCredits: (...a: unknown[]) => rembourser(...a),
}));

const U = '11111111-1111-4111-8111-111111111111';
const HISTOIRE = 'Nina entre dans la salle. Marco la regarde. Le jour se leve.';

async function filmEnDepot(idFilm = 'film-bail-1') {
  const depot = depotFilmsMemoire();
  const film = { ...preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }], idFilm, titre: 't' }), proprietaire: U };
  await depot.creer(film, U);
  return { depot, film, planId: film.scenes[0].plans[0].id };
}

beforeEach(() => { rembourser.mockReset(); rembourser.mockResolvedValue({ ok: true }); });

describe('REPRODUCTION — une generation active ne doit JAMAIS etre jugee sur son age seul', () => {
  it('bail renouvele AU-DELA de l’ancien seuil de 15 min : `statutEffectif` la dit toujours `en_cours`', () => {
    const t = Date.parse('2026-10-27T10:00:00Z');
    // Creee il y a 20 min (> DELAI_GENERATION_PERIMEE_MS) — sous l'ANCIEN code, ce seul
    // fait suffisait a la declarer `interrompue`. Mais son bail a ete renouvele il y a 10 s :
    // un executeur est manifestement encore vivant.
    const creeLe = new Date(t - 20 * 60_000).toISOString();
    const bailJusqua = new Date(t - 10_000 + BAIL_GENERATION_S * 1000).toISOString();
    const g: GenerationSuivie = { id: 'g', planId: 'p', operation: 'video', mode: 'reelle', statut: 'en_cours', creeLe, majLe: creeLe, bailJusqua };
    expect(t - Date.parse(creeLe)).toBeGreaterThan(DELAI_GENERATION_PERIMEE_MS); // bien plus vieux que l'ancien seuil
    expect(statutEffectif(g, t)).toBe('en_cours'); // et pourtant : toujours vivante
  });

  it('bail EXPIRE (aucun battement depuis longtemps) : correctement `interrompue`, meme recente', () => {
    const t = Date.parse('2026-10-27T10:00:00Z');
    const creeLe = new Date(t - 2 * 60_000).toISOString(); // creee il y a 2 min seulement
    const bailJusqua = new Date(t - 1_000).toISOString(); // mais le bail a expire il y a 1 s
    const g: GenerationSuivie = { id: 'g', planId: 'p', operation: 'video', mode: 'reelle', statut: 'en_cours', creeLe, majLe: creeLe, bailJusqua };
    expect(statutEffectif(g, t)).toBe('interrompue');
  });

  it('generation ANTERIEURE a ce champ (pas de migration, `bailJusqua` absent) : repli sur l’ancien seuil par age', () => {
    const t = Date.parse('2026-10-27T10:00:00Z');
    const vieille: GenerationSuivie = {
      id: 'g', planId: 'p', operation: 'video', mode: 'reelle', statut: 'en_cours',
      creeLe: new Date(t - DELAI_GENERATION_PERIMEE_MS - 1).toISOString(), majLe: '',
    };
    expect(statutEffectif(vieille, t)).toBe('interrompue');
    const recente: GenerationSuivie = { ...vieille, creeLe: new Date(t - 60_000).toISOString() };
    expect(statutEffectif(recente, t)).toBe('en_cours');
  });
});

describe('le battement de coeur renouvelle le bail — et seulement si la generation est encore active', () => {
  it('renouvelle avec succes une generation `en_cours`', async () => {
    const { depot, film, planId } = await filmEnDepot();
    const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'video', mode: 'reelle' });
    expect(r.ok).toBe(true);
    const id = (r as { generation: GenerationSuivie }).generation.id;
    const avant = (await depot.lire(film.id, U))!.film.generations![0].bailJusqua!;
    await new Promise((res) => setTimeout(res, 5));
    expect(await renouvelerBailGeneration(depot, film.id, U, id)).toBe(true);
    const apres = (await depot.lire(film.id, U))!.film.generations![0].bailJusqua!;
    expect(Date.parse(apres)).toBeGreaterThan(Date.parse(avant));
  });

  it('refuse (false, rien ecrit) sur une generation DEJA tranchee — ex. deja interrompue', async () => {
    const { depot, film, planId } = await filmEnDepot();
    const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'video', mode: 'reelle' });
    const id = (r as { generation: GenerationSuivie }).generation.id;
    await modifierFilm(depot, film.id, U, (f) => ({ ...f, generations: f.generations!.map((g) => g.id === id ? { ...g, statut: 'interrompue' as const, bailJusqua: null } : g) }));
    expect(await renouvelerBailGeneration(depot, film.id, U, id)).toBe(false);
    expect((await depot.lire(film.id, U))!.film.generations![0].bailJusqua).toBeNull();
  });
});

describe('ECRITURE TERMINALE GARDEE — un resultat tardif n’ecrase jamais un etat deja tranche', () => {
  async function genereInterrompue() {
    const { depot, film, planId } = await filmEnDepot('film-bail-2');
    const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'video', mode: 'reelle' });
    const id = (r as { generation: GenerationSuivie }).generation.id;
    // Simule EXACTEMENT ce que `solderGenerationsInterrompues` ecrit : remboursee, interrompue.
    await modifierFilm(depot, film.id, U, (f) => ({
      ...f,
      generations: f.generations!.map((g) => g.id === id
        ? { ...g, statut: 'interrompue' as const, creditsPris: 15, creditsRembourses: true, bailJusqua: null }
        : g),
    }));
    return { depot, film, planId, id };
  }

  it('SCENARIO DE LA FAILLE — un succes qui arrive APRES remboursement ne livre JAMAIS le media (le detruit), et ne touche pas le statut', async () => {
    const { depot, film, id } = await genereInterrompue();
    let surFilmAppele = false;
    const suivant = await appliquerPatchTerminal(depot, film.id, U, id, { statut: 'reussie', erreur: null }, (f) => {
      surFilmAppele = true; // si ceci s'execute, le media aurait ete attache — EXACTEMENT la faille
      return { ...f, titre: 'FUITE : media livre gratuitement' };
    });
    expect(suivant).toBeNull(); // rien ecrit
    expect(surFilmAppele).toBe(false); // le transformateur de media n'est JAMAIS invoque
    const relu = (await depot.lire(film.id, U))!.film;
    expect(relu.titre).not.toBe('FUITE : media livre gratuitement');
    const g = relu.generations!.find((x) => x.id === id)!;
    expect(g.statut).toBe('interrompue'); // jamais ecrase en `reussie`
    expect(g.creditsRembourses).toBe(true); // la preuve du remboursement n'est pas effacee
  });

  it('un echec qui arrive APRES remboursement n’ecrase pas non plus le statut `interrompue`', async () => {
    const { depot, film, id } = await genereInterrompue();
    const suivant = await appliquerPatchTerminal(depot, film.id, U, id, { statut: 'echouee', erreur: 'timeout fournisseur' });
    expect(suivant).toBeNull();
    const g = (await depot.lire(film.id, U))!.film.generations!.find((x) => x.id === id)!;
    expect(g.statut).toBe('interrompue');
    expect(g.erreur).not.toBe('timeout fournisseur');
  });

  it('a l’inverse : une generation TOUJOURS `en_cours` accepte normalement son resultat terminal', async () => {
    const { depot, film, planId } = await filmEnDepot('film-bail-3');
    const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'video', mode: 'reelle' });
    const id = (r as { generation: GenerationSuivie }).generation.id;
    const suivant = await appliquerPatchTerminal(depot, film.id, U, id, { statut: 'reussie', erreur: null }, (f) => ({ ...f, titre: 'livre normalement' }));
    expect(suivant).not.toBeNull();
    expect(suivant!.titre).toBe('livre normalement');
    const g = (await depot.lire(film.id, U))!.film.generations!.find((x) => x.id === id)!;
    expect(g.statut).toBe('reussie');
    expect(g.bailJusqua).toBeNull(); // plus besoin d'etre protegee, c'est termine
  });
});

describe('solderGenerationsInterrompues — TOCTOU corrige, decide sur une lecture FRAICHE', () => {
  it('NE REMBOURSE PAS une generation dont le bail a ete renouvele entre-temps (executeur toujours vivant)', async () => {
    const { solderGenerationsInterrompues } = await import('@/lib/cinema/generation/executeur-generation');
    const { depot, film, planId } = await filmEnDepot('film-bail-4');
    const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'video', mode: 'reelle' });
    const id = (r as { generation: GenerationSuivie }).generation.id;
    await modifierFilm(depot, film.id, U, (f) => ({
      ...f, generations: f.generations!.map((g) => g.id === id ? { ...g, creditsPris: 15, referenceCredits: 'cinema-generation:bail-4' } : g),
    }));
    // L'instantane PASSE a la fonction est PERIME (lu avant que l'executeur ne renouvelle) :
    // sous l'ANCIEN code, une decision prise sur cet instantane aurait pu rembourser a tort.
    const instantanePerime = structuredClone((await depot.lire(film.id, U))!.film);
    await modifierFilm(depot, film.id, U, (f) => ({ ...f, generations: f.generations!.map((g) => g.id === id ? { ...g, bailJusqua: new Date(Date.now() + 60_000).toISOString() } : g) }));

    await solderGenerationsInterrompues({ films: depot }, film.id, U, instantanePerime);

    expect(rembourser).not.toHaveBeenCalled();
    const g = (await depot.lire(film.id, U))!.film.generations!.find((x) => x.id === id)!;
    expect(g.statut).toBe('en_cours');
  });

  it('rembourse correctement une generation REELLEMENT interrompue (bail expire, relu a jour)', async () => {
    const { solderGenerationsInterrompues } = await import('@/lib/cinema/generation/executeur-generation');
    const { depot, film, planId } = await filmEnDepot('film-bail-5');
    const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'video', mode: 'reelle' });
    const id = (r as { generation: GenerationSuivie }).generation.id;
    await modifierFilm(depot, film.id, U, (f) => ({
      ...f,
      generations: f.generations!.map((g) => g.id === id
        ? { ...g, creditsPris: 15, referenceCredits: 'cinema-generation:bail-5', bailJusqua: new Date(Date.now() - 1_000).toISOString() }
        : g),
    }));
    const lu = (await depot.lire(film.id, U))!.film;
    await solderGenerationsInterrompues({ films: depot }, film.id, U, lu);
    expect(rembourser).toHaveBeenCalledTimes(1);
    const g = (await depot.lire(film.id, U))!.film.generations!.find((x) => x.id === id)!;
    expect(g).toMatchObject({ statut: 'interrompue', creditsRembourses: true });
  });

  it('CONCURRENCE — la reconciliation et la conclusion de l’executeur s’executent en meme temps : UN SEUL l’emporte, jamais les deux', async () => {
    const { solderGenerationsInterrompues } = await import('@/lib/cinema/generation/executeur-generation');
    const { depot, film, planId } = await filmEnDepot('film-bail-6');
    const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'video', mode: 'reelle' });
    const id = (r as { generation: GenerationSuivie }).generation.id;
    await modifierFilm(depot, film.id, U, (f) => ({
      ...f,
      generations: f.generations!.map((g) => g.id === id
        ? { ...g, creditsPris: 15, referenceCredits: 'cinema-generation:bail-6', bailJusqua: new Date(Date.now() - 1_000).toISOString() }
        : g),
    }));
    const lu = (await depot.lire(film.id, U))!.film;

    // Les deux partent EN MEME TEMPS : la reconciliation (qui va rembourser) et la
    // conclusion de l'executeur (qui va livrer le media), exactement le scenario de la
    // revue de securite — « deux processus concurrents ».
    const [, suivant] = await Promise.all([
      solderGenerationsInterrompues({ films: depot }, film.id, U, lu),
      appliquerPatchTerminal(depot, film.id, U, id, { statut: 'reussie', erreur: null }, (f) => ({ ...f, titre: 'media livre' })),
    ]);

    const g = (await depot.lire(film.id, U))!.film.generations!.find((x) => x.id === id)!;
    // Jamais les DEUX a la fois : soit remboursee (interrompue), soit livree (reussie) —
    // pas de monde ou l'utilisateur recupere le remboursement ET le media.
    const remboursee = g.statut === 'interrompue' && g.creditsRembourses === true;
    const livree = g.statut === 'reussie' && suivant !== null;
    expect(remboursee !== livree).toBe(true); // XOR strict : exactement un des deux
    if (remboursee) expect(suivant).toBeNull(); // la livraison a bien ete rejetee
    if (livree) expect(rembourser).not.toHaveBeenCalled(); // le remboursement a bien ete rejete
  });
});
