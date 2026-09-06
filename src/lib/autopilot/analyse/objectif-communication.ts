/**
 * AUTOPILOTE V2 — L'OBJECTIF DE COMMUNICATION : POURQUOI CETTE VIDEO EXISTE.
 *
 * ---------------------------------------------------------------------------
 * LA COUCHE 1, ET POURQUOI ELLE N'EST PAS LA COUCHE 3
 * ---------------------------------------------------------------------------
 *
 *   1. OBJECTIF DE COMMUNICATION — POURQUOI. Ce fichier.
 *   2. PLAN EDITORIAL — QUOI montrer, dans quel ordre (`m3e-v3`, `m3g-v2`).
 *   3. PROFIL CREATIF — COMMENT cela apparait (`profil-creatif.ts`).
 *
 * Les couches 1 et 3 ne se ressemblent pas, et les confondre serait l'erreur
 * la plus couteuse de cette architecture :
 *
 *     LE PROFIL CREATIF NE CHANGE JAMAIS L'IDENTITE DU PLAN.
 *     L'OBJECTIF, LUI, DOIT LA CHANGER.
 *
 * Le meme rush monte pour « promouvoir un evenement » et pour « se faire
 * connaitre » n'est pas le meme montage : le premier veut de l'energie, de la
 * foule, une date, une urgence ; le second veut une personnalite, un univers,
 * une emotion. Ce sont deux DECISIONS EDITORIALES differentes, donc deux
 * plans. Reutiliser le plan de l'un pour l'autre rendrait une video qui ne
 * repond pas a la demande — sans erreur et sans message, exactement la panne
 * muette que `m3e-v3` et `m3g-v2` ont ete versionnes pour eviter.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE MODULE FAIT AUJOURD'HUI, ET CE QU'IL NE FAIT PAS
 * ---------------------------------------------------------------------------
 *
 * Il DECRIT, VALIDE et NORMALISE un objectif, et il sait en produire une
 * forme canonique deterministe. C'est tout.
 *
 * Il n'est branche sur AUCUNE decision de montage. `m3g-v2` ne le lit pas, et
 * `ALGORITHME_PLAN` n'a pas bouge — parce qu'incrementer une version
 * d'algorithme avant d'avoir defini le comportement qu'elle designe
 * invaliderait tous les plans existants pour rien. La recommandation de
 * versioning est ecrite plus bas, sous `M3G_V3_RECOMMANDATION`.
 *
 * ---------------------------------------------------------------------------
 * CTA STRATEGIQUE ET CTA VISUEL : DEUX CONTRATS, PAS UN
 * ---------------------------------------------------------------------------
 *
 * Ce module porte ce que le CTA DIT et OU il mene (`appelAction`).
 * `profil-creatif.ts` porte COMMENT il s'affiche (`ctaVisuel`). Melanger les
 * deux obligerait a rejouer un montage entier pour changer la couleur d'un
 * bouton, et a rejouer un style pour corriger un lien.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE PUBLICATION, JAMAIS
 * ---------------------------------------------------------------------------
 *
 * `lienReservation`, `lien`, `destination` sont des DONNEES D'AFFICHAGE. Rien
 * ici n'est jamais recupere par le serveur, ouvert, suivi, ni transforme en
 * argument de commande. Le mode reste `review` : creer, regarder, valider,
 * puis telecharger ou planifier.
 *
 * MODULE PUR, SANS IMPORT NI `crypto`. Comme `recette-audio` et
 * `profil-creatif` : lisible par l'ecran autant que par le moteur.
 */

// ---------------------------------------------------------------------------
// Le vocabulaire
// ---------------------------------------------------------------------------

export const VERSION_OBJECTIF = 'objectif-v1' as const;

/**
 * Les objectifs que Studiio sait nommer.
 *
 * DES IDENTIFIANTS, PAS UNE CONSIGNE LIBRE. Un texte arbitraire venu du
 * navigateur ne doit jamais devenir une branche de logique serveur : c'est
 * ainsi qu'on se retrouve avec un moteur pilote par une phrase. Le texte
 * libre existe — `objectifPrincipal`, `messagePrincipal` — mais il est
 * DESCRIPTIF : il pourra nourrir une generation de texte, jamais un
 * aiguillage.
 *
 * `personnalise` est la soupape : l'utilisateur decrit son intention en
 * toutes lettres dans `objectifPrincipal`, et le moteur retombe sur sa
 * politique generique.
 */
export const TYPES_OBJECTIF = [
  'evenement', 'produit', 'service', 'notoriete', 'abonnes', 'inscriptions',
  'reservations', 'leads', 'ventes', 'offre', 'temoignage', 'education',
  'engagement', 'coulisses', 'personnalise',
] as const;
export type TypeObjectif = (typeof TYPES_OBJECTIF)[number];

