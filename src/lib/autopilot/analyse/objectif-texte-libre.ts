/**
 * CREER_PREMIUM_3C — UNE PHRASE, ET LE MOTEUR COMPREND.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE REMPLACE, ET CE QU'IL NE TOUCHE PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * L'objectif se déclarait par un parcours en trois étapes — but, priorités,
 * confirmation. Trois écrans pour dire ce qu'une phrase suffit à exprimer, et
 * un parcours qu'il fallait mener jusqu'au bout avant de pouvoir monter.
 *
 * ⚠️ SEULE L'ENTRÉE CHANGE. `ObjectifCommunication`, `politiqueDePlan`,
 * `objectif-score`, les paliers de qualité, l'objective-awareness d'A_7b : rien
 * de tout cela ne bouge. Ce module produit exactement le même contrat que le
 * parcours produisait ; il le produit à partir d'une phrase.
 *
 * ⚠️ AUCUN FOURNISSEUR, AUCUN MODÈLE, AUCUN COÛT. La reconnaissance est un
 * comptage de mots-clés sur un texte normalisé. Appeler un modèle pour classer
 * une phrase de dix mots ferait payer chaque frappe — et rendrait le résultat
 * non reproductible, donc l'identité du plan instable.
 *
 * ⚠️ LA PHRASE EST CONSERVÉE, PAS REMPLACÉE. Elle vit dans `objectifPrincipal`,
 * un champ que le contrat portait déjà. Le type déduit sert au moteur ; le
 * texte reste ce que la personne a écrit, et c'est lui qu'on lui réaffiche.
 */
import {
  normaliserObjectif, TYPE_OBJECTIF_GENERIQUE,
  type ObjectifCommunication, type TypeObjectif,
} from './objectif-communication';

/**
 * Les mots qui désignent une intention.
 *
 * ⚠️ ORDONNÉS DU PLUS SPÉCIFIQUE AU PLUS GÉNÉRAL. « réserver » désigne une
 * réservation ; « vendre » une vente. Un mot vague comme « montrer » n'est
 * dans aucune liste : il n'apprend rien, et le faire compter donnerait une
 * intention à une phrase qui n'en déclare pas.
 */
const MOTS: Partial<Record<TypeObjectif, readonly string[]>> = {
  evenement: ['evenement', 'event', 'soiree', 'concert', 'festival', 'atelier',
    'stage', 'porte ouverte', 'venir a', 'participer', 'ambiance'],
  reservations: ['reserver', 'reservation', 'booker', 'prendre rendez',
    'rendez-vous', 'essai', 'place', 'creneau'],
  inscriptions: ['inscrire', 'inscription', 'rejoindre', 's inscrire'],
  ventes: ['vendre', 'vente', 'acheter', 'achat', 'commander', 'commande'],
  offre: ['offre', 'promotion', 'promo', 'reduction', 'remise', 'solde'],
  /* ⚠️ LE TEMOIGNAGE PASSE AVANT `service`, ET C'EST MESURE. « Mettre en
     avant ce que cette cliente pense de mon service » contient un mot de
     chaque : a egalite, l'ordre tranche, et `service` gagnait. Or « service »
     apparait le plus souvent DE FACON INCIDENTE — « mon service », « mes
     services » — la ou « cliente » et « avis » DECLARENT l'intention. Les
     marqueurs specifiques passent donc devant les mots de domaine. */
  temoignage: ['temoignage', 'temoigner', 'avis', 'cliente', 'client dit',
    'ce que pense', 'retour d experience'],
  produit: ['produit', 'article', 'nouveaute', 'collection', 'lancement'],
  service: ['service', 'prestation', 'accompagnement', 'coaching'],
  abonnes: ['abonne', 'abonner', 's abonner', 'communaute', 'followers'],
  leads: ['contact', 'devis', 'prospect', 'formulaire', 'lead'],
  education: ['apprendre', 'expliquer', 'tutoriel', 'conseil', 'astuce',
    'pedagogie', 'comprendre'],
  coulisses: ['coulisse', 'backstage', 'behind', 'journee type', 'les dessous'],
  engagement: ['engagement', 'commentaire', 'partager', 'interagir', 'reagir'],
  notoriete: ['notoriete', 'faire connaitre', 'visibilite', 'marque'],
};

