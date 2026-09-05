/**
 * LOT 2B — LE PROFIL CREATIF D'UN COMPTE : COMMENT SES VIDEOS RESSEMBLENT.
 *
 * ---------------------------------------------------------------------------
 * TROIS COUCHES, ET CE MODULE EST LA TROISIEME
 * ---------------------------------------------------------------------------
 *
 *   1. OBJECTIF DE COMMUNICATION — POURQUOI cette video existe.
 *      `objectif-communication.ts`. Influence le PLAN.
 *   2. PLAN EDITORIAL — QUOI montrer, dans quel ordre.
 *      `m3e-v3` pour les coupes, `m3g-v2` pour le plan.
 *   3. PROFIL CREATIF — COMMENT la video APPARAIT. Ce fichier.
 *
 * La frontiere entre 2 et 3 est la regle la plus importante du lot :
 *
 *     LE PROFIL CREATIF NE CHANGE JAMAIS L'IDENTITE DU PLAN.
 *
 * Changer de police, de couleur, de LUT, de logo, d'animation ou de forme de
 * CTA ne redecide RIEN de ce qui est montre. Recalculer un plan pour cela
 * ferait payer deux fois une decision editoriale qui n'a pas bouge, et
 * melangerait deux niveaux. Un test le verifie.
 *
 * L'inverse est vrai pour l'objectif, et c'est justement pour cela qu'il vit
 * dans un AUTRE fichier, avec une AUTRE empreinte.
 *
 * ---------------------------------------------------------------------------
 * CE QUE LE PROFIL CHANGE, LUI : L'EMPREINTE DU RENDU
 * ---------------------------------------------------------------------------
 *
 * `rush_montage_renders_reussi_unique` porte
 * `(montage_plan_id, montage_plan_version, methode_rendu)`. La reutilisation
 * d'un rendu reussi est STRUCTURELLE. Si le profil n'entrait pas dans
 * `methode_rendu`, changer de CTA rendrait L'ANCIEN FICHIER — sans erreur,
 * sans message, avec l'ancien CTA. C'est la panne muette que le Lot 2A a
 * fermee pour la musique ; elle se rejouerait ici a l'identique.
 *
 * D'ou : toute difference REELLE de profil produit une empreinte differente.
 * Et symetriquement, deux profils VISUELLEMENT identiques doivent produire la
 * MEME empreinte — sinon on paie deux encodages pour un seul resultat. C'est
 * tout le travail de `normaliserProfilCreatif`.
 *
 * ---------------------------------------------------------------------------
 * AUCUNE MARQUE EN DUR, NULLE PART
 * ---------------------------------------------------------------------------
 *
 * `PROFIL_CREATIF_DEFAUT` n'impose RIEN : pas de police, pas de couleur, pas
 * de logo, pas de CTA. C'est le comportement d'avant ce lot, et c'est ce que
 * voit un compte qui n'a jamais rien regle. Le profil d'Afroboost — Bebas
 * Neue, #D91CD2, « Essai gratuit » — est une DONNEE rangee dans le
 * `designStyle` du compte de Bassi, jamais une valeur de ce fichier. Un test
 * verifie qu'aucune de ces valeurs n'apparait dans les defauts.
 *
 * ---------------------------------------------------------------------------
 * DES IDENTIFIANTS, JAMAIS DES CHEMINS
 * ---------------------------------------------------------------------------
 *
 * `policeId`, `lutId`, `transitionId`, `animationId` sont valides contre les
 * listes de `catalogues-creatifs`. Le logo est designe par un couple
 * compartiment/cle, comme la musique du Lot 2A. Aucune URL, aucun chemin,
 * aucun fragment de commande ffmpeg ne peut traverser ce contrat : c'est le
 * meme raisonnement que `CHAMPS_INTERDITS_RENDU`, applique une couche plus
 * haut.
 *
 * POURQUOI `logo` EST UN COUPLE ET NON UN `logoObjetId`. La mediatheque de
 * Studiio liste des OBJETS DE STOCKAGE : `GET /api/media/list` rend `bucket`
 * et `path`, il n'existe aucune table de medias, donc aucun identifiant
 * stable a preferer. `PisteMusicale` a tranche exactement la meme question au
 * Lot 2A, avec le meme commentaire. Inventer ici un `logoObjetId` aurait
 * demande une table, une migration et une seconde facon de designer un
 * fichier — pour zero garantie de plus : le couple est deja refuse s'il
 * contient `..`, un antislash, `://` ou un caractere de controle.
 *
 * MODULE PUR, SANS `crypto` NI STOCKAGE. Il decrit et il valide ; il ne
 * resout rien. L'empreinte vit dans `rendu-contrat`, cote serveur. La
 * verification que le logo EXISTE et APPARTIENT au compte appartiendra a
 * l'etape 2, comme `musique-source.ts` pour la musique.
 */
import {
  ANIMATION_AUCUNE, ANIMATION_IDS, LUT_IDS, POLICE_IDS, PRESET_IDS,
  TRANSITION_IDS,
} from './catalogues-creatifs';

// ---------------------------------------------------------------------------
// Le vocabulaire
// ---------------------------------------------------------------------------