/**
 * L'objectif d'un compte qui n'a rien precise.
 *
 * `notoriete` serait deja un parti pris editorial. `generique` n'en est pas
 * un : il dit « aucune intention declaree », et laisse le moteur appliquer la
 * politique qu'il applique aujourd'hui — celle de `m3g-v2`, qui ne connait
 * aucun objectif. C'est ce qui rend ce lot retro-compatible.
 */
export const TYPE_OBJECTIF_GENERIQUE = 'generique' as const;

/**
 * Le ton EDITORIAL — distinct du profil creatif.
 *
 * Deux videos du meme compte, avec le MEME profil creatif (memes couleurs,
 * meme police, meme logo), peuvent avoir deux tons : l'une energique,
 * l'autre emotionnelle. Le ton influence le choix des passages et
 * l'ecriture ; il ne touche ni a la police ni a la couleur.
 */
export const TONS_EDITORIAUX = [
  'energetique', 'premium', 'emotionnel', 'authentique', 'educatif',
  'humoristique', 'direct', 'inspirant', 'urgent', 'minimal',
] as const;
export type TonEditorial = (typeof TONS_EDITORIAUX)[number];

/** L'ACTION demandee au spectateur. Le « quoi faire », jamais le « comment ». */
export const ACTIONS_CTA = [
  'aucune', 'reservation', 'inscription', 'achat', 'abonnement',
  'contact', 'decouverte', 'partage',
] as const;
export type ActionCta = (typeof ACTIONS_CTA)[number];

/**
 * Les PREUVES que l'utilisateur souhaite voir apparaitre.
 *
 * Ce sont des demandes editoriales, pas des capacites d'analyse : le moteur
 * d'analyse ne sait pas encore reconnaitre « avant/apres ». Les nommer des
 * maintenant permet a l'analyse de rush de grandir vers ces signaux sans que
 * le contrat change.
 */
export const PREUVES_SOUHAITEES = [
  'temoignage', 'avant-apres', 'chiffres', 'foule', 'demonstration',
  'coulisses', 'expertise',
] as const;
export type PreuveSouhaitee = (typeof PREUVES_SOUHAITEES)[number];

/**
 * Les PRIORITES narratives — ce que le montage doit favoriser.
 *
 * C'est le vocabulaire par lequel un objectif parlera un jour au scoring des
 * clips : `scoreFinal = technique + visuel + pertinenceObjectif + diversite +
 * coherence`. Aucune de ces valeurs n'est utilisee aujourd'hui ; elles
 * existent pour que l'analyse de rush et `m3g-v3` aient une cible commune,
 * ecrite avant d'etre codee.
 */
export const PRIORITES_NARRATIVES = [
  'energie', 'ambiance', 'foule', 'personnalite', 'emotion', 'demonstration',
  'produit', 'benefice', 'preuve', 'information', 'urgence', 'identite',
  'pedagogie', 'authenticite',
] as const;
export type PrioriteNarrative = (typeof PRIORITES_NARRATIVES)[number];

export const NIVEAUX_CONNAISSANCE = [
  'debutant', 'initie', 'expert',
] as const;
export type NiveauConnaissance = (typeof NIVEAUX_CONNAISSANCE)[number];

/** Bornes. Refus hors bornes a la lecture, jamais bornage muet. */
export const TEXTE_COURT_MAX = 120;
export const TEXTE_LONG_MAX = 500;
export const LIEN_MAX = 2048;
export const AGE_MIN = 0;
export const AGE_MAX = 120;
export const PRIORITES_MAX = 6;
export const PREUVES_MAX = 6;

// ---------------------------------------------------------------------------
// La forme
// ---------------------------------------------------------------------------

export interface CibleObjectif {
  description: string | null;
  ageMin: number | null;
  ageMax: number | null;
  localisation: string | null;
  niveauConnaissance: NiveauConnaissance | null;
}

export interface EvenementObjectif {
  nom: string | null;
  /** Date ISO `AAAA-MM-JJ`. Jamais un texte libre : elle sera affichee. */
  date: string | null;
  lieu: string | null;
  prix: string | null;
  placesLimitees: boolean;
  lienReservation: string | null;
}

export interface ProduitObjectif {
  nom: string | null;
  beneficePrincipal: string | null;
  offre: string | null;
  prix: string | null;
  lien: string | null;
}

export interface ServiceObjectif {
  nom: string | null;
  benefice: string | null;
  problemeResolu: string | null;
  offre: string | null;
  lien: string | null;
}

