/**
 * LE SCENARISTE — histoire libre vers scenes ordonnees.
 *
 * Il est LOCAL et DETERMINISTE : aucun reseau, aucun fournisseur payant, deux
 * appels sur la meme histoire rendent le meme decoupage. C'est ce qui permet
 * de regenerer un seul plan sans voir le reste du film changer sous la main.
 *
 * ⚠️ CE QU'IL NE FAIT PAS : il n'INVENTE aucune replique. Les repliques sont
 * les phrases de l'utilisateur, attribuees aux personnages presents. Un vrai
 * modele de langage se branche a sa place par `FournisseurScenario` — tant
 * qu'il ne l'est pas, dire que le scenario est « ecrit par une IA » serait
 * faux.
 */
import { debitParoleAvatar } from '@/lib/autopilot/duree-cible';
import { empreinteScene } from '@/lib/cinema/empreinte';
import type {
  Film, FormatFilm, IntentionScene, NiveauQualite, PlanCinema, Personnage, SceneCinema,
} from '@/lib/cinema/types';

/** Duree plancher d'une replique : en dessous, la voix n'a pas le temps d'attaquer. */
export const DUREE_REPLIQUE_MIN_S = 1.4;
/** Duree d'un plan d'ensemble sans parole. */
export const DUREE_ENSEMBLE_S = 2.4;
/** Bornes du prototype, annoncees dans le cahier des charges. */
export const SCENES_MIN = 3;
export const SCENES_MAX = 5;

/** L'echelle dramatique, par nombre de scenes. L'ordre ne varie pas. */
const ECHELLE: Record<number, IntentionScene[]> = {
  3: ['exposition', 'confrontation', 'resolution'],
  4: ['exposition', 'incident', 'confrontation', 'resolution'],
  5: ['exposition', 'incident', 'confrontation', 'resolution', 'epilogue'],
};

/** Lieux reconnus dans le texte. Rien de devine : un mot present, un lieu. */
const LEXIQUE_LIEUX: Array<[RegExp, string]> = [
  [/\b(salle|gymnase|tatami|ring|dojo)\b/i, 'la salle'],
  [/\b(rue|trottoir|avenue|ville|quartier)\b/i, 'la rue'],
  [/\b(plage|mer|ocean|océan|sable)\b/i, 'la plage'],
  [/\b(foret|forêt|bois|arbre)\b/i, 'la foret'],
  [/\b(cuisine|table|repas|diner|dîner)\b/i, 'la cuisine'],
  [/\b(bureau|atelier|studio)\b/i, "l'atelier"],
  [/\b(nuit|minuit|obscur)\b/i, 'la nuit'],
  [/\b(toit|terrasse|balcon)\b/i, 'le toit'],
];

const MOTS_VIDES = new Set([
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'a', 'au', 'aux', 'dans',
  'il', 'elle', 'ils', 'elles', 'je', 'tu', 'on', 'nous', 'vous', 'que', 'qui', 'pour',
  'avec', 'sur', 'sans', 'plus', 'mais', 'son', 'sa', 'ses', 'ce', 'cet', 'cette', 'est',
]);

/** Decoupage en phrases — la seule segmentation du texte d'entree. */
export function phrases(histoire: string): string[] {
  return (histoire ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);
}

/** Nombre de scenes retenu : ce qui est demande, borne par ce que le texte permet. */
export function nombreDeScenes(nbPhrases: number, demande?: number | null): number {
  const naturel = nbPhrases >= 10 ? 5 : nbPhrases >= 6 ? 4 : SCENES_MIN;
  const vise = demande && Number.isFinite(demande) ? Math.round(demande) : naturel;
  return Math.max(SCENES_MIN, Math.min(SCENES_MAX, vise));
}

/** Repartition equilibree des phrases sur N scenes (les premieres prennent le reste). */
export function repartir<T>(items: readonly T[], parts: number): T[][] {
  const groupes: T[][] = Array.from({ length: parts }, () => []);
  if (items.length === 0) return groupes;
  const base = Math.floor(items.length / parts);
  const reste = items.length % parts;
  let i = 0;
  for (let g = 0; g < parts; g++) {
    const n = base + (g < reste ? 1 : 0);
    for (let k = 0; k < n; k++) if (i < items.length) groupes[g].push(items[i++]);
  }
  // Une scene vide n'existe pas : elle reprend la derniere phrase de la precedente.
  for (let g = 0; g < parts; g++) {
    if (groupes[g].length === 0) {
      for (let s = g - 1; s >= 0; s--) {
        if (groupes[s].length > 1) { groupes[g].push(groupes[s].pop() as T); break; }
      }
    }
  }
  return groupes;
}

/** Le lieu d'un bloc de phrases, ou un decor neutre. */
export function lieuDe(texte: string): string {
  for (const [motif, lieu] of LEXIQUE_LIEUX) if (motif.test(texte)) return lieu;
  return 'un decor neutre';
}

/** Titre de scene : les premiers mots porteurs, en capitales. */
export function titreDe(texte: string, index: number): string {
  const mots = texte
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((m) => m.length > 2 && !MOTS_VIDES.has(m))
    .slice(0, 3);
  return mots.length ? mots.join(' ').toUpperCase() : `SCENE ${index + 1}`;
}