/**
 * La version de la grammaire, ecrite DANS la forme canonique.
 *
 * Le jour ou un champ s'ajoute, ce numero change et toutes les empreintes
 * changent avec lui : un profil lu sous l'ancienne grammaire ne decrit plus
 * le meme rendu.
 */
export const VERSION_PROFIL_CREATIF = 'profil-v1' as const;

/** Les compartiments ou un logo peut vivre. Jamais `videos` ni `audio`. */
export const BUCKETS_LOGO = ['images', 'media'] as const;
export type BucketLogo = (typeof BUCKETS_LOGO)[number];

export const POSITIONS_LOGO = [
  'haut-gauche', 'haut-droite', 'bas-gauche', 'bas-droite', 'centre',
] as const;
export type PositionLogo = (typeof POSITIONS_LOGO)[number];

export const ANCRES_TEXTE = ['haut', 'centre', 'bas'] as const;
export type AncreTexte = (typeof ANCRES_TEXTE)[number];

export const GRAISSES = ['normale', 'grasse'] as const;
export type Graisse = (typeof GRAISSES)[number];

/** Bornes numeriques. Refus hors bornes a la lecture, jamais bornage muet. */
export const TAILLE_LOGO_MIN = 1;
export const TAILLE_LOGO_MAX = 50;
export const OPACITE_MIN = 0;
export const OPACITE_MAX = 1;
export const ECHELLE_MIN = 0.5;
export const ECHELLE_MAX = 3;
export const INTENSITE_MIN = 0;
export const INTENSITE_MAX = 1;
export const DUREE_MS_MIN = 0;
export const DUREE_MS_MAX = 3000;
export const SECONDES_MIN = 0;
export const SECONDES_MAX = 120;
export const MARGE_MIN = 0;
export const MARGE_MAX = 40;
export const TEXTE_MAX = 200;

/**
 * Le nombre de decimales des reels dans la forme canonique.
 *
 * Deux, comme les volumes du Lot 2A, et pour la meme raison : plus fin ne se
 * voit pas et ferait dependre l'empreinte d'un bruit d'arrondi de curseur.
 */
export const DECIMALES = 2;

/** Un objet de stockage — le meme contrat que `PisteMusicale`. */
export interface ObjetStockage {
  bucket: BucketLogo;
  cle: string;
}

export interface ProfilMarque {
  logoActif: boolean;
  logo: ObjetStockage | null;
  position: PositionLogo;
  taillePct: number;
  opacite: number;
}

export interface ProfilTypographie {
  /** Police generale. `null` = ne rien imposer. */
  policeId: string | null;
  policeTitreId: string | null;
  policeTexteId: string | null;
  tailleTitre: number;
  tailleTexte: number;
  graisse: Graisse;
}

/** `null` = aucune couleur imposee. Une couleur est un `#RRGGBB` majuscule. */
export interface ProfilCouleurs {
  primaire: string | null;
  secondaire: string | null;
  accent: string | null;
  fond: string | null;
  texte: string | null;
}

export interface ProfilLut {
  active: boolean;
  lutId: string | null;
  intensite: number;
}

export interface ProfilTexte {
  actif: boolean;
  titre: string | null;
  sousTitre: string | null;
  libre: string | null;
  position: AncreTexte;
  debutSecondes: number;
  dureeSecondes: number;
}

/**
 * Le CTA VISUEL — sa forme, jamais son message.
 *
 * NE PAS CONFONDRE AVEC LE CTA STRATEGIQUE. Ce que le CTA DIT (« Reserve ta
 * place ») et OU il mene sont des decisions d'objectif, pas de style : elles
 * vivent dans `ObjectifCommunication.appelAction`. Ici on ne decrit que la
 * maniere de l'afficher — actif ou non, combien de temps, a quelle place,
 * sous quel modele. Melanger les deux obligerait a rejouer un montage entier
 * pour changer la couleur d'un bouton, et a rejouer un style pour changer un
 * lien.
 *
 * `modeleId` reste hors catalogue tant que l'etape 2 n'a pas dessine les
 * modeles ; il est borne en longueur et incapable de ressembler a un chemin.
 */
export interface ProfilCtaVisuel {
  actif: boolean;
  modeleId: string | null;
  dureeSecondes: number;
  position: AncreTexte;
}

export interface ProfilTransitions {
  active: boolean;
  transitionId: string;
  dureeMs: number;
  intensite: number;
}

export interface ProfilAnimations {
  texteId: string;
  ctaId: string;
  logoId: string;
}

export interface ProfilMargesSures {
  hautPct: number;
  basPct: number;
  gauchePct: number;
  droitePct: number;
}

/**
 * Le profil COMPLET — tous les champs presents, defauts compris.
 *
 * C'est la forme que produit `normaliserProfilCreatif`, et la seule qui entre
 * dans une empreinte. Les formes PARTIELLES (ce que l'ecran envoie, ce qu'un
 * override contient) sont decrites par `ProfilCreatifPartiel`.
 */
export interface ProfilCreatifAutopilote {
  version: typeof VERSION_PROFIL_CREATIF;
  /** De quel preset ce profil est parti. `null` : profil libre. */
  presetId: string | null;
  marque: ProfilMarque;
  typographie: ProfilTypographie;
  couleurs: ProfilCouleurs;
  lut: ProfilLut;
  texte: ProfilTexte;
  ctaVisuel: ProfilCtaVisuel;
  transitions: ProfilTransitions;
  animations: ProfilAnimations;
  margesSures: ProfilMargesSures;
}

