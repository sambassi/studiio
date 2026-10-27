/**
 * L'ATELIER — le parcours complet, en un seul endroit.
 *
 * L'interface, l'API et le banc de test local appellent TOUS ces fonctions :
 * c'est la seule façon de garantir que ce qu'un aperçu montre est ce qu'un
 * MP4 contient. Dupliquer l'enchainement ailleurs, c'est reintroduire l'ecart
 * aperçu / rendu que le projet connait deja.
 *
 * L'enchainement, dans cet ordre et pas un autre :
 *   1. decoupage de l'histoire (local, sans reseau) ;
 *   2. casting et references de personnages ;
 *   3. scenes a produire = empreinte differente, ou demande explicite ;
 *   4. devis AVANT production (zero tant que le fournisseur est local) ;
 *   5. voix des repliques (gratuites), puis durees alignees sur la parole ;
 *   6. rendu SCENE PAR SCENE, les scenes inchangees sont reprises du cache ;
 *   7. recollage en un MP4, puis CONTROLE du fichier par ffprobe.
 */
import path from 'path';
import { access, mkdir } from 'fs/promises';
import { decouperHistoire, type EntreeScenario } from '@/lib/cinema/scenario';
import { creerPersonnage, type EntreePersonnage } from '@/lib/cinema/personnages';
import { scelleScene, scenesAReproduire } from '@/lib/cinema/empreinte';
import { devisFilm, inscrireCout, type DevisFilm } from '@/lib/cinema/couts';
import { monterFilm, montageDeScene, type MontageFilm } from '@/lib/cinema/montage';
import { ajusterDureesSurVoix, synthetiserFilm, type MoteurVoix, type VoixPlan } from '@/lib/cinema/voix';
import { concatener, controlerMp4, dureesDesVoix, rendreMontages, type ControleMp4, type TacheRendu } from '@/lib/cinema/rendu-local';
import { enregistrerFilm } from '@/lib/cinema/store';
import { mediasManquants } from '@/lib/cinema/medias';
import type { Film, FormatFilm, NiveauQualite } from '@/lib/cinema/types';

/**
 * Un plan declare un media que le disque n'a pas.
 *
 * C'est une erreur NOMMEE, et pas une carte de secours : un film livre avec
 * des cartes a la place de ses rushes ressemble a un film reussi, et
 * personne ne regarde les 40 secondes du milieu avant de le publier.
 */
export class ErreurMediasManquants extends Error {
  constructor(public readonly manquants: Array<{ sceneId: string; planId: string; url: string; motif: string }>) {
    super(`media introuvable pour ${manquants.length} plan(s) : ${manquants.map((m) => `${m.planId} (${m.motif})`).join(', ')}`);
    this.name = 'ErreurMediasManquants';
  }
}

export interface EntreeAtelier {
  titre?: string | null;
  histoire: string;
  format?: FormatFilm;
  qualite?: NiveauQualite;
  nbScenes?: number | null;
  personnages: EntreePersonnage[];
  maintenant?: () => Date;
  /**
   * Identifiant du film. Absent, il est tire de l'horloge : sans cela, deux
   * films crees a la suite portent le meme id et le second ECRASE le premier
   * dans le magasin comme dans son dossier de rendus.
   */
  idFilm?: string;
}