export interface OffreObjectif {
  nom: string | null;
  prix: string | null;
  /** Jusqu'a quand. ISO `AAAA-MM-JJ`. */
  echeance: string | null;
  lien: string | null;
}

/**
 * LE CTA STRATEGIQUE — ce qu'on demande, et ou cela mene.
 *
 * `destination` est une donnee d'affichage. Elle n'est JAMAIS recuperee par
 * le serveur, jamais suivie, jamais transformee en chemin. Elle n'accepte que
 * `https://`, bornee : un `file://`, un `javascript:` ou un chemin local
 * seraient refuses ici avant meme d'atteindre une couche d'affichage.
 */
export interface AppelActionStrategique {
  actionId: ActionCta;
  texte: string | null;
  destination: string | null;
}

export interface ObjectifCommunication {
  version: typeof VERSION_OBJECTIF;
  type: TypeObjectif | typeof TYPE_OBJECTIF_GENERIQUE;
  objectifPrincipal: string | null;
  contexte: string | null;
  messagePrincipal: string | null;
  cible: CibleObjectif;
  evenement: EvenementObjectif;
  produit: ProduitObjectif;
  service: ServiceObjectif;
  offre: OffreObjectif;
  appelAction: AppelActionStrategique;
  tonId: TonEditorial | null;
  /** Triees, dedoublonnees — l'ordre de saisie ne doit pas changer l'identite. */
  preuveSouhaitee: PreuveSouhaitee[];
  priorites: PrioriteNarrative[];
}

export type ObjectifPartiel = {
  type?: ObjectifCommunication['type'];
  objectifPrincipal?: string | null;
  contexte?: string | null;
  messagePrincipal?: string | null;
  cible?: Partial<CibleObjectif>;
  evenement?: Partial<EvenementObjectif>;
  produit?: Partial<ProduitObjectif>;
  service?: Partial<ServiceObjectif>;
  offre?: Partial<OffreObjectif>;
  appelAction?: Partial<AppelActionStrategique>;
  tonId?: TonEditorial | null;
  preuveSouhaitee?: PreuveSouhaitee[];
  priorites?: PrioriteNarrative[];
};

/**
 * L'OBJECTIF QUI NE DEMANDE RIEN — la politique editoriale d'aujourd'hui.
 *
 * Un compte qui n'a jamais rien declare produit exactement le plan qu'il
 * produisait avant ce lot, et `estObjectifGenerique` le reconnait.
 */
export const OBJECTIF_DEFAUT: ObjectifCommunication = Object.freeze({
  version: VERSION_OBJECTIF,
  type: TYPE_OBJECTIF_GENERIQUE,
  objectifPrincipal: null,
  contexte: null,
  messagePrincipal: null,
  cible: Object.freeze({
    description: null, ageMin: null, ageMax: null,
    localisation: null, niveauConnaissance: null,
  }),
  evenement: Object.freeze({
    nom: null, date: null, lieu: null, prix: null,
    placesLimitees: false, lienReservation: null,
  }),
  produit: Object.freeze({
    nom: null, beneficePrincipal: null, offre: null, prix: null, lien: null,
  }),
  service: Object.freeze({
    nom: null, benefice: null, problemeResolu: null, offre: null, lien: null,
  }),
  offre: Object.freeze({ nom: null, prix: null, echeance: null, lien: null }),
  appelAction: Object.freeze({ actionId: 'aucune', texte: null, destination: null }),
  tonId: null,
  preuveSouhaitee: Object.freeze([]) as unknown as PreuveSouhaitee[],
  priorites: Object.freeze([]) as unknown as PrioriteNarrative[],
}) as ObjectifCommunication;

// ---------------------------------------------------------------------------
// Validation elementaire
// ---------------------------------------------------------------------------

export function texteBorne(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || s.length > max) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/**
 * Une date ISO `AAAA-MM-JJ`, et qui existe reellement.
 *
 * `2026-02-31` passe une expression reguliere et pas un calendrier. Une date
 * fausse serait AFFICHEE telle quelle dans la video : elle doit etre refusee
 * a l'entree, pas corrigee.
 */
export function dateIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === s ? s : null;
}

/**
 * Un lien AFFICHABLE — `https://` uniquement, borne.
 *
 * JAMAIS RECUPERE PAR LE SERVEUR. C'est une chaine qu'on montre. Le
 * restreindre a `https` ferme d'un coup `javascript:`, `data:`, `file:` et
 * les chemins locaux, sans avoir a les enumerer.
 */
export function lienAffichable(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || s.length > LIEN_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  return u.toString();
}