/**
 * Un profil partiel : chaque bloc facultatif, chaque propriete facultative.
 *
 * C'EST LE TYPE DE L'OVERRIDE. « Un override absent ne doit pas ecraser le
 * profil » : seul ce qui est ECRIT remplace, et la fusion se fait propriete
 * par propriete, pas bloc par bloc.
 */
export type ProfilCreatifPartiel = {
  presetId?: string | null;
  marque?: Partial<ProfilMarque>;
  typographie?: Partial<ProfilTypographie>;
  couleurs?: Partial<ProfilCouleurs>;
  lut?: Partial<ProfilLut>;
  texte?: Partial<ProfilTexte>;
  ctaVisuel?: Partial<ProfilCtaVisuel>;
  transitions?: Partial<ProfilTransitions>;
  animations?: Partial<ProfilAnimations>;
  margesSures?: Partial<ProfilMargesSures>;
};

/**
 * LE PROFIL QUI N'IMPOSE RIEN — c'est-a-dire le rendu d'avant ce lot.
 *
 * CHAQUE VALEUR EST UN « NE RIEN FAIRE », PAS UN GOUT. Logo inactif, aucune
 * police, aucune couleur, aucune LUT, aucun texte, aucun CTA, transition
 * `cut` (ce que le moteur fait deja : il concatene), animations `none`,
 * marges a zero. Un compte neuf produit donc exactement le meme fichier
 * qu'hier, et `estProfilHistorique` le reconnait.
 */
export const PROFIL_CREATIF_DEFAUT: ProfilCreatifAutopilote = Object.freeze({
  version: VERSION_PROFIL_CREATIF,
  presetId: null,
  marque: Object.freeze({
    logoActif: false,
    logo: null,
    position: 'bas-droite',
    taillePct: 12,
    opacite: 1,
  }),
  typographie: Object.freeze({
    policeId: null,
    policeTitreId: null,
    policeTexteId: null,
    tailleTitre: 1,
    tailleTexte: 1,
    graisse: 'normale',
  }),
  couleurs: Object.freeze({
    primaire: null, secondaire: null, accent: null, fond: null, texte: null,
  }),
  lut: Object.freeze({ active: false, lutId: null, intensite: 1 }),
  texte: Object.freeze({
    actif: false, titre: null, sousTitre: null, libre: null,
    position: 'bas', debutSecondes: 0, dureeSecondes: 3,
  }),
  ctaVisuel: Object.freeze({
    actif: false, modeleId: null, dureeSecondes: 3, position: 'bas',
  }),
  transitions: Object.freeze({
    active: false, transitionId: 'cut', dureeMs: 300, intensite: 0.5,
  }),
  animations: Object.freeze({
    texteId: ANIMATION_AUCUNE, ctaId: ANIMATION_AUCUNE, logoId: ANIMATION_AUCUNE,
  }),
  margesSures: Object.freeze({
    hautPct: 0, basPct: 0, gauchePct: 0, droitePct: 0,
  }),
}) as ProfilCreatifAutopilote;

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function arrondir(v: number, decimales = DECIMALES): number {
  const f = 10 ** decimales;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function nombreOu(v: unknown, defaut: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return defaut;
  if (v < min || v > max) return defaut;
  return arrondir(v);
}

function dansListe(v: unknown, liste: readonly string[], defaut: string): string {
  return typeof v === 'string' && liste.includes(v) ? v : defaut;
}

/** Une couleur `#RGB` ou `#RRGGBB`, ramenee a `#RRGGBB` majuscule. */
export function normaliserHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  }
  return null;
}

/** Un texte affichable : non vide, borne, sans caractere de controle. */
export function borneTexte(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || s.length > TEXTE_MAX) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

/**
 * Un identifiant libre — borne, et incapable de ressembler a un chemin.
 *
 * Utilise pour `modeleId`, dont le catalogue n'existe pas encore. Le jour ou
 * il existera, ce sera un `dansListe` de plus et cette fonction disparaitra.
 */
export function borneIdentifiant(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 0 || s.length > 64) return null;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) return null;
  return s;
}

/**
 * Ramene les champs SANS OBJET a leur valeur par defaut.
 *
 * C'EST CE QUI EVITE DE PAYER DEUX ENCODAGES POUR UN SEUL RESULTAT. Une
 * opacite de logo n'a aucun sens sans logo actif ; une intensite de LUT n'en
 * a aucune sans LUT ; une duree de CTA n'en a aucune sans CTA. Sans cette
 * remise a zero, « logo inactif, opacite 30 % » et « logo inactif, opacite
 * 70 % » — VISUELLEMENT IDENTIQUES — auraient deux empreintes.
 *
 * Meme raisonnement que `normaliserRecette` du Lot 2A, et la meme dette
 * evitee.
 *
 * TOLERANTE, LA OU `lireProfilCreatif` EST STRICTE. Cette fonction relit une
 * base qui a pu etre ecrite par une version future : elle degrade vers le
 * defaut, elle n'echoue jamais. La lecture d'un corps de requete, elle,
 * refuse — parce qu'un appelant qui se trompe doit l'apprendre.
 */
