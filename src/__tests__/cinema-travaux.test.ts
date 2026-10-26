// @vitest-environment node
/**
 * CINEMA IA — la production ASYNCHRONE : travaux, reprise, cache de scene.
 *
 * Chromium, ffmpeg et la voix sont remplaces par des moteurs fictifs : ce qui
 * est teste ici, c'est l'ORCHESTRATION — qui rend quoi, dans quel ordre, avec
 * quelle progression, et ce qui survit a une interruption. Le rendu reel est
 * prouve par le banc (`tests-cinema/`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { preparerFilm } from '@/lib/cinema/atelier';
import { scenesAReproduire, empreinteScene } from '@/lib/cinema/empreinte';
import { appliquerPatch } from '@/lib/cinema/patch';
import { cleMedia, cleScene } from '@/lib/cinema/stockage/cles';
import { depotFilmsMemoire, modifierFilm } from '@/lib/cinema/stockage/depot-films';
import { objetsMemoire } from '@/lib/cinema/stockage/objets';
import { depotTravauxMemoire } from '@/lib/cinema/travaux/depot-travaux';
import { executerTravail, type DependancesExecuteur, type MoteursProduction } from '@/lib/cinema/travaux/executeur';
import {
  BAIL_S, TENTATIVES_MAX, cleTravail, pourcent, presenterTravail, repriseAutorisee, scenesValides,
} from '@/lib/cinema/travaux/types';
import { demarrerTravail, attendreFile, reinitialiserLanceurPourTests, reprendreOrphelins } from '@/lib/cinema/travaux/lanceur';
import type { Film } from '@/lib/cinema/types';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Nina murmure « je ne reculerai pas ». Marco hoche la tete. Le jour se leve sur la salle vide.';

const controle = async (fichier: string) => ({
  fichier, octets: (await stat(fichier)).size, dureeS: 12.5, largeur: 1920, hauteur: 1080, codecVideo: 'h264', codecAudio: 'aac',
});

interface Monde {
  film: Film; films: ReturnType<typeof depotFilmsMemoire>; travaux: ReturnType<typeof depotTravauxMemoire>;
  objets: ReturnType<typeof objetsMemoire>; dep: DependancesExecuteur; horloge: { t: Date };
  rendus: string[]; publicDirs: string[]; racine: string; dossierTravail: string;
  surRendu: { fn: ((sceneId: string) => Promise<void>) | null };
}

let racines: string[] = [];
async function monde(options: { plafondUsd?: number } = {}): Promise<Monde> {
  const racine = await mkdtemp(path.join(tmpdir(), 'cinema-travaux-'));
  racines.push(racine);
  const dossierTravail = path.join(racine, 'var', 'cinema', 'travail');
  const horloge = { t: new Date('2026-10-26T10:00:00Z') };
  const films = depotFilmsMemoire();
  const travaux = depotTravauxMemoire(() => horloge.t);
  const objets = objetsMemoire();
  const rendus: string[] = [];
  const publicDirs: string[] = [];
  const surRendu: Monde['surRendu'] = { fn: null };

  const moteurs: MoteursProduction = {
    synthetiser: async () => ({ voix: {}, details: [], echecs: [], moteur: 'edge', motifRepli: null }),
    mesurerVoix: async () => ({}),
    preparerRendu: async (o) => {
      publicDirs.push(o.publicDir ?? '');
      return async (t) => {
        const id = path.basename(t.sortie, '.mp4');
        rendus.push(id);
        await mkdir(path.dirname(t.sortie), { recursive: true });
        await writeFile(t.sortie, `mp4:${id}`);
        if (surRendu.fn) await surRendu.fn(id);
        return controle(t.sortie);
      };
    },
    concatener: async (fichiers, sortie) => {
      const morceaux = await Promise.all(fichiers.map((f) => readFile(f, 'utf-8')));
      await mkdir(path.dirname(sortie), { recursive: true });
      await writeFile(sortie, morceaux.join('+'));
      return controle(sortie);
    },
    controler: controle,
  };

  const film = preparerFilm({
    histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }],
    idFilm: 'film-trav-1', maintenant: () => new Date('2026-10-26T09:00:00Z'),
  });
  await films.creer(film, A);
  const dep: DependancesExecuteur = {
    films, travaux, objets, moteurs, racine, dossierTravail, plafondUsd: options.plafondUsd ?? 2, maintenant: () => horloge.t,
  };
  return { film: { ...film, proprietaire: A }, films, travaux, objets, dep, horloge, rendus, publicDirs, racine, dossierTravail, surRendu };
}

async function lancer(m: Monde, scenesDemandees: string[] = []) {
  const lu = (await m.films.lire(m.film.id, A))!;
  const r = await m.travaux.creerOuRetrouver({
    film: lu.film, proprietaire: A, cle: cleTravail(lu.film, scenesDemandees), scenesDemandees, maxActifs: 2,
  });
  return r.travail!;
}

afterEach(async () => {
  reinitialiserLanceurPourTests();
  for (const r of racines) await rm(r, { recursive: true, force: true });
  racines = [];
});

describe('pourcent — derive de l\'etat reel', () => {
  it('suit les scenes terminees, pas une animation', () => {
    const scenes = (e: Array<'a_faire' | 'faite' | 'reutilisee'>) => Object.fromEntries(e.map((x, i) => [`s${i}`, x]));
    expect(pourcent({ etape: 'preparation', scenes: scenes(['a_faire', 'a_faire']) })).toBe(0);
    expect(pourcent({ etape: 'voix', scenes: scenes(['a_faire', 'a_faire']) })).toBe(5);
    expect(pourcent({ etape: 'rendu', scenes: scenes(['a_faire', 'a_faire']) })).toBe(15);
    expect(pourcent({ etape: 'rendu', scenes: scenes(['faite', 'a_faire']) })).toBe(53);
    expect(pourcent({ etape: 'rendu', scenes: scenes(['faite', 'reutilisee']) })).toBe(90);
    expect(pourcent({ etape: 'assemblage', scenes: scenes(['faite', 'faite']) })).toBe(90);
    expect(pourcent({ etape: 'termine', scenes: scenes(['faite']) })).toBe(100);
  });
  it('ne depasse jamais 99 avant la fin', () => {
    expect(pourcent({ etape: 'rendu', scenes: { s: 'faite' } })).toBeLessThan(100);
  });
});

describe('cle de travail et reprise', () => {
  it('stable pour un film inchange, differente des qu\'une scene change', async () => {
    const m = await monde();
    expect(cleTravail(m.film, [])).toBe(cleTravail(m.film, []));
    expect(cleTravail(m.film, ['s1', 's2'])).toBe(cleTravail(m.film, ['s2', 's1']));
    expect(cleTravail(m.film, ['s1'])).not.toBe(cleTravail(m.film, []));
    const modifie = appliquerPatch(m.film, { plans: [{ id: m.film.scenes[0].plans[0].id, texte: 'Autre chose' }] });
    expect(cleTravail(modifie, [])).not.toBe(cleTravail(m.film, []));
  });

  it('scenesValides ne garde que les scenes du film, sans doublon', async () => {
    const m = await monde();
    const id = m.film.scenes[0].id;
    expect(scenesValides(m.film, [id, id, 'inconnue', 42, null])).toEqual([id]);
    expect(scenesValides(m.film, 'pas un tableau')).toEqual([]);
  });

  it('repriseAutorisee : en attente, bail expire, jamais au-dela de la limite', () => {
    const now = new Date('2026-10-26T10:00:00Z');
    const passe = new Date(now.getTime() - 1000).toISOString();
    const futur = new Date(now.getTime() + 1000).toISOString();
    expect(repriseAutorisee({ statut: 'en_attente', tentatives: 0, bailJusqua: null }, now)).toBe(true);
    expect(repriseAutorisee({ statut: 'en_cours', tentatives: 1, bailJusqua: passe }, now)).toBe(true);
    expect(repriseAutorisee({ statut: 'en_cours', tentatives: 1, bailJusqua: futur }, now)).toBe(false);
    expect(repriseAutorisee({ statut: 'en_cours', tentatives: TENTATIVES_MAX, bailJusqua: passe }, now)).toBe(false);
    expect(repriseAutorisee({ statut: 'termine', tentatives: 1, bailJusqua: null }, now)).toBe(false);
  });
});

describe('depot de travaux — un seul actif par film, un seul executeur par prise', () => {
  it('creerOuRetrouver : le second appel retrouve le premier', async () => {
    const m = await monde();
    const lu = (await m.films.lire(m.film.id, A))!;
    const demande = { film: lu.film, proprietaire: A, cle: 'c', scenesDemandees: [], maxActifs: 2 };
    const un = await m.travaux.creerOuRetrouver(demande);
    const deux = await m.travaux.creerOuRetrouver(demande);
    expect(un.cree).toBe(true);
    expect(deux.cree).toBe(false);
    expect(deux.travail!.id).toBe(un.travail!.id);
    expect(m.travaux.tous()).toHaveLength(1);
  });

  it('plafonne les travaux actifs par compte', async () => {
    const m = await monde();
    const f2 = { ...m.film, id: 'film-trav-2' }; const f3 = { ...m.film, id: 'film-trav-3' };
    const d = (film: Film) => ({ film, proprietaire: A, cle: 'c', scenesDemandees: [], maxActifs: 2 });
    expect((await m.travaux.creerOuRetrouver(d(m.film))).cree).toBe(true);
    expect((await m.travaux.creerOuRetrouver(d(f2))).cree).toBe(true);
    expect(await m.travaux.creerOuRetrouver(d(f3))).toMatchObject({ cree: false, motif: 'trop_de_travaux', travail: null });
  });

  it('un travail n\'est lisible que par son proprietaire', async () => {
    const m = await monde();
    const t = await lancer(m);
    expect(await m.travaux.lire(t.id, A)).not.toBeNull();
    expect(await m.travaux.lire(t.id, B)).toBeNull();
    expect(await m.travaux.demanderAnnulation(t.id, B)).toBeNull();
  });

  it('reclamer : deux executeurs en meme temps, un seul gagne', async () => {
    const m = await monde();
    const t = await lancer(m);
    const [x, y] = await Promise.all([m.travaux.reclamer(t.id, BAIL_S, m.horloge.t), m.travaux.reclamer(t.id, BAIL_S, m.horloge.t)]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
  });

  it('reclamer : un bail vivant protege, un bail expire se reprend', async () => {
    const m = await monde();
    const t = await lancer(m);
    const premier = await m.travaux.reclamer(t.id, BAIL_S, m.horloge.t);
    expect(premier!.tentatives).toBe(1);
    expect(await m.travaux.reclamer(t.id, BAIL_S, m.horloge.t)).toBeNull();
    m.horloge.t = new Date(m.horloge.t.getTime() + (BAIL_S + 1) * 1000);
    const second = await m.travaux.reclamer(t.id, BAIL_S, m.horloge.t);
    expect(second!.tentatives).toBe(2);
  });

  it('jeton de prise : l\'executeur perime ne peut plus rien ecrire', async () => {
    const m = await monde();
    const t = await lancer(m);
    const p1 = (await m.travaux.reclamer(t.id, BAIL_S, m.horloge.t))!;
    m.horloge.t = new Date(m.horloge.t.getTime() + (BAIL_S + 1) * 1000);
    const p2 = (await m.travaux.reclamer(t.id, BAIL_S, m.horloge.t))!;
    expect((await m.travaux.noter(t.id, p1.tentatives, p1.progression, BAIL_S)).perdu).toBe(true);
    expect(await m.travaux.terminer(t.id, p1.tentatives, {} as never, p1.progression)).toBe(false);
    expect(await m.travaux.echouer(t.id, p1.tentatives, 'x', null)).toBe(false);
    expect((await m.travaux.noter(t.id, p2.tentatives, p2.progression, BAIL_S)).perdu).toBe(false);
  });

  it('au-dela de la limite de prises, le travail passe en echec au lieu de boucler', async () => {
    const m = await monde();
    const t = await lancer(m);
    for (let i = 0; i < TENTATIVES_MAX; i++) {
      expect(await m.travaux.reclamer(t.id, BAIL_S, m.horloge.t)).not.toBeNull();
      m.horloge.t = new Date(m.horloge.t.getTime() + (BAIL_S + 1) * 1000);
    }
    expect(await m.travaux.reclamer(t.id, BAIL_S, m.horloge.t)).toBeNull();
    const fin = (await m.travaux.lire(t.id, A))!;
    expect(fin.statut).toBe('echec');
    expect(fin.erreur).toMatch(/tentatives/);
    expect(await m.travaux.aReprendre(m.horloge.t)).toEqual([]);
  });

  it('presenterTravail ne laisse sortir aucune cle d\'objet', async () => {
    const m = await monde();
    const t = await lancer(m);
    const avecResultat = { ...t, resultat: { cleMp4: `${A}/cinema/film-trav-1/exports/film-deadbeef.mp4`, scenesRendues: [], scenesReutilisees: [], avertissements: [], dureeS: 1, octets: 1, largeur: 1, hauteur: 1, codecVideo: 'h264', codecAudio: 'aac', coutUsd: 0 } };
    const json = JSON.stringify(presenterTravail(avecResultat));
    expect(json).not.toContain('exports/');
    expect(json).not.toContain(A);
    expect(JSON.parse(json).resultat.aMp4).toBe(true);
  });
});

describe('executeur — production complete', () => {
  it('rend chaque scene, assemble, depose, scelle, nettoie', async () => {
    const m = await monde();
    const t = await lancer(m);
    expect(await executerTravail(t.id, A, m.dep)).toBe('termine');

    const fin = (await m.travaux.lire(t.id, A))!;
    expect(fin.statut).toBe('termine');
    expect(fin.progression.pourcent).toBe(100);
    expect(Object.values(fin.progression.scenes).every((e) => e === 'faite')).toBe(true);
    expect(fin.resultat!.scenesRendues).toEqual(m.film.scenes.map((s) => s.id));
    expect(fin.resultat!.scenesReutilisees).toEqual([]);
    expect(fin.resultat!.coutUsd).toBe(0);
    expect(fin.resultat!.octets).toBeGreaterThan(0);

    // Des objets DURABLES : une scene par empreinte, et le film recolle.
    const lu = (await m.films.lire(m.film.id, A))!.film;
    for (const s of m.film.scenes) {
      expect(m.objets.cles()).toContain(cleScene(A, m.film.id, s.id, empreinteScene(s, m.film.personnages))!);
    }
    expect(m.objets.cles().filter((c) => c.includes('/exports/'))).toHaveLength(1);
    expect(fin.resultat!.cleMp4).toMatch(new RegExp(`^${A}/cinema/film-trav-1/exports/film-[0-9a-f]{8}\\.mp4$`));
    // Le film recolle contient les scenes dans l'ordre.
    const mp4 = new TextDecoder().decode(m.objets.contenu(fin.resultat!.cleMp4!)!);
    expect(mp4).toBe(m.film.scenes.map((s) => `mp4:${s.id}`).join('+'));

    // Scellees : plus rien a reproduire. Rien de ce dossier ne reste.
    expect(scenesAReproduire(lu)).toEqual([]);
    expect(await readdir(m.dossierTravail)).toEqual([]);
  });

  it('les medias prives vont dans le dossier de travail, JAMAIS dans public/', async () => {
    const m = await monde();
    const plan = m.film.scenes[0].plans[0];
    const url = `cinema/${m.film.id}/medias/${plan.id}-abcd1234.png`;
    const avecMedia = { ...m.film, scenes: m.film.scenes.map((s, i) => i ? s : { ...s, plans: s.plans.map((p) => p.id === plan.id ? { ...p, media: { url, genre: 'image' as const, largeur: 10, hauteur: 10, dureeS: null, octets: 4, origine: 'import' as const } } : p) }) };
    await modifierFilm(m.films, m.film.id, A, () => avecMedia);
    await m.objets.deposerOctets(cleMedia(A, m.film.id, url)!, new Uint8Array([1, 2, 3, 4]), 'image/png');

    let vu = false;
    m.surRendu.fn = async () => { vu = (await stat(path.join(m.publicDirs[0], url))).size === 4; };
    const t = await lancer(m);
    expect(await executerTravail(t.id, A, m.dep)).toBe('termine');
    expect(vu).toBe(true);                                          // le rendu a vu le media...
    expect(m.publicDirs[0]).toContain(path.join('var', 'cinema', 'travail'));   // ...dans le dossier de travail
    await expect(stat(path.join(m.racine, 'public'))).rejects.toThrow();       // ...et public/ n'a jamais existe
  });

  it('un media declare et absent ARRETE le travail avec la liste des plans — pas de carte de secours', async () => {
    const m = await monde();
    const plan = m.film.scenes[0].plans[0];
    const url = `cinema/${m.film.id}/medias/${plan.id}-abcd1234.mp4`;
    await modifierFilm(m.films, m.film.id, A, (f) => ({ ...f, scenes: f.scenes.map((s, i) => i ? s : { ...s, plans: s.plans.map((p) => p.id === plan.id ? { ...p, media: { url, genre: 'video' as const, largeur: 10, hauteur: 10, dureeS: 3, octets: 4, origine: 'import' as const } } : p) }) }));
    const t = await lancer(m);
    expect(await executerTravail(t.id, A, m.dep)).toBe('echec');
    const fin = (await m.travaux.lire(t.id, A))!;
    expect(fin.statut).toBe('echec');
    expect(fin.erreur).toContain(plan.id);
    expect(m.rendus).toEqual([]);
    expect(m.objets.cles()).toEqual([]);
  });

  it('le detail technique d\'un echec reste dans le journal, la ligne ne porte qu\'une reference', async () => {
    const m = await monde();
    m.dep.moteurs.preparerRendu = async () => { throw new Error('Chromium: /home/studiio/secret/chemin crashed'); };
    const t = await lancer(m);
    expect(await executerTravail(t.id, A, m.dep)).toBe('echec');
    const fin = (await m.travaux.lire(t.id, A))!;
    expect(fin.erreur).toMatch(/^echec de production \(reference [a-z0-9]+\)$/);
    expect(fin.erreur).not.toContain('secret');
    expect(fin.reference).toMatch(/^[a-z0-9]+$/);
  });
});

describe('executeur — ne regenerer que ce qui change', () => {
  it('relancer un film deja produit ne rend RIEN (pas de double generation)', async () => {
    const m = await monde();
    await executerTravail((await lancer(m)).id, A, m.dep);
    const avant = m.rendus.length;
    const t2 = await lancer(m);
    expect(await executerTravail(t2.id, A, m.dep)).toBe('termine');
    expect(m.rendus.length).toBe(avant);
    const fin = (await m.travaux.lire(t2.id, A))!;
    expect(fin.resultat!.scenesRendues).toEqual([]);
    expect(fin.resultat!.scenesReutilisees).toEqual(m.film.scenes.map((s) => s.id));
    expect(Object.values(fin.progression.scenes).every((e) => e === 'reutilisee')).toBe(true);
  });

  it('modifier UNE scene ne refait que celle-la', async () => {
    const m = await monde();
    await executerTravail((await lancer(m)).id, A, m.dep);
    m.rendus.length = 0;

    const cible = m.film.scenes[1];
    await modifierFilm(m.films, m.film.id, A, (f) => appliquerPatch(f, { plans: [{ id: cible.plans[0].id, texte: 'Une description toute nouvelle du plan' }] }));
    const t2 = await lancer(m);
    expect(await executerTravail(t2.id, A, m.dep)).toBe('termine');

    expect(m.rendus).toEqual([cible.id]);
    const fin = (await m.travaux.lire(t2.id, A))!;
    expect(fin.resultat!.scenesRendues).toEqual([cible.id]);
    expect(fin.resultat!.scenesReutilisees).toEqual(m.film.scenes.filter((s) => s.id !== cible.id).map((s) => s.id));
    // Le film recolle reprend les scenes inchangees ET la nouvelle.
    const mp4 = new TextDecoder().decode(m.objets.contenu(fin.resultat!.cleMp4!)!);
    expect(mp4).toBe(m.film.scenes.map((s) => `mp4:${s.id}`).join('+'));
    // L'ancienne version de la scene n'est pas ecrasee : une cle par empreinte.
    expect(m.objets.cles().filter((c) => c.includes(`/scenes/${cible.id}-`))).toHaveLength(2);
  });

  it('une scene demandee explicitement est refaite, les autres reprises', async () => {
    const m = await monde();
    await executerTravail((await lancer(m)).id, A, m.dep);
    m.rendus.length = 0;
    const voulue = m.film.scenes[0].id;
    const t2 = await lancer(m, [voulue]);
    await executerTravail(t2.id, A, m.dep);
    expect(m.rendus).toEqual([voulue]);
  });

  it('une scene modifiee PENDANT le travail reste « a reproduire »', async () => {
    const m = await monde();
    const s0 = m.film.scenes[0];
    m.surRendu.fn = async (id) => {
      if (id !== s0.id) return;
      await modifierFilm(m.films, m.film.id, A, (f) => appliquerPatch(f, { plans: [{ id: s0.plans[0].id, texte: 'Modifiee pendant le rendu' }] }));
    };
    const t = await lancer(m);
    expect(await executerTravail(t.id, A, m.dep)).toBe('termine');
    const restant = scenesAReproduire((await m.films.lire(m.film.id, A))!.film).map((s) => s.id);
    expect(restant).toEqual([s0.id]);
  });
});

describe('executeur — interruption et reprise', () => {
  it('un executeur qui meurt : un autre reprend, les scenes terminees ne sont pas refaites', async () => {
    const m = await monde();
    expect(m.film.scenes.length).toBeGreaterThanOrEqual(3);
    const t = await lancer(m);

    // L'executeur 1 rend la scene 1, puis « meurt » en plein rendu de la scene 2.
    let liberer!: () => void;
    const bloque = new Promise<void>((r) => { liberer = r; });
    let signaleBloque!: () => void;
    const estBloque = new Promise<void>((r) => { signaleBloque = r; });
    const mort = m.film.scenes[1].id;
    m.surRendu.fn = async (id) => { if (id === mort && m.rendus.filter((x) => x === mort).length === 1) { signaleBloque(); await bloque; } };
    const premier = executerTravail(t.id, A, m.dep);
    await estBloque;
    expect(m.rendus).toEqual([m.film.scenes[0].id, mort]);

    // Le bail expire : le serveur est tombe. Un autre executeur reprend.
    m.horloge.t = new Date(m.horloge.t.getTime() + (BAIL_S + 5) * 1000);
    expect(await m.travaux.aReprendre(m.horloge.t)).toEqual([{ id: t.id, proprietaire: A }]);
    const rendusAvant = m.rendus.length;
    m.surRendu.fn = null;
    expect(await executerTravail(t.id, A, m.dep)).toBe('termine');

    // La scene 1 est reprise du stockage ; les autres sont rendues par l'executeur 2.
    const fin = (await m.travaux.lire(t.id, A))!;
    expect(fin.tentatives).toBe(2);
    expect(fin.resultat!.scenesReutilisees).toEqual([m.film.scenes[0].id]);
    expect(m.rendus.slice(rendusAvant)).toEqual(m.film.scenes.slice(1).map((s) => s.id));

    // L'ancien executeur se reveille : son jeton est perime, il ne touche a rien.
    liberer();
    expect(await premier).toBe('bail_perdu');
    const apres = (await m.travaux.lire(t.id, A))!;
    expect(apres.statut).toBe('termine');
    expect(apres.tentatives).toBe(2);
  });

  it('reprendreOrphelins relance un travail laisse en plan', async () => {
    const m = await monde();
    const t = await lancer(m);
    await m.travaux.reclamer(t.id, BAIL_S, m.horloge.t);                       // pris, puis le serveur tombe
    m.horloge.t = new Date(m.horloge.t.getTime() + (BAIL_S + 5) * 1000);
    const n = await reprendreOrphelins(m.travaux, () => m.dep, Date.now() + 10 * 60_000);
    expect(n).toBe(1);
    await attendreFile();
    expect((await m.travaux.lire(t.id, A))!.statut).toBe('termine');
  });

  it('deux demarrages du meme travail dans un processus ne le lancent qu\'une fois', async () => {
    const m = await monde();
    const t = await lancer(m);
    expect(demarrerTravail(t.id, A, () => m.dep)).toBe(true);
    expect(demarrerTravail(t.id, A, () => m.dep)).toBe(false);
    await attendreFile();
    expect(m.rendus).toHaveLength(m.film.scenes.length);
  });

  it('deux executeurs simultanes sur le meme travail : un seul travaille', async () => {
    const m = await monde();
    const t = await lancer(m);
    const issues = await Promise.all([executerTravail(t.id, A, m.dep), executerTravail(t.id, A, m.dep)]);
    expect(issues.sort()).toEqual(['non_prenable', 'termine']);
    expect(m.rendus).toHaveLength(m.film.scenes.length);   // pas de double generation
  });

  it('un executeur ne prend pas le travail d\'un autre compte', async () => {
    const m = await monde();
    const t = await lancer(m);
    expect(await executerTravail(t.id, B, m.dep)).toBe('non_prenable');
    expect(m.rendus).toEqual([]);
  });
});

describe('executeur — annulation', () => {
  it('s\'arrete a la scene suivante et GARDE les scenes deja rendues', async () => {
    const m = await monde();
    const t = await lancer(m);
    const premiere = m.film.scenes[0].id;
    m.surRendu.fn = async (id) => { if (id === premiere) await m.travaux.demanderAnnulation(t.id, A); };
    expect(await executerTravail(t.id, A, m.dep)).toBe('annule');

    const fin = (await m.travaux.lire(t.id, A))!;
    expect(fin.statut).toBe('annule');
    expect(m.rendus).toEqual([premiere]);
    expect(m.objets.cles().filter((c) => c.includes('/scenes/'))).toHaveLength(1);
    expect(m.objets.cles().filter((c) => c.includes('/exports/'))).toHaveLength(0);

    // Un nouveau travail reprend la scene gardee.
    m.surRendu.fn = null;
    const t2 = await lancer(m);
    await executerTravail(t2.id, A, m.dep);
    expect((await m.travaux.lire(t2.id, A))!.resultat!.scenesReutilisees).toEqual([premiere]);
  });

  it('annuler un travail encore en attente l\'annule tout de suite', async () => {
    const m = await monde();
    const t = await lancer(m);
    expect((await m.travaux.demanderAnnulation(t.id, A))!.statut).toBe('annule');
    expect(await executerTravail(t.id, A, m.dep)).toBe('non_prenable');
  });
});

describe('executeur — plafond de depense cote serveur', () => {
  it('un plafond invalide refuse AVANT le premier octet de travail', async () => {
    const m = await monde({ plafondUsd: Number.NaN });
    const t = await lancer(m);
    expect(await executerTravail(t.id, A, m.dep)).toBe('echec');
    expect((await m.travaux.lire(t.id, A))!.erreur).toMatch(/plafond/);
    expect(m.rendus).toEqual([]);
    expect(m.publicDirs).toEqual([]);
  });

  it('un plafond deja atteint par la generation IA refuse la production', async () => {
    const m = await monde({ plafondUsd: 1 });
    await modifierFilm(m.films, m.film.id, A, (f) => ({ ...f, qualite: 'cinema', coutGenerationUsd: 5 }));
    const t = await lancer(m);
    expect(await executerTravail(t.id, A, m.dep)).toBe('echec');
    expect(m.rendus).toEqual([]);
  });
});

describe('aucun debit, aucun fournisseur payant', () => {
  it('le module n\'importe ni credits, ni Stripe, ni paiement', async () => {
    const { readdir, readFile } = await import('fs/promises');
    const racine = path.resolve(__dirname, '..');
    const fichiers: string[] = [];
    const parcourir = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await parcourir(p); else if (/\.(ts|tsx)$/.test(e.name)) fichiers.push(p);
      }
    };
    await parcourir(path.join(racine, 'lib', 'cinema'));
    await parcourir(path.join(racine, 'app', 'api', 'cinema'));
    await parcourir(path.join(racine, 'app', 'dashboard', 'cinema'));
    expect(fichiers.length).toBeGreaterThan(20);
    for (const f of fichiers) {
      const src = await readFile(f, 'utf-8');
      const imports = src.split('\n').filter((l) => /^\s*(import|export)\b.*from\s|require\(/.test(l)).join('\n');
      expect(imports, f).not.toMatch(/lib\/credits|lib\/stripe|\/stripe|pawapay|lib\/rendus|debiter|composerEtFacturer/i);
    }
  });
});