function nombreBorne(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  if (v < min || v > max) return null;
  return v;
}

function listeTriee<T extends string>(
  v: unknown, liste: readonly T[], max: number,
): T[] {
  if (!Array.isArray(v)) return [];
  const vus = new Set<T>();
  for (const item of v) {
    if (typeof item === 'string' && (liste as readonly string[]).includes(item)) {
      vus.add(item as T);
    }
  }
  // TRIEE, ET C'EST LE POINT : l'ordre de saisie de deux cases a cocher ne
  // doit pas produire deux identites editoriales differentes.
  return [...vus].sort().slice(0, max);
}

function objet(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Ramene un objectif a sa forme complete, et efface ce qui n'a pas d'objet.
 *
 * MEME RAISON QU'AU LOT 2A : deux objectifs EDITORIALEMENT identiques doivent
 * produire la meme identite, sinon on recalcule un plan pour rien. Un bloc
 * `evenement` rempli alors que le type est `produit` ne decrit aucune
 * decision : il est efface. Un `texte` de CTA sans action non plus.
 *
 * TOLERANTE, la ou `lireObjectif` est stricte : celle-ci relit une base qui a
 * pu etre ecrite par une version future.
 */
export function normaliserObjectif(
  brut: ObjectifPartiel | ObjectifCommunication | null | undefined,
): ObjectifCommunication {
  const o = (brut ?? {}) as Record<string, unknown>;
  const D = OBJECTIF_DEFAUT;
  const bloc = (nom: string) => objet(o[nom]) ?? {};

  const type = typeof o.type === 'string'
    && ((TYPES_OBJECTIF as readonly string[]).includes(o.type)
      || o.type === TYPE_OBJECTIF_GENERIQUE)
    ? o.type as ObjectifCommunication['type']
    : D.type;

  // -- Cible -------------------------------------------------------------
  const c = bloc('cible');
  let ageMin = nombreBorne(c.ageMin, AGE_MIN, AGE_MAX);
  let ageMax = nombreBorne(c.ageMax, AGE_MIN, AGE_MAX);
  // Une tranche inversee ne decrit aucune cible : on la refuse en bloc plutot
  // que d'en inventer une en echangeant les bornes.
  if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
    ageMin = null; ageMax = null;
  }
  const cible: CibleObjectif = {
    description: texteBorne(c.description, TEXTE_LONG_MAX),
    ageMin,
    ageMax,
    localisation: texteBorne(c.localisation, TEXTE_COURT_MAX),
    niveauConnaissance: typeof c.niveauConnaissance === 'string'
      && (NIVEAUX_CONNAISSANCE as readonly string[]).includes(c.niveauConnaissance)
      ? c.niveauConnaissance as NiveauConnaissance : null,
  };

  // -- Les blocs specifiques a un type -----------------------------------
  //
  // GARDES PAR LE TYPE. Un bloc `produit` conserve alors que l'objectif est
  // `evenement` ferait diverger deux identites pour une donnee que personne
  // ne lira.
  const e = bloc('evenement');
  const typeEvenement = type === 'evenement' || type === 'reservations'
    || type === 'inscriptions';
  const evenement: EvenementObjectif = typeEvenement ? {
    nom: texteBorne(e.nom, TEXTE_COURT_MAX),
    date: dateIso(e.date),
    lieu: texteBorne(e.lieu, TEXTE_COURT_MAX),
    prix: texteBorne(e.prix, TEXTE_COURT_MAX),
    placesLimitees: e.placesLimitees === true,
    lienReservation: lienAffichable(e.lienReservation),
  } : { ...D.evenement };

  const p = bloc('produit');
  const typeProduit = type === 'produit' || type === 'ventes' || type === 'offre';
  const produit: ProduitObjectif = typeProduit ? {
    nom: texteBorne(p.nom, TEXTE_COURT_MAX),
    beneficePrincipal: texteBorne(p.beneficePrincipal, TEXTE_LONG_MAX),
    offre: texteBorne(p.offre, TEXTE_COURT_MAX),
    prix: texteBorne(p.prix, TEXTE_COURT_MAX),
    lien: lienAffichable(p.lien),
  } : { ...D.produit };

  const s = bloc('service');
  const typeService = type === 'service' || type === 'leads';
  const service: ServiceObjectif = typeService ? {
    nom: texteBorne(s.nom, TEXTE_COURT_MAX),
    benefice: texteBorne(s.benefice, TEXTE_LONG_MAX),
    problemeResolu: texteBorne(s.problemeResolu, TEXTE_LONG_MAX),
    offre: texteBorne(s.offre, TEXTE_COURT_MAX),
    lien: lienAffichable(s.lien),
  } : { ...D.service };

  // L'offre, elle, a du sens pour tout objectif commercial.
  const f = bloc('offre');
  const offre: OffreObjectif = {
    nom: texteBorne(f.nom, TEXTE_COURT_MAX),
    prix: texteBorne(f.prix, TEXTE_COURT_MAX),
    echeance: dateIso(f.echeance),
    lien: lienAffichable(f.lien),
  };

  // -- CTA strategique ---------------------------------------------------
  const a = bloc('appelAction');
  const actionId = typeof a.actionId === 'string'
    && (ACTIONS_CTA as readonly string[]).includes(a.actionId)
    ? a.actionId as ActionCta : D.appelAction.actionId;
  const sansAction = actionId === 'aucune';
  const appelAction: AppelActionStrategique = {
    actionId,
    // Un texte et une destination sans action ne seront jamais affiches :
    // les garder ferait diverger deux identites pour rien.
    texte: sansAction ? null : texteBorne(a.texte, TEXTE_COURT_MAX),
    destination: sansAction ? null : lienAffichable(a.destination),
  };

  return {
    version: VERSION_OBJECTIF,
    type,
    objectifPrincipal: texteBorne(o.objectifPrincipal, TEXTE_LONG_MAX),
    contexte: texteBorne(o.contexte, TEXTE_LONG_MAX),
    messagePrincipal: texteBorne(o.messagePrincipal, TEXTE_LONG_MAX),
    cible, evenement, produit, service, offre, appelAction,
    tonId: typeof o.tonId === 'string'
      && (TONS_EDITORIAUX as readonly string[]).includes(o.tonId)
      ? o.tonId as TonEditorial : null,
    preuveSouhaitee: listeTriee(o.preuveSouhaitee, PREUVES_SOUHAITEES, PREUVES_MAX),
    priorites: listeTriee(o.priorites, PRIORITES_NARRATIVES, PRIORITES_MAX),
  };
}