export function normaliserProfilCreatif(
  brut: ProfilCreatifPartiel | ProfilCreatifAutopilote | null | undefined,
): ProfilCreatifAutopilote {
  const p = (brut ?? {}) as Record<string, unknown>;
  const D = PROFIL_CREATIF_DEFAUT;

  const bloc = (nom: string): Record<string, unknown> => {
    const v = p[nom];
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? v as Record<string, unknown> : {};
  };

  // -- Marque ------------------------------------------------------------
  const m = bloc('marque');
  const logoBrut = m.logo;
  const logoLu = (typeof logoBrut === 'object' && logoBrut !== null && !Array.isArray(logoBrut)
    && typeof (logoBrut as ObjetStockage).bucket === 'string'
    && (BUCKETS_LOGO as readonly string[]).includes((logoBrut as ObjetStockage).bucket)
    && typeof (logoBrut as ObjetStockage).cle === 'string'
    && (logoBrut as ObjetStockage).cle.length > 0)
    ? {
      bucket: (logoBrut as ObjetStockage).bucket,
      cle: (logoBrut as ObjetStockage).cle,
    }
    : null;
  const logoDemande = typeof m.logoActif === 'boolean' ? m.logoActif : D.marque.logoActif;
  // Un logo actif SANS fichier n'affiche rien : c'est le profil par defaut.
  const logoUtile = logoDemande && logoLu !== null;
  const marque: ProfilMarque = {
    logoActif: logoUtile,
    logo: logoUtile ? logoLu : null,
    position: logoUtile
      ? dansListe(m.position, POSITIONS_LOGO, D.marque.position) as PositionLogo
      : D.marque.position,
    taillePct: logoUtile
      ? nombreOu(m.taillePct, D.marque.taillePct, TAILLE_LOGO_MIN, TAILLE_LOGO_MAX)
      : D.marque.taillePct,
    opacite: logoUtile
      ? nombreOu(m.opacite, D.marque.opacite, OPACITE_MIN, OPACITE_MAX)
      : D.marque.opacite,
  };

  // -- Typographie -------------------------------------------------------
  const t = bloc('typographie');
  const police = (v: unknown): string | null =>
    (typeof v === 'string' && POLICE_IDS.includes(v) ? v : null);
  const typographie: ProfilTypographie = {
    policeId: police(t.policeId),
    policeTitreId: police(t.policeTitreId),
    policeTexteId: police(t.policeTexteId),
    tailleTitre: nombreOu(t.tailleTitre, D.typographie.tailleTitre, ECHELLE_MIN, ECHELLE_MAX),
    tailleTexte: nombreOu(t.tailleTexte, D.typographie.tailleTexte, ECHELLE_MIN, ECHELLE_MAX),
    graisse: dansListe(t.graisse, GRAISSES, D.typographie.graisse) as Graisse,
  };

  // -- Couleurs ----------------------------------------------------------
  const c = bloc('couleurs');
  const couleurs: ProfilCouleurs = {
    primaire: normaliserHex(c.primaire),
    secondaire: normaliserHex(c.secondaire),
    accent: normaliserHex(c.accent),
    fond: normaliserHex(c.fond),
    texte: normaliserHex(c.texte),
  };

  // -- LUT ---------------------------------------------------------------
  const l = bloc('lut');
  const lutId = typeof l.lutId === 'string' && LUT_IDS.includes(l.lutId) ? l.lutId : null;
  const lutActive = (typeof l.active === 'boolean' ? l.active : D.lut.active) && lutId !== null;
  const lut: ProfilLut = {
    active: lutActive,
    lutId: lutActive ? lutId : null,
    intensite: lutActive
      ? nombreOu(l.intensite, D.lut.intensite, INTENSITE_MIN, INTENSITE_MAX)
      : D.lut.intensite,
  };

  // -- Texte -------------------------------------------------------------
  const x = bloc('texte');
  const texteDemande = typeof x.actif === 'boolean' ? x.actif : D.texte.actif;
  const titre = borneTexte(x.titre);
  const sousTitre = borneTexte(x.sousTitre);
  const libre = borneTexte(x.libre);
  // Un texte actif sans le moindre mot n'affiche rien : c'est le defaut.
  const texteUtile = texteDemande
    && (titre !== null || sousTitre !== null || libre !== null);
  const texte: ProfilTexte = texteUtile ? {
    actif: true,
    titre, sousTitre, libre,
    position: dansListe(x.position, ANCRES_TEXTE, D.texte.position) as AncreTexte,
    debutSecondes: nombreOu(x.debutSecondes, D.texte.debutSecondes, SECONDES_MIN, SECONDES_MAX),
    dureeSecondes: nombreOu(x.dureeSecondes, D.texte.dureeSecondes, SECONDES_MIN, SECONDES_MAX),
  } : { ...D.texte };

  // -- CTA visuel --------------------------------------------------------
  const k = bloc('ctaVisuel');
  const ctaActif = typeof k.actif === 'boolean' ? k.actif : D.ctaVisuel.actif;
  const ctaVisuel: ProfilCtaVisuel = ctaActif ? {
    actif: true,
    modeleId: borneIdentifiant(k.modeleId),
    dureeSecondes: nombreOu(
      k.dureeSecondes, D.ctaVisuel.dureeSecondes, SECONDES_MIN, SECONDES_MAX,
    ),
    position: dansListe(k.position, ANCRES_TEXTE, D.ctaVisuel.position) as AncreTexte,
  } : { ...D.ctaVisuel };

  // -- Transitions -------------------------------------------------------
  const tr = bloc('transitions');
  const trActive = typeof tr.active === 'boolean' ? tr.active : D.transitions.active;
  const transitions: ProfilTransitions = trActive ? {
    active: true,
    transitionId: dansListe(tr.transitionId, TRANSITION_IDS, D.transitions.transitionId),
    dureeMs: nombreOu(tr.dureeMs, D.transitions.dureeMs, DUREE_MS_MIN, DUREE_MS_MAX),
    intensite: nombreOu(tr.intensite, D.transitions.intensite, INTENSITE_MIN, INTENSITE_MAX),
  } : { ...D.transitions };

  // -- Animations --------------------------------------------------------
  const a = bloc('animations');
  const animations: ProfilAnimations = {
    texteId: dansListe(a.texteId, ANIMATION_IDS, D.animations.texteId),
    ctaId: dansListe(a.ctaId, ANIMATION_IDS, D.animations.ctaId),
    logoId: dansListe(a.logoId, ANIMATION_IDS, D.animations.logoId),
  };

  // -- Marges sures ------------------------------------------------------
  const g = bloc('margesSures');
  const margesSures: ProfilMargesSures = {
    hautPct: nombreOu(g.hautPct, D.margesSures.hautPct, MARGE_MIN, MARGE_MAX),
    basPct: nombreOu(g.basPct, D.margesSures.basPct, MARGE_MIN, MARGE_MAX),
    gauchePct: nombreOu(g.gauchePct, D.margesSures.gauchePct, MARGE_MIN, MARGE_MAX),
    droitePct: nombreOu(g.droitePct, D.margesSures.droitePct, MARGE_MIN, MARGE_MAX),
  };

  return {
    version: VERSION_PROFIL_CREATIF,
    presetId: typeof p.presetId === 'string' && PRESET_IDS.includes(p.presetId)
      ? p.presetId : null,
    marque, typographie, couleurs, lut, texte, ctaVisuel,
    transitions, animations, margesSures,
  };
}