/** Etapes 1 a 4 du parcours : un film plante, sans un octet de media. */
export function preparerFilm(entree: EntreeAtelier): Film {
  const casting = entree.personnages.map((p, i) => creerPersonnage(p, i, entree.maintenant));
  const scenario: EntreeScenario = {
    titre: entree.titre ?? null,
    histoire: entree.histoire,
    format: entree.format,
    qualite: entree.qualite,
    nbScenes: entree.nbScenes ?? null,
    casting,
    maintenant: entree.maintenant,
    id: (prefixe, n) => `${prefixe}-${n}`,
    idFilm: entree.idFilm ?? `film-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
  return decouperHistoire(scenario);
}

export interface OptionsProduction {
  /** Racine du projet (ou vivent `remotion/index.tsx` et `public/`). */
  racine: string;
  /** Scenes a refaire meme si leur empreinte n'a pas change. */
  scenesDemandees?: readonly string[];
  /** `false` : s'arreter apres les voix et le montage, sans appeler Remotion. */
  rendre?: boolean;
  concurrence?: number;
  timeoutMs?: number;
  /** Moteur de voix demande (les deux sont gratuits). */
  moteurVoix?: MoteurVoix;
}

export interface ResultatProduction {
  film: Film;
  montage: MontageFilm;
  devis: DevisFilm;
  voix: {
    details: VoixPlan[];
    echecs: Array<{ planId: string; motif: string }>;
    /** Le moteur qui a reellement parle — annonce, jamais devine. */
    moteur: MoteurVoix;
    motifRepli: string | null;
  };
  scenesRendues: string[];
  scenesReutilisees: string[];
  mp4: ControleMp4 | null;
  /** Ce qui a echoue sans arreter le reste. Vide = rien n'a ete masque. */
  avertissements: string[];
}

const existe = async (f: string) => { try { await access(f); return true; } catch { return false; } };

export async function produireFilm(filmInitial: Film, options: OptionsProduction): Promise<ResultatProduction> {
  const racine = options.racine;
  const racinePublique = path.join(racine, 'public');
  const dossierFilm = path.join(racine, 'var', 'cinema', 'rendus', filmInitial.id);
  const dossierScenes = path.join(dossierFilm, 'scenes');
  await mkdir(dossierScenes, { recursive: true });
  const avertissements: string[] = [];

  // ── 3. Ce qu'il faut refaire ────────────────────────────────────────────
  //
  // Trois raisons, et l'absence de fichier en est une. Se fier a la seule
  // empreinte laissait un film NEUF sans rien a produire : son empreinte est
  // juste par construction, et pourtant aucun media n'existe encore. Une
  // empreinte dit « le contenu n'a pas change », pas « le media est la ».
  const demandees = new Set(options.scenesDemandees ?? []);
  const sansFichier: string[] = [];
  for (const scene of filmInitial.scenes) {
    if (!(await existe(path.join(dossierScenes, `${scene.id}.mp4`)))) sansFichier.push(scene.id);
  }
  const aProduire = new Set<string>([
    ...scenesAReproduire(filmInitial).map((s) => s.id),
    ...sansFichier,
    ...demandees,
  ]);

  // ── 4. Devis AVANT toute production ─────────────────────────────────────
  const devis = devisFilm(filmInitial, [...aProduire]);

  // ── Medias declares : presents, ou l'on s'arrete ─────────────────────────
  //
  // En RENDU, un media manquant arrete tout : mieux vaut un echec lisible
  // qu'un MP4 ou trois plans sur quinze ont ete remplaces par une carte.
  // En APERCU (`rendre: false`), il est signale et le reste continue : on
  // veut pouvoir regarder son montage pendant qu'on cherche le fichier.
  const manquants = await mediasManquants(filmInitial, racinePublique);
  if (manquants.length) {
    if (options.rendre !== false) throw new ErreurMediasManquants(manquants);
    for (const m of manquants) avertissements.push(`media introuvable (plan ${m.planId}) : ${m.url} — ${m.motif}`);
  }

  // ── 5. Voix : seules les scenes a produire sont synthetisees, et un
  //      fichier deja present est repris tel quel.
  const { voix, details, echecs, moteur, motifRepli } = await synthetiserFilm(filmInitial, {
    racinePublique,
    dossierRelatif: path.posix.join('cinema', filmInitial.id),
    scenes: [...aProduire],
    moteur: options.moteurVoix,
  });
  for (const e of echecs) avertissements.push(`voix absente pour le plan ${e.planId} : ${e.motif}`);
  if (motifRepli) avertissements.push(`voix produites par le moteur « ${moteur} » : ${motifRepli}`);

  // Les durees suivent la parole mesuree — jamais l'inverse.
  const mesurees = await dureesDesVoix(details);
  let film = ajusterDureesSurVoix(filmInitial, mesurees);

  // ── 6/7. Montage, rendu par scene, recollage ────────────────────────────
  const montage = monterFilm(film, voix);
  if (options.rendre === false) {
    return { film, montage, devis, voix: { details, echecs, moteur, motifRepli }, scenesRendues: [], scenesReutilisees: [], mp4: null, avertissements };
  }

  const rendues: string[] = [];
  const reutilisees: string[] = [];
  const fichiers: string[] = [];
  const taches: TacheRendu[] = [];

  for (const scene of film.scenes) {
    const sortie = path.join(dossierScenes, `${scene.id}.mp4`);
    const sousMontage = montageDeScene(montage, scene.id);
    if (!sousMontage) { avertissements.push(`scene ${scene.id} sans plan, ignoree`); continue; }

    // Une scene inchangee dont le MP4 est la est REPRISE : c'est tout
    // l'interet d'un rendu scene par scene, et la seule façon de regenerer
    // une scene sans repayer les quatre autres.
    if (!aProduire.has(scene.id) && await existe(sortie)) {
      reutilisees.push(scene.id);
      fichiers.push(sortie);
      continue;
    }
    taches.push({ montage: sousMontage, sortie });
    rendues.push(scene.id);
    fichiers.push(sortie);
  }

  if (taches.length) {
    await rendreMontages(taches, { racine, concurrence: options.concurrence });
  }

  const sortieFilm = path.join(dossierFilm, 'film.mp4');
  const mp4 = fichiers.length === 1
    ? await (async () => { await concatener(fichiers, sortieFilm); return controlerMp4(sortieFilm); })()
    : await concatener(fichiers, sortieFilm);

  // Les scenes produites sont SCELLEES apres le rendu, jamais avant : sceller
  // d'abord, c'est declarer valide un media qui n'existe peut-etre pas.
  film = {
    ...film,
    scenes: film.scenes.map((s) => {
      if (!rendues.includes(s.id)) return s;
      const ligne = devis.lignes.find((l) => l.sceneId === s.id);
      return inscrireCout(scelleScene(s, film.personnages), ligne?.usd ?? 0);
    }),
    majLe: new Date().toISOString(),
  };
  await enregistrerFilm(racine, film);

  return {
    film,
    montage: monterFilm(film, voix),
    devis,
    voix: { details, echecs, moteur, motifRepli },
    scenesRendues: rendues,
    scenesReutilisees: reutilisees,
    mp4,
    avertissements,
  };
}