// ---------------------------------------------------------------------------
// Forme canonique — l'identite EDITORIALE
// ---------------------------------------------------------------------------

export const CLES_CANONIQUES_OBJECTIF: readonly string[] = [
  'version', 'type', 'objectifPrincipal', 'contexte', 'messagePrincipal',
  'cible.description', 'cible.ageMin', 'cible.ageMax', 'cible.localisation',
  'cible.niveau',
  'evenement.nom', 'evenement.date', 'evenement.lieu', 'evenement.prix',
  'evenement.placesLimitees', 'evenement.lien',
  'produit.nom', 'produit.benefice', 'produit.offre', 'produit.prix', 'produit.lien',
  'service.nom', 'service.benefice', 'service.probleme', 'service.offre', 'service.lien',
  'offre.nom', 'offre.prix', 'offre.echeance', 'offre.lien',
  'cta.action', 'cta.texte', 'cta.destination',
  'ton', 'preuves', 'priorites',
];

/**
 * La forme canonique de l'objectif — champ par champ, ordre FIXE.
 *
 * C'est elle qui entrera dans l'identite du PLAN le jour ou `m3g-v3` lira un
 * objectif. Elle n'entre PAS dans l'empreinte du RENDU : deux objectifs
 * differents produisent deja deux plans differents, donc deux
 * `montage_plan_id` differents, et l'index unique du rendu les separe.
 *
 * NE JAMAIS REMPLACER PAR `JSON.stringify` — meme raison qu'ailleurs :
 * l'ordre d'insertion changerait l'identite, et un champ oublie donnerait la
 * MEME identite a deux intentions differentes.
 */
export function objectifCanonique(
  brut: ObjectifPartiel | ObjectifCommunication | null | undefined,
): string {
  const o = normaliserObjectif(brut);
  const ou = (v: string | null) => (v === null ? 'aucun' : v);
  const nb = (v: number | null) => (v === null ? 'aucun' : String(v));
  const valeurs: string[] = [
    o.version,
    o.type,
    ou(o.objectifPrincipal),
    ou(o.contexte),
    ou(o.messagePrincipal),
    ou(o.cible.description),
    nb(o.cible.ageMin),
    nb(o.cible.ageMax),
    ou(o.cible.localisation),
    ou(o.cible.niveauConnaissance),
    ou(o.evenement.nom),
    ou(o.evenement.date),
    ou(o.evenement.lieu),
    ou(o.evenement.prix),
    o.evenement.placesLimitees ? 'oui' : 'non',
    ou(o.evenement.lienReservation),
    ou(o.produit.nom),
    ou(o.produit.beneficePrincipal),
    ou(o.produit.offre),
    ou(o.produit.prix),
    ou(o.produit.lien),
    ou(o.service.nom),
    ou(o.service.benefice),
    ou(o.service.problemeResolu),
    ou(o.service.offre),
    ou(o.service.lien),
    ou(o.offre.nom),
    ou(o.offre.prix),
    ou(o.offre.echeance),
    ou(o.offre.lien),
    o.appelAction.actionId,
    ou(o.appelAction.texte),
    ou(o.appelAction.destination),
    ou(o.tonId),
    o.preuveSouhaitee.length === 0 ? 'aucune' : o.preuveSouhaitee.join(','),
    o.priorites.length === 0 ? 'aucune' : o.priorites.join(','),
  ];
  return CLES_CANONIQUES_OBJECTIF
    .map((cle, i) => `${cle}=${valeurs[i]}`)
    .join('|');
}