/** Sans accents, sans casse, sans ponctuation : la comparaison est stable. */
export function normaliserTexte(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Combien de mots-clés de ce type la phrase contient. */
function score(texteNormalise: string, mots: readonly string[]): number {
  let n = 0;
  for (const m of mots) if (texteNormalise.includes(m)) n += 1;
  return n;
}

export interface LectureObjectifLibre {
  /** La phrase, telle que la personne l'a écrite. */
  texte: string;
  /** Le type retenu, ou `generique` quand la phrase ne déclare rien de net. */
  type: TypeObjectif | typeof TYPE_OBJECTIF_GENERIQUE;
  /** Ce qui a fait pencher la balance — pour expliquer, jamais pour décider. */
  motsReconnus: string[];
}

/**
 * Lit une phrase et en tire un type d'objectif.
 *
 * ⚠️ AUCUNE INTENTION N'EST INVENTÉE. Une phrase qui ne contient aucun mot
 * reconnu rend `generique` — et `politiqueDePlan` retombe alors sur `m3g-v2`,
 * le chemin de tous les comptes qui n'ont rien déclaré. C'est exactement le
 * comportement d'un objectif vide, et c'est voulu : deviner une intention à
 * partir de « une belle vidéo de mon activité » ferait peser sur le montage un
 * choix que personne n'a fait.
 *
 * ⚠️ À ÉGALITÉ, C'EST L'ORDRE DE DÉCLARATION QUI TRANCHE. Deux types à un mot
 * chacun ne se départagent pas au hasard : le résultat doit être le même à
 * chaque appel, sans quoi l'identité du plan changerait d'une fois sur l'autre.
 */
export function lireObjectifLibre(texte: string): LectureObjectifLibre {
  const brut = (texte ?? '').trim();
  const n = normaliserTexte(brut);
  if (n.length === 0) {
    return { texte: brut, type: TYPE_OBJECTIF_GENERIQUE, motsReconnus: [] };
  }

  let meilleur: TypeObjectif | null = null;
  let meilleurScore = 0;
  const reconnus: string[] = [];

  for (const [type, mots] of Object.entries(MOTS) as [TypeObjectif, string[]][]) {
    const s = score(n, mots);
    if (s === 0) continue;
    for (const m of mots) if (n.includes(m) && !reconnus.includes(m)) reconnus.push(m);
    // `>` strict : le premier déclaré garde l'avantage à égalité.
    if (s > meilleurScore) { meilleurScore = s; meilleur = type; }
  }

  return {
    texte: brut,
    type: meilleur ?? TYPE_OBJECTIF_GENERIQUE,
    motsReconnus: reconnus,
  };
}

/**
 * D'une phrase au CONTRAT que le moteur attend.
 *
 * ⚠️ IL PASSE PAR `normaliserObjectif`, ET C'EST OBLIGATOIRE. C'est elle qui
 * pose les blocs manquants, trie les listes et borne les valeurs ; construire
 * l'objet à la main produirait une forme que la relecture refuserait ensuite
 * en silence — le réglage paraîtrait enregistré et ne reviendrait jamais.
 *
 * ⚠️ ET LE TEXTE SURVIT. `objectifPrincipal` porte la phrase : le contrat le
 * prévoyait déjà, et c'est ce qui permet de la réafficher à l'identique plutôt
 * que de rendre à la personne l'étiquette qu'on a déduite de ses mots.
 */
export function objectifDepuisTexte(texte: string): ObjectifCommunication {
  const lu = lireObjectifLibre(texte);
  return normaliserObjectif({
    type: lu.type,
    objectifPrincipal: lu.texte.length > 0 ? lu.texte : null,
  });
}

/** Le texte à réafficher pour un objectif donné. Vide quand il n'y en a pas. */
export function texteDepuisObjectif(
  objectif: ObjectifCommunication | null | undefined,
): string {
  return objectif?.objectifPrincipal?.trim() ?? '';
}

/**
 * Les raccourcis proposés sous le champ.
 *
 * ⚠️ CE SONT DES PHRASES, PAS DES CATÉGORIES. Un clic doit remplir quelque
 * chose que la personne peut relire, corriger et compléter — pas ranger une
 * étiquette invisible dans un formulaire. Le classement se fera ensuite sur la
 * phrase, comme pour n'importe quelle autre.
 */
export const EXEMPLES_OBJECTIF: readonly { libelle: string; phrase: string }[] = [
  { libelle: 'Événement',
    phrase: 'Donner envie de venir à mon événement et montrer l’ambiance.' },
  { libelle: 'Réservations',
    phrase: 'Donner envie de réserver un essai cette semaine.' },
  { libelle: 'Produit',
    phrase: 'Présenter mon nouveau produit et ce qu’il apporte.' },
  { libelle: 'Témoignage',
    phrase: 'Mettre en avant l’avis d’une cliente sur mon service.' },
  { libelle: 'Offre',
    phrase: 'Faire connaître mon offre du moment et sa réduction.' },
  { libelle: 'Engagement',
    phrase: 'Créer de l’engagement et donner envie de commenter.' },
];