// ---------------------------------------------------------------------------
// Forme canonique
// ---------------------------------------------------------------------------

/**
 * Les cles de la forme canonique, dans leur ordre d'ecriture.
 *
 * Exportee pour qu'un test puisse verifier qu'aucun champ du type n'a ete
 * ajoute sans entrer dans l'empreinte — c'est le seul garde-fou contre le
 * piege decrit dans l'en-tete.
 */
export const CLES_CANONIQUES_PROFIL: readonly string[] = [
  'version', 'preset',
  'marque.logoActif', 'marque.logo', 'marque.position', 'marque.taillePct', 'marque.opacite',
  'typo.police', 'typo.policeTitre', 'typo.policeTexte', 'typo.tailleTitre',
  'typo.tailleTexte', 'typo.graisse',
  'couleurs.primaire', 'couleurs.secondaire', 'couleurs.accent', 'couleurs.fond',
  'couleurs.texte',
  'lut.active', 'lut.id', 'lut.intensite',
  'texte.actif', 'texte.titre', 'texte.sousTitre', 'texte.libre', 'texte.position',
  'texte.debut', 'texte.duree',
  'cta.actif', 'cta.modele', 'cta.duree', 'cta.position',
  'transitions.active', 'transitions.id', 'transitions.dureeMs', 'transitions.intensite',
  'anim.texte', 'anim.cta', 'anim.logo',
  'marges.haut', 'marges.bas', 'marges.gauche', 'marges.droite',
];

/**
 * La forme canonique : champ par champ, dans un ordre FIXE.
 *
 * NE JAMAIS REMPLACER PAR `JSON.stringify`. Il serialise dans l'ordre
 * d'insertion : deux profils porteurs des memes valeurs, construits dans un
 * ordre different, rendraient deux chaines — donc deux encodages du meme
 * resultat. Et le piege inverse est pire : un champ ajoute plus tard et
 * oublie dans la serialisation rendrait la MEME empreinte pour deux profils
 * differents, c'est-a-dire l'ancienne video pour un nouveau style.
 */