/**
 * Cet objectif ne demande-t-il rien de plus que la politique d'aujourd'hui ?
 *
 * Si oui, l'identite du plan n'a aucune raison de changer, et tous les plans
 * `m3g-v2` deja calcules restent valides. C'est la contrepartie exacte de
 * `estRecetteHistorique` et de `estProfilHistorique`.
 */
export function estObjectifGenerique(
  o: ObjectifPartiel | ObjectifCommunication | null | undefined,
): boolean {
  if (!o) return true;
  return objectifCanonique(o) === objectifCanonique(null);
}

/**
 * L'objectif EFFECTIF : celui de la video, sinon celui du compte, sinon rien.
 *
 * `objectifVideo ?? objectifParDefautUtilisateur ?? OBJECTIF_DEFAUT`.
 *
 * PAS DE FUSION, CONTRAIREMENT AU PROFIL CREATIF, et c'est deliberé. Un
 * profil creatif se corrige propriete par propriete : changer la transition
 * d'une video n'a aucune raison d'effacer sa police. Un objectif, lui, est
 * une INTENTION ENTIERE : melanger « promouvoir un evenement » du compte avec
 * « vendre un produit » de la video donnerait une intention que personne n'a
 * formulee — un evenement avec un prix produit et un CTA d'achat. Quand la
 * video declare un objectif, il remplace, en bloc.
 */
export function objectifEffectif(
  objectifVideo: ObjectifPartiel | ObjectifCommunication | null | undefined,
  objectifParDefautUtilisateur: ObjectifPartiel | ObjectifCommunication | null | undefined,
): ObjectifCommunication {
  if (objectifVideo && !estObjectifGenerique(objectifVideo)) {
    return normaliserObjectif(objectifVideo);
  }
  if (objectifParDefautUtilisateur && !estObjectifGenerique(objectifParDefautUtilisateur)) {
    return normaliserObjectif(objectifParDefautUtilisateur);
  }
  return { ...OBJECTIF_DEFAUT };
}

// ---------------------------------------------------------------------------
// Lecture d'un corps de requete — schema FERME
// ---------------------------------------------------------------------------

export const MOTIFS_OBJECTIF = [
  'corps_invalide', 'champ_inconnu', 'type_inconnu', 'valeur_invalide',
  'lien_invalide', 'date_invalide',
] as const;
export type MotifObjectif = (typeof MOTIFS_OBJECTIF)[number];

export type LectureObjectif =
  | { ok: true; objectif: ObjectifPartiel }
  | { ok: false; motif: MotifObjectif; message: string };

const CHAMPS_OBJECTIF = [
  'type', 'objectifPrincipal', 'contexte', 'messagePrincipal', 'cible',
  'evenement', 'produit', 'service', 'offre', 'appelAction', 'tonId',
  'preuveSouhaitee', 'priorites',
] as const;

const CHAMPS_PAR_BLOC_OBJECTIF: Record<string, readonly string[]> = {
  cible: ['description', 'ageMin', 'ageMax', 'localisation', 'niveauConnaissance'],
  evenement: ['nom', 'date', 'lieu', 'prix', 'placesLimitees', 'lienReservation'],
  produit: ['nom', 'beneficePrincipal', 'offre', 'prix', 'lien'],
  service: ['nom', 'benefice', 'problemeResolu', 'offre', 'lien'],
  offre: ['nom', 'prix', 'echeance', 'lien'],
  appelAction: ['actionId', 'texte', 'destination'],
};

/** Les champs qui doivent etre un lien affichable, bloc par bloc. */
const CHAMPS_LIEN: Array<[string, string]> = [
  ['evenement', 'lienReservation'],
  ['produit', 'lien'],
  ['service', 'lien'],
  ['offre', 'lien'],
  ['appelAction', 'destination'],
];