/** Duree estimee d'une replique au debit de parole du projet. */
export function dureeReplique(texte: string): number {
  const debit = debitParoleAvatar('normal');
  return Math.max(DUREE_REPLIQUE_MIN_S, Math.round((texte.trim().length / debit) * 10) / 10);
}

/**
 * Le texte entre guillemets d'une phrase, s'il y en a : c'est la SEULE source
 * d'une replique. Guillemets francais, droits ou courbes.
 */
export function citation(phrase: string): string | null {
  const m = /[«"\u201C]\s*([^»"\u201D]{2,})\s*[»"\u201D]/.exec(phrase);
  return m ? m[1].trim() : null;
}

/** Les personnages cites dans un texte, dans l'ordre du casting. */
export function personnagesCites(texte: string, casting: readonly Personnage[]): string[] {
  return casting
    .filter((p) => new RegExp(`\\b${p.nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(texte))
    .map((p) => p.id);
}

export interface EntreeScenario {
  titre?: string | null;
  histoire: string;
  format?: FormatFilm;
  qualite?: NiveauQualite;
  nbScenes?: number | null;
  /** Le casting. Les personnages sont crees avant le decoupage, pas devines. */
  casting: readonly Personnage[];
  /**
   * Identifiant du film. Les identifiants de scenes et de plans restent
   * DETERMINISTES (ils servent de cles de cache) ; celui du film, non : deux
   * films crees de suite avec le meme id s'ecraseraient dans le magasin.
   */
  idFilm?: string;
  /** Horloge injectable — un test ne depend pas de l'heure. */
  maintenant?: () => Date;
  /** Generateur d'identifiants injectable, pour des tests reproductibles. */
  id?: (prefixe: string, n: number) => string;
}

/**
 * Le contrat d'un scenariste. Le local ci-dessous le remplit sans reseau ;
 * un modele de langage le remplira sans que rien d'autre ne bouge.
 */
export interface FournisseurScenario {
  id: string;
  libelle: string;
  payant: boolean;
  decouper(entree: EntreeScenario): Film;
}

/** Le decoupage local, sans reseau. */
export function decouperHistoire(entree: EntreeScenario): Film {
  const maintenant = (entree.maintenant ?? (() => new Date()))();
  const horodatage = maintenant.toISOString();
  const idDe = entree.id ?? ((p, n) => `${p}-${n}`);

  const blocs = phrases(entree.histoire);
  const nb = nombreDeScenes(blocs.length, entree.nbScenes);
  const groupes = repartir(blocs, nb);
  const echelle = ECHELLE[nb] ?? ECHELLE[SCENES_MIN];

  const scenes: SceneCinema[] = groupes.map((lignes, index) => {
    const texte = lignes.join(' ');
    const presents = personnagesCites(texte, entree.casting);
    // Une scene sans personnage nomme reunit tout le casting : le film ne
    // doit pas perdre ses personnages a cause d'une phrase sans prenom.
    const distribution = presents.length ? presents : entree.casting.map((p) => p.id);

    const plans: PlanCinema[] = [{
      id: idDe(`s${index + 1}-p`, 1),
      cadre: 'ensemble',
      description: `Plan d'ensemble sur ${lieuDe(texte)}.`,
      personnages: distribution,
      dialogue: null,
      dureeS: DUREE_ENSEMBLE_S,
      media: null,
    }];

    lignes.forEach((ligne, k) => {
      // Une REPLIQUE suppose des guillemets dans l'histoire. Sans guillemets,
      // la phrase est du recit : elle revient au narrateur, et aucun nom de
      // personnage ne s'affiche au-dessus.
      const dite = citation(ligne);
      const nommes = personnagesCites(ligne, entree.casting);
      const parlant = dite
        ? (nommes[0] ?? (distribution.length ? distribution[k % distribution.length] : null))
        : null;
      const texte = dite ?? ligne;
      plans.push({
        id: idDe(`s${index + 1}-p`, k + 2),
        cadre: k % 2 === 0 ? 'moyen' : 'rapproche',
        description: ligne,
        // Ce que le plan MONTRE : les personnages nommes dans la phrase, ou
        // celui qui parle. C'est aussi ce qui part dans un prompt visuel.
        personnages: parlant ? [parlant] : (nommes.length ? nommes : distribution),
        dialogue: {
          personnageId: parlant,
          genre: dite ? 'replique' : 'narration',
          texte,
          dureeS: dureeReplique(texte),
        },
        dureeS: dureeReplique(texte),
        media: null,
      });
    });

    const scene: SceneCinema = {
      id: idDe('scene', index + 1),
      index,
      titre: titreDe(texte, index),
      lieu: lieuDe(texte),
      intention: echelle[index] ?? 'confrontation',
      personnages: distribution,
      plans,
      etat: 'brouillon',
      empreinte: '',
      coutUsd: 0,
    };
    return { ...scene, empreinte: empreinteScene(scene, entree.casting) };
  });

  return {
    id: entree.idFilm ?? idDe('film', 1),
    titre: (entree.titre ?? '').trim() || titreDe(entree.histoire, 0),
    histoire: entree.histoire,
    format: entree.format ?? '16:9',
    qualite: entree.qualite ?? 'standard',
    personnages: [...entree.casting],
    scenes,
    creeLe: horodatage,
    majLe: horodatage,
  };
}

export const SCENARISTE_LOCAL: FournisseurScenario = {
  id: 'local',
  libelle: 'Scenariste local (sans reseau)',
  payant: false,
  decouper: decouperHistoire,
};