export function profilCreatifCanonique(
  brut: ProfilCreatifPartiel | ProfilCreatifAutopilote | null | undefined,
): string {
  const p = normaliserProfilCreatif(brut);
  const d = DECIMALES;
  const ou = (v: string | null) => (v === null ? 'aucun' : v);
  const oui = (v: boolean) => (v ? 'oui' : 'non');
  const valeurs: string[] = [
    p.version,
    ou(p.presetId),
    oui(p.marque.logoActif),
    p.marque.logo === null ? 'aucun' : `${p.marque.logo.bucket}:${p.marque.logo.cle}`,
    p.marque.position,
    p.marque.taillePct.toFixed(d),
    p.marque.opacite.toFixed(d),
    ou(p.typographie.policeId),
    ou(p.typographie.policeTitreId),
    ou(p.typographie.policeTexteId),
    p.typographie.tailleTitre.toFixed(d),
    p.typographie.tailleTexte.toFixed(d),
    p.typographie.graisse,
    ou(p.couleurs.primaire),
    ou(p.couleurs.secondaire),
    ou(p.couleurs.accent),
    ou(p.couleurs.fond),
    ou(p.couleurs.texte),
    oui(p.lut.active),
    ou(p.lut.lutId),
    p.lut.intensite.toFixed(d),
    oui(p.texte.actif),
    ou(p.texte.titre),
    ou(p.texte.sousTitre),
    ou(p.texte.libre),
    p.texte.position,
    p.texte.debutSecondes.toFixed(d),
    p.texte.dureeSecondes.toFixed(d),
    oui(p.ctaVisuel.actif),
    ou(p.ctaVisuel.modeleId),
    p.ctaVisuel.dureeSecondes.toFixed(d),
    p.ctaVisuel.position,
    oui(p.transitions.active),
    p.transitions.transitionId,
    p.transitions.dureeMs.toFixed(0),
    p.transitions.intensite.toFixed(d),
    p.animations.texteId,
    p.animations.ctaId,
    p.animations.logoId,
    p.margesSures.hautPct.toFixed(d),
    p.margesSures.basPct.toFixed(d),
    p.margesSures.gauchePct.toFixed(d),
    p.margesSures.droitePct.toFixed(d),
  ];
  return CLES_CANONIQUES_PROFIL
    .map((cle, i) => `${cle}=${valeurs[i]}`)
    .join('|');
}

/**
 * Ce profil decrit-il exactement le rendu d'avant ce lot ?
 *
 * Si oui, `methodeRendu` garde l'ancienne valeur et les rendus deja reussis
 * restent reutilisables — ce lot ne transforme pas tout le passe en travail a
 * refaire. C'est la contrepartie exacte de `estRecetteHistorique`.
 */
export function estProfilHistorique(
  p: ProfilCreatifPartiel | ProfilCreatifAutopilote | null | undefined,
): boolean {
  if (!p) return true;
  return profilCreatifCanonique(p) === profilCreatifCanonique(null);
}

// ---------------------------------------------------------------------------
// Fusion profil + override
// ---------------------------------------------------------------------------

/**
 * Le profil EFFECTIF : celui du compte, corrige par ce que la video demande.
 *
 * PROPRIETE PAR PROPRIETE, PAS BLOC PAR BLOC. Un override
 * `{ transitions: { transitionId: 'crossfade' } }` ne doit remplacer QUE la
 * transition : si la fusion remplacait le bloc entier, la duree et
 * l'intensite reglees par l'utilisateur disparaitraient sans qu'il l'ait
 * demande. C'est le cas nomme du cahier des charges, et il est teste.
 *
 * `undefined` NE REMPLACE JAMAIS. Un champ absent de l'override laisse celui
 * du profil. `null`, en revanche, est une VALEUR : il retire explicitement
 * une couleur ou une police pour cette video.
 */
export function fusionnerProfilEtOverride(
  profil: ProfilCreatifPartiel | ProfilCreatifAutopilote | null | undefined,
  override: ProfilCreatifPartiel | null | undefined,
): ProfilCreatifAutopilote {
  const base = normaliserProfilCreatif(profil);
  if (!override) return base;

  const fusionne = { ...base } as Record<string, unknown>;
  const o = override as Record<string, unknown>;

  for (const [cle, valeur] of Object.entries(o)) {
    if (valeur === undefined) continue;
    if (cle === 'version') continue;
    const actuel = fusionne[cle];
    if (
      typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
      && typeof actuel === 'object' && actuel !== null && !Array.isArray(actuel)
    ) {
      const sousFusion = { ...(actuel as Record<string, unknown>) };
      for (const [sc, sv] of Object.entries(valeur as Record<string, unknown>)) {
        if (sv === undefined) continue;
        sousFusion[sc] = sv;
      }
      fusionne[cle] = sousFusion;
    } else {
      fusionne[cle] = valeur;
    }
  }

  // RENORMALISER APRES FUSION, jamais avant. Desactiver la LUT dans
  // l'override doit aussi effacer son intensite, sinon deux resultats
  // identiques auraient deux empreintes.
  return normaliserProfilCreatif(fusionne as ProfilCreatifPartiel);
}

// ---------------------------------------------------------------------------
// Lecture d'un corps de requete — schema FERME
// ---------------------------------------------------------------------------

export const MOTIFS_PROFIL = [
  'corps_invalide',
  'champ_inconnu',
  'valeur_invalide',
  'identifiant_inconnu',
  'logo_invalide',
] as const;
export type MotifProfil = (typeof MOTIFS_PROFIL)[number];

export type LectureProfil =
  | { ok: true; profil: ProfilCreatifPartiel }
  | { ok: false; motif: MotifProfil; message: string };

const BLOCS_PROFIL = [
  'presetId', 'marque', 'typographie', 'couleurs', 'lut', 'texte',
  'ctaVisuel', 'transitions', 'animations', 'margesSures',
] as const;