/** Les champs qui doivent etre une date ISO valide. */
const CHAMPS_DATE: Array<[string, string]> = [
  ['evenement', 'date'],
  ['offre', 'echeance'],
];

function refusObjectif(motif: MotifObjectif, message: string): LectureObjectif {
  return { ok: false, motif, message };
}

/**
 * Lit un objectif depuis un corps de requete, sans rien deviner.
 *
 * SCHEMA FERME a la racine comme dans chaque bloc, pour la meme raison qu'au
 * Lot 2A : un schema permissif laisserait passer un champ qui deviendrait
 * signifiant plus tard, et il serait deja accepte.
 *
 * REFUS, ET NON CORRECTION. Une date impossible, un lien non-`https`, un ton
 * inconnu sont refuses : ils seraient AFFICHES dans la video, et une valeur
 * fausse corrigee en silence est une valeur fausse qu'on ne verra qu'au
 * montage.
 */
export function lireObjectif(brut: unknown): LectureObjectif {
  const o = objet(brut);
  if (o === null) return refusObjectif('corps_invalide', 'Objectif invalide.');

  // ⚠️ MEME CORRECTIF QUE `lireProfilCreatif`, ET POUR LA MEME PANNE.
  // `normaliserObjectif` ecrit `version` ; le refuser ici empechait tout
  // aller-retour de persistance : `sanitizeDesignStyle` jetait l'objectif
  // entier, sans erreur, et le compte le retrouvait vide. Une autre valeur
  // reste refusee — un objectif d'une version future se lirait faux.
  if (o.version !== undefined && o.version !== VERSION_OBJECTIF) {
    return refusObjectif('valeur_invalide', 'Cet objectif vient d\'une autre version de Studiio.');
  }
  for (const cle of Object.keys(o)) {
    if (cle === 'version') continue;
    if (!(CHAMPS_OBJECTIF as readonly string[]).includes(cle)) {
      return refusObjectif('champ_inconnu', `Le champ « ${cle} » n'existe pas dans l'objectif.`);
    }
  }

  if (o.type !== undefined) {
    if (typeof o.type !== 'string'
      || !((TYPES_OBJECTIF as readonly string[]).includes(o.type)
        || o.type === TYPE_OBJECTIF_GENERIQUE)) {
      return refusObjectif('type_inconnu', 'Cet objectif n\'existe pas.');
    }
  }

  if (o.tonId !== undefined && o.tonId !== null) {
    if (typeof o.tonId !== 'string'
      || !(TONS_EDITORIAUX as readonly string[]).includes(o.tonId)) {
      return refusObjectif('valeur_invalide', 'Ce ton n\'existe pas.');
    }
  }

  for (const champ of ['objectifPrincipal', 'contexte', 'messagePrincipal'] as const) {
    const v = o[champ];
    if (v === undefined || v === null) continue;
    if (texteBorne(v, TEXTE_LONG_MAX) === null) {
      return refusObjectif('valeur_invalide', `« ${champ} » est vide, trop long ou invalide.`);
    }
  }

  for (const [champ, liste] of [
    ['preuveSouhaitee', PREUVES_SOUHAITEES],
    ['priorites', PRIORITES_NARRATIVES],
  ] as const) {
    const v = o[champ];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      return refusObjectif('valeur_invalide', `« ${champ} » doit etre une liste.`);
    }
    for (const item of v) {
      if (typeof item !== 'string' || !(liste as readonly string[]).includes(item)) {
        return refusObjectif('valeur_invalide', `« ${String(item)} » n'existe pas dans ${champ}.`);
      }
    }
  }

  for (const nomBloc of Object.keys(CHAMPS_PAR_BLOC_OBJECTIF)) {
    if (o[nomBloc] === undefined) continue;
    const b = objet(o[nomBloc]);
    if (b === null) return refusObjectif('corps_invalide', `Le bloc « ${nomBloc} » est invalide.`);
    for (const cle of Object.keys(b)) {
      if (!CHAMPS_PAR_BLOC_OBJECTIF[nomBloc].includes(cle)) {
        return refusObjectif('champ_inconnu', `Le champ « ${cle} » n'existe pas dans « ${nomBloc} ».`);
      }
    }
  }

  for (const [nomBloc, champ] of CHAMPS_LIEN) {
    const b = objet(o[nomBloc]);
    if (!b) continue;
    const v = b[champ];
    if (v === undefined || v === null) continue;
    if (lienAffichable(v) === null) {
      return refusObjectif('lien_invalide', 'Un lien doit commencer par https://.');
    }
  }

  for (const [nomBloc, champ] of CHAMPS_DATE) {
    const b = objet(o[nomBloc]);
    if (!b) continue;
    const v = b[champ];
    if (v === undefined || v === null) continue;
    if (dateIso(v) === null) {
      return refusObjectif('date_invalide', 'Une date doit s\'ecrire AAAA-MM-JJ.');
    }
  }

  const cible = objet(o.cible);
  if (cible) {
    for (const champ of ['ageMin', 'ageMax'] as const) {
      const v = cible[champ];
      if (v === undefined || v === null) continue;
      if (nombreBorne(v, AGE_MIN, AGE_MAX) === null) {
        return refusObjectif('valeur_invalide', `« ${champ} » doit etre un age entier plausible.`);
      }
    }
    if (cible.niveauConnaissance !== undefined && cible.niveauConnaissance !== null
      && (typeof cible.niveauConnaissance !== 'string'
        || !(NIVEAUX_CONNAISSANCE as readonly string[]).includes(cible.niveauConnaissance))) {
      return refusObjectif('valeur_invalide', 'Ce niveau de connaissance n\'existe pas.');
    }
  }

  const cta = objet(o.appelAction);
  if (cta && cta.actionId !== undefined) {
    if (typeof cta.actionId !== 'string'
      || !(ACTIONS_CTA as readonly string[]).includes(cta.actionId)) {
      return refusObjectif('valeur_invalide', 'Cette action n\'existe pas.');
    }
  }

  return { ok: true, objectif: o as ObjectifPartiel };
}