const CHAMPS_PAR_BLOC: Record<string, readonly string[]> = {
  marque: ['logoActif', 'logo', 'position', 'taillePct', 'opacite'],
  typographie: [
    'policeId', 'policeTitreId', 'policeTexteId', 'tailleTitre', 'tailleTexte', 'graisse',
  ],
  couleurs: ['primaire', 'secondaire', 'accent', 'fond', 'texte'],
  lut: ['active', 'lutId', 'intensite'],
  texte: ['actif', 'titre', 'sousTitre', 'libre', 'position', 'debutSecondes', 'dureeSecondes'],
  ctaVisuel: ['actif', 'modeleId', 'dureeSecondes', 'position'],
  transitions: ['active', 'transitionId', 'dureeMs', 'intensite'],
  animations: ['texteId', 'ctaId', 'logoId'],
  margesSures: ['hautPct', 'basPct', 'gauchePct', 'droitePct'],
};

const CHAMPS_LOGO = ['bucket', 'cle'] as const;

function objet(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}

/**
 * Une cle d'objet est-elle recevable, sur sa seule forme ?
 *
 * LA MEME LISTE DE REFUS QUE `cleMusiqueValide`, RECOPIEE A DESSEIN. Ce
 * module est pur ; importer `@/lib/storage/acces-objet` y tirerait la chaine
 * du stockage et le rendrait illisible par l'ecran. Le Lot 2A a tranche la
 * meme question de la meme facon, et un test compare les deux comportements.
 *
 * ET CE N'EST PAS LA GARDE FINALE : l'etape 2 reposera le prefixe de
 * propriete et interrogera le stockage, comme `verifierMusique`.
 */
export function cleLogoValide(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 1024) return false;
  let decodee: string;
  try { decodee = decodeURIComponent(v); } catch { return false; }
  for (const valeur of [v, decodee]) {
    if (valeur.includes('..')) return false;
    if (valeur.includes('\\')) return false;
    if (valeur.includes('://')) return false;
    if (valeur.startsWith('/')) return false;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(valeur)) return false;
  }
  return true;
}

function refus(motif: MotifProfil, message: string): LectureProfil {
  return { ok: false, motif, message };
}

/**
 * Lit un profil creatif depuis un corps de requete, sans rien deviner.
 *
 * SCHEMA FERME, A LA RACINE COMME DANS CHAQUE BLOC. Une propriete inconnue
 * est REFUSEE. Un schema permissif laisserait passer `logoUrl`, `fontFile`,
 * `lutPath`, `filtre` ou `args` sans que personne le remarque — et le jour ou
 * un champ de ce nom deviendrait signifiant, il serait deja accepte.
 *
 * REFUS, ET NON BORNAGE, pour les valeurs hors bornes et les identifiants
 * inconnus. Borner silencieusement `1.5` a `1` accepterait une demande que
 * personne n'a formulee ; retomber en silence sur `cut` quand la transition
 * demandee n'existe pas donnerait un style choisi et sans effet, ce qui est
 * pire qu'un style refuse.
 */
export function lireProfilCreatif(brut: unknown): LectureProfil {
  const o = objet(brut);
  if (o === null) return refus('corps_invalide', 'Profil creatif invalide.');

  for (const cle of Object.keys(o)) {
    if (!(BLOCS_PROFIL as readonly string[]).includes(cle)) {
      return refus('champ_inconnu', `Le champ « ${cle} » n'existe pas dans le profil creatif.`);
    }
  }

  const sortie: Record<string, unknown> = {};

  if (o.presetId !== undefined && o.presetId !== null) {
    if (typeof o.presetId !== 'string' || !PRESET_IDS.includes(o.presetId)) {
      return refus('identifiant_inconnu', 'Ce preset n\'existe pas.');
    }
    sortie.presetId = o.presetId;
  }

  for (const nomBloc of Object.keys(CHAMPS_PAR_BLOC)) {
    if (o[nomBloc] === undefined) continue;
    const b = objet(o[nomBloc]);
    if (b === null) return refus('corps_invalide', `Le bloc « ${nomBloc} » est invalide.`);
    for (const cle of Object.keys(b)) {
      if (!CHAMPS_PAR_BLOC[nomBloc].includes(cle)) {
        return refus('champ_inconnu', `Le champ « ${cle} » n'existe pas dans « ${nomBloc} ».`);
      }
    }
    sortie[nomBloc] = b;
  }

  // -- Le logo : un objet de stockage, jamais une URL --------------------
  const m = objet(sortie.marque);
  if (m && m.logo !== undefined && m.logo !== null) {
    const l = objet(m.logo);
    if (l === null) return refus('logo_invalide', 'Logo invalide.');
    for (const cle of Object.keys(l)) {
      if (!(CHAMPS_LOGO as readonly string[]).includes(cle)) {
        return refus('champ_inconnu', `Le champ « ${cle} » n'existe pas dans le logo.`);
      }
    }
    if (typeof l.bucket !== 'string'
      || !(BUCKETS_LOGO as readonly string[]).includes(l.bucket)) {
      return refus('logo_invalide', 'Ce logo ne vient pas de ta mediatheque.');
    }
    if (!cleLogoValide(l.cle)) return refus('logo_invalide', 'Logo invalide.');
  }

  // -- Les identifiants de catalogue -------------------------------------
  const controles: Array<[string, string, readonly string[], string]> = [
    ['typographie', 'policeId', POLICE_IDS, 'Cette police n\'existe pas.'],
    ['typographie', 'policeTitreId', POLICE_IDS, 'Cette police de titre n\'existe pas.'],
    ['typographie', 'policeTexteId', POLICE_IDS, 'Cette police de texte n\'existe pas.'],
    ['lut', 'lutId', LUT_IDS, 'Ce look n\'existe pas.'],
    ['transitions', 'transitionId', TRANSITION_IDS, 'Cette transition n\'existe pas.'],
    ['animations', 'texteId', ANIMATION_IDS, 'Cette animation n\'existe pas.'],
    ['animations', 'ctaId', ANIMATION_IDS, 'Cette animation n\'existe pas.'],
    ['animations', 'logoId', ANIMATION_IDS, 'Cette animation n\'existe pas.'],
  ];
  for (const [nomBloc, champ, liste, message] of controles) {
    const b = objet(sortie[nomBloc]);
    if (!b) continue;
    const v = b[champ];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !liste.includes(v)) {
      return refus('identifiant_inconnu', message);
    }
  }

  // -- Les enumerations fermees ------------------------------------------
  const enums: Array<[string, string, readonly string[], string]> = [
    ['marque', 'position', POSITIONS_LOGO, 'Position de logo inconnue.'],
    ['typographie', 'graisse', GRAISSES, 'Graisse inconnue.'],
    ['texte', 'position', ANCRES_TEXTE, 'Position de texte inconnue.'],
    ['ctaVisuel', 'position', ANCRES_TEXTE, 'Position de CTA inconnue.'],
  ];
  for (const [nomBloc, champ, liste, message] of enums) {
    const b = objet(sortie[nomBloc]);
    if (!b) continue;
    const v = b[champ];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !liste.includes(v)) {
      return refus('valeur_invalide', message);
    }
  }

  // -- Les couleurs ------------------------------------------------------
  const coul = objet(sortie.couleurs);
  if (coul) {
    for (const [champ, v] of Object.entries(coul)) {
      if (v === undefined || v === null) continue;
      if (normaliserHex(v) === null) {
        return refus('valeur_invalide', `La couleur « ${champ} » doit etre un code hexadecimal.`);
      }
    }
  }

  // -- Les bornes numeriques ---------------------------------------------
  const bornes: Array<[string, string, number, number]> = [
    ['marque', 'taillePct', TAILLE_LOGO_MIN, TAILLE_LOGO_MAX],
    ['marque', 'opacite', OPACITE_MIN, OPACITE_MAX],
    ['typographie', 'tailleTitre', ECHELLE_MIN, ECHELLE_MAX],
    ['typographie', 'tailleTexte', ECHELLE_MIN, ECHELLE_MAX],
    ['lut', 'intensite', INTENSITE_MIN, INTENSITE_MAX],
    ['texte', 'debutSecondes', SECONDES_MIN, SECONDES_MAX],
    ['texte', 'dureeSecondes', SECONDES_MIN, SECONDES_MAX],
    ['ctaVisuel', 'dureeSecondes', SECONDES_MIN, SECONDES_MAX],
    ['transitions', 'dureeMs', DUREE_MS_MIN, DUREE_MS_MAX],
    ['transitions', 'intensite', INTENSITE_MIN, INTENSITE_MAX],
    ['margesSures', 'hautPct', MARGE_MIN, MARGE_MAX],
    ['margesSures', 'basPct', MARGE_MIN, MARGE_MAX],
    ['margesSures', 'gauchePct', MARGE_MIN, MARGE_MAX],
    ['margesSures', 'droitePct', MARGE_MIN, MARGE_MAX],
  ];
  for (const [nomBloc, champ, min, max] of bornes) {
    const b = objet(sortie[nomBloc]);
    if (!b) continue;
    const v = b[champ];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      return refus('valeur_invalide', `« ${champ} » doit etre compris entre ${min} et ${max}.`);
    }
  }

  // -- Les textes libres -------------------------------------------------
  const tx = objet(sortie.texte);
  if (tx) {
    for (const champ of ['titre', 'sousTitre', 'libre'] as const) {
      const v = tx[champ];
      if (v === undefined || v === null) continue;
      if (borneTexte(v) === null) {
        return refus('valeur_invalide', `« ${champ} » est vide, trop long ou invalide.`);
      }
    }
  }
  const cta = objet(sortie.ctaVisuel);
  if (cta && cta.modeleId !== undefined && cta.modeleId !== null) {
    if (borneIdentifiant(cta.modeleId) === null) {
      return refus('valeur_invalide', 'Modele de CTA invalide.');
    }
  }

  return { ok: true, profil: sortie as ProfilCreatifPartiel };
}

/**
 * Le profil tel qu'il est archive dans `usage`.
 *
 * RIEN DE SENSIBLE, PAR CONSTRUCTION : des identifiants de catalogue, des
 * couleurs, et un couple compartiment/cle — jamais une URL, jamais une
 * signature. On y joint la forme canonique : c'est elle qui a produit
 * l'empreinte, et la relire est le seul moyen d'auditer un rendu sans
 * reconstruire le raisonnement.
 */
export function profilCreatifPourUsage(
  p: ProfilCreatifPartiel | ProfilCreatifAutopilote | null | undefined,
): Record<string, unknown> {
  const n = normaliserProfilCreatif(p);
  return { ...n, canonique: profilCreatifCanonique(n) };
}