/**
 * L'objectif tel qu'il serait archive dans `usage`.
 *
 * Des identifiants, des textes saisis par l'utilisateur, des liens `https`.
 * Rien de sensible, rien de signe, rien de temporaire.
 */
export function objectifPourUsage(
  o: ObjectifPartiel | ObjectifCommunication | null | undefined,
): Record<string, unknown> {
  const n = normaliserObjectif(o);
  return { ...n, canonique: objectifCanonique(n) };
}

// ---------------------------------------------------------------------------
// La recommandation de versioning — a lire avant de brancher le moteur
// ---------------------------------------------------------------------------

/**
 * CE QUE DEVRA FAIRE `ALGORITHME_PLAN` LE JOUR OU M3-G LIRA UN OBJECTIF.
 *
 * Constante DOCUMENTAIRE : elle ne change rien, elle ecrit la decision pour
 * qu'elle ne se reinvente pas.
 *
 * 1. `ALGORITHME_PLAN` passe de `m3g-v2` a `m3g-v3` DANS LE MEME COMMIT que
 *    la premiere ligne de `montage.ts` qui lit un objectif. Pas avant : un
 *    numero incremente sans changement de comportement invaliderait tous les
 *    plans existants pour rien, et referait payer des montages identiques.
 *    Pas apres non plus : entre les deux, `lirePlanIdentique` rendrait un
 *    plan calcule sans objectif pour une demande qui en porte un — la panne
 *    muette exacte que `m3g-v2` vient de fermer.
 *
 * 2. L'IDENTITE DU PLAN devra inclure `objectifCanonique(objectifEffectif)`,
 *    a cote de ce qu'elle contient deja (rushes, coupes, politique, format,
 *    duree cible). Deux demandes qui ne different que par l'objectif doivent
 *    donner deux `montage_plan_id` ; deux demandes identiques, objectif
 *    compris, doivent continuer a reutiliser le meme plan.
 *
 * 3. CE QUI N'ENTRE PAS DANS L'IDENTITE DU PLAN, et n'y entrera jamais : la
 *    police, les couleurs, la LUT, le logo, les animations, la forme du CTA,
 *    l'opacite, les marges. Tout cela vit dans `methode_rendu`. Un test
 *    verifie que changer un seul de ces champs laisse le plan intact.
 *
 * 4. `ALGORITHME_COUPES` (`m3e-v3`) NE BOUGE PAS. Ou couper un rush est une
 *    question de qualite d'image et de parole, pas d'intention commerciale.
 *    Si un jour l'objectif devait deplacer les bornes de coupe, ce serait
 *    `m3e-v4`, et ce serait une decision separee, avec ses propres mesures.
 */
export const M3G_V3_RECOMMANDATION = Object.freeze({
  versionActuelle: 'm3g-v2',
  versionRecommandee: 'm3g-v3',
  declencheur: 'la premiere lecture d\'un ObjectifCommunication par montage.ts',
  identitePlanAjoute: 'objectifCanonique(objectifEffectif)',
  identitePlanExclut: [
    'police', 'couleurs', 'lut', 'logo', 'animations', 'ctaVisuel',
    'opacite', 'margesSures', 'transitions',
  ],
  coupesInchangees: 'm3e-v3',
});
