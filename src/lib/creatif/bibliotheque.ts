/**
 * A_3e1 — LA BIBLIOTHÈQUE CRÉATIVE PERSONNELLE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ELLE NE VIT PAS DANS LE PROFIL CRÉATIF, ET C'EST STRUCTURANT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `profilCreatifCanonique` alimente l'identité du rendu : deux profils
 * différents produisent deux fichiers différents. Y ranger les favoris ferait
 * qu'un cœur cliqué invaliderait tous les montages déjà calculés du compte —
 * une préférence d'affichage qui refait des vidéos.
 *
 * La bibliothèque est donc un FRÈRE de `profilCreatif` dans `design_style`,
 * exactement comme `objectifParDefaut`. Elle se lit et s'écrit seule, elle
 * n'entre dans aucune empreinte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN FAVORI RÉFÈRE TOUJOURS UN IDENTIFIANT QUI EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le jour où un effet quitte un catalogue, les comptes qui l'avaient en
 * favori portent un identifiant mort. Il est RETIRÉ à la lecture, sans
 * erreur : un profil ne doit pas devenir illisible parce qu'un look a été
 * renommé.
 *
 * MODULE PUR. Il valide et il normalise ; il ne lit ni base ni disque.
 */
import { LOOK_IDS } from './looks';
import { STYLE_TEXTE_IDS } from './styles-texte';
import { ANIMATION_TEXTE_IDS } from './animations-texte';
import { ANIMATION_CONTENU_IDS } from './animations-contenu';
import { TRANSITION_CREATIVE_IDS } from './transitions';
import { CAPTION_IDS } from './captions';
import {
  MODES_AUDIO, type ModeAudio,
} from '@/lib/autopilot/analyse/politique-audio';
import {
  banqueAudioValide, cleAudioValide, BANQUE_AUDIO_VIDE, type BanqueAudio,
} from './audio';
import {
  motsVoixValides, type MotVoix,
} from '@/lib/voice/synthese';
import { presetsPersonnelsValides, type PresetPersonnel } from './presets';
import { prononciationsValides, type Prononciation } from '@/lib/voice/prononciations';
import { lutsUtilisateurValides, type LutUtilisateur } from './lut-utilisateur';

/** Les cinq familles qu'une personne peut mettre en favori. */
export const FAMILLES_BIBLIOTHEQUE = [
  'lut', 'styleTexte', 'animationBloc', 'animationContenu', 'transition',
  // A_4 : les sous-titres s'aiment et se retrouvent comme le reste.
  'caption',
  // A_5 : les musiques aussi — mais leurs identifiants sont des CLES du
  // compte, pas un catalogue partage. Voir `favorisValides`.
  'audio',
] as const;
export type FamilleBibliotheque = (typeof FAMILLES_BIBLIOTHEQUE)[number];

/** Ce que l'écran affiche pour chaque famille. */
export const LIBELLES_FAMILLE: Record<FamilleBibliotheque, string> = {
  lut: 'Looks',
  styleTexte: 'Textes',
  animationBloc: 'Mouvements',
  animationContenu: 'Apparitions',
  transition: 'Transitions',
  caption: 'Sous-titres',
  audio: 'Musiques',
};

/**
 * ⚠️ L'ENTRÉE « aucune » EST VALIDE POUR LES APPARITIONS.
 *
 * Elle n'est pas dans `ANIMATIONS_CONTENU` — c'est l'absence d'animation —
 * mais elle est bien un choix que l'écran propose et que le profil accepte.
 * L'omettre rendrait ce choix impossible à mettre en favori, ce qui ferait
 * disparaître le cœur d'une carte sur deux sans explication.
 */
const IDS_PAR_FAMILLE: Record<FamilleBibliotheque, readonly string[]> = {
  lut: LOOK_IDS,
  styleTexte: STYLE_TEXTE_IDS,
  animationBloc: ANIMATION_TEXTE_IDS,
  animationContenu: ANIMATION_CONTENU_IDS.includes('aucune')
    ? ANIMATION_CONTENU_IDS : ['aucune', ...ANIMATION_CONTENU_IDS],
  transition: TRANSITION_CREATIVE_IDS,
  caption: CAPTION_IDS,
  /* ⚠️ VIDE, ET CE N'EST PAS UN OUBLI. Les musiques n'ont pas de catalogue
     partage : ce sont les fichiers DU COMPTE. `favorisValides` les traite a
     part, et la banque elle-meme verifie la propriete par le prefixe. */
  audio: [],
};

export function idsFamille(f: FamilleBibliotheque): readonly string[] {
  return IDS_PAR_FAMILLE[f];
}

/**
 * ⚠️ UNE VRAIE COLLECTION, PAS UNE LISTE DE COURSES.
 *
 * Quarante par famille laisse la place à une collection réelle — la moitié
 * du catalogue de looks — tout en bornant ce qui part dans un `jsonb` à
 * chaque enregistrement. Cinq aurait été un plafond arbitraire ; l'infini
 * aurait laissé un document grossir sans limite.
 */
export const FAVORIS_MAX_PAR_FAMILLE = 40;

export type FavorisCreatifs = Record<FamilleBibliotheque, readonly string[]>;

export interface BibliothequeCreative {
  favoris: FavorisCreatifs;
  /** A_3e2 — les combinaisons que la personne a nommées elle-même. */
  presets: readonly PresetPersonnel[];
  /** A_3e3 — ce que l'Autopilote a le droit de faire varier. */
  automatisation: PolitiqueCreative;
  /** A_5 — la banque de musiques du compte. */
  audio: BanqueAudio;
  /** A_6 — la voix-off enregistree du compte, ou `null`. */
  voixOff: VoixOffEnregistree | null;
  /**
   * A_8d — COMMENT CERTAINS MOTS DOIVENT SE PRONONCER.
   *
   * ⚠️ ICI, ET PAS DANS UNE TABLE A PART. Ce sont des preferences creatives du
   * compte, exactement comme les favoris, les presets et la banque audio qui
   * l'entourent : le meme document JSON les porte deja, avec le meme validateur
   * et le meme chemin d'ecriture atomique. Une table de plus aurait demande une
   * migration pour ranger une liste de deux champs.
   */
  prononciations: readonly Prononciation[];
  /**
   * A_9b — LES LOOKS QUE LE COMPTE A IMPORTES.
   *
   * ⚠️ SŒUR DE `audio`, ET POUR LA MEME RAISON. Ce ne sont pas des entrees
   * d'un catalogue partage : ce sont des FICHIERS du compte, designes par une
   * cle dont le prefixe prouve la propriete. Les graver dans `looks.ts`
   * ferait entrer le look d'une personne dans le code de tout le monde.
   */
  luts: readonly LutUtilisateur[];
}

/**
 * A_6 — LA VOIX-OFF DU COMPTE.
 *
 * ⚠️ LE SCRIPT EST CELUI DE LA PERSONNE, ET IL EST GARDE. C'est ce qui permet
 * a l'Autopilote de reutiliser SA voix sur SES mots, sans qu'une machine ait
 * jamais a ecrire une phrase a sa place. Studiio ne genere aucun script.
 *
 * ⚠️ ET LES MOTS SONT DATES. Sans eux, A_4 refuse de sous-titrer — repartir un
 * texte uniformement donnerait un minutage invente. Ils viennent de
 * l'alignement rendu par la synthese, jamais d'une estimation.
 */
export interface VoixOffEnregistree {
  /** La cle du fichier synthetise, dans le compartiment audio du compte. */
  cle: string;
  /** L'empreinte des octets — deux syntheses differentes, deux rendus. */
  empreinte: string;
  dureeMs: number;
  /** Le texte prononce, tel que la personne l'a ecrit. */
  script: string;
  /** L'identifiant Studiio de la voix employee (prefixe fournisseur). */
  voiceId: string;
  /** Quand elle a ete synthetisee. ISO 8601. */
  creeeLe: string;
  mots: readonly MotVoix[];
}

export function voixOffValide(brut: unknown, userId: string): VoixOffEnregistree | null {
  if (!brut || typeof brut !== 'object') return null;
  const o = brut as Record<string, unknown>;
  /* ⚠️ LA MEME GARDE DE CLE QUE LA BANQUE AUDIO. Le prefixe prouve la
     propriete ; sans lui, une cle d'autrui entrerait dans un profil et
     partirait au rendu. */
  if (!cleAudioValide(o.cle, userId)) return null;
  const script = typeof o.script === 'string' ? o.script.trim() : '';
  const voiceId = typeof o.voiceId === 'string' ? o.voiceId : '';
  const dureeMs = typeof o.dureeMs === 'number' && Number.isFinite(o.dureeMs)
    ? Math.round(o.dureeMs) : 0;
  if (script.length === 0 || script.length > 2000) return null;
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(voiceId)) return null;
  if (dureeMs <= 0 || dureeMs > 15 * 60 * 1000) return null;
  if (typeof o.empreinte !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(o.empreinte)) {
    return null;
  }
  if (typeof o.creeeLe !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(o.creeeLe)) return null;
  const mots = motsVoixValides(o.mots);
  // Sans mots dates, la voix reste utilisable — mais elle ne se sous-titrera
  // pas. C'est un manque, pas une invalidite.
  return {
    cle: o.cle, empreinte: o.empreinte, dureeMs, script, voiceId,
    creeeLe: o.creeeLe, mots,
  };
}

export const FAVORIS_VIDES: FavorisCreatifs = Object.freeze({
  lut: Object.freeze([]) as readonly string[],
  styleTexte: Object.freeze([]) as readonly string[],
  animationBloc: Object.freeze([]) as readonly string[],
  animationContenu: Object.freeze([]) as readonly string[],
  transition: Object.freeze([]) as readonly string[],
  caption: Object.freeze([]) as readonly string[],
  audio: Object.freeze([]) as readonly string[],
}) as FavorisCreatifs;

/**
 * A_3e3 — CE QUE L'AUTOPILOTE A LE DROIT DE CHOISIR.
 *
 * ⚠️ TROIS MODES QUI S'EXCLUENT, PAS TROIS INTERRUPTEURS. Un « varier les
 * effets » ET un « varier les presets » tous deux allumés poseraient une
 * question sans réponse : lequel gagne ? Un seul mode à la fois, et le
 * comportement de chacun tient en une phrase.
 */
export const MODES_CREATIFS = [
  'marque-stricte', 'varier-elements', 'varier-presets',
] as const;
export type ModeCreatif = (typeof MODES_CREATIFS)[number];

export const LIBELLES_MODE: Record<ModeCreatif, string> = {
  'marque-stricte': 'Marque stricte',
  'varier-elements': 'Varier mon style',
  'varier-presets': 'Varier parmi mes presets',
};

export const DESCRIPTIONS_MODE: Record<ModeCreatif, string> = {
  'marque-stricte': 'Studiio conserve toujours les mêmes choix visuels.',
  'varier-elements': 'Studiio varie les effets que tu autorises, sans sortir de ton univers.',
  'varier-presets': 'Studiio alterne entre les presets que tu as choisis.',
};

/**
 * ⚠️ LA VERSION DE LA POLITIQUE ENTRE DANS LA GRAINE.
 *
 * Changer la façon de choisir doit changer les choix — sinon une correction
 * du sélecteur laisserait tous les comptes sur les combinaisons d'hier, et
 * l'on ne saurait jamais si elle a servi.
 */
export const VERSION_POLITIQUE_CREATIVE = 'politique-v1';

export interface PolitiqueCreative {
  mode: ModeCreatif;
  /**
   * A_5 — CE QUE L'AUTOPILOTE FAIT DE LA MUSIQUE, INDEPENDAMMENT DES EFFETS.
   *
   * ⚠️ SEPARE DU MODE CREATIF, ET C'EST VOULU. Quelqu'un peut vouloir une
   * marque strictement fixe ET des musiques qui tournent — ou l'inverse.
   * Les lier aurait force un choix que personne ne demande.
   */
  audioMode: ModeAudio;
  /** Ce que l'Autopilote peut choisir, famille par famille. */
  autorises: FavorisCreatifs;
  /** Les presets entre lesquels il peut alterner. */
  presetsAutorises: readonly string[];
  version: string;
}

export const POLITIQUE_STRICTE: PolitiqueCreative = Object.freeze({
  mode: 'marque-stricte',
  audioMode: 'fixe',
  autorises: FAVORIS_VIDES,
  presetsAutorises: Object.freeze([]) as readonly string[],
  version: VERSION_POLITIQUE_CREATIVE,
});

export function politiqueValide(brut: unknown): PolitiqueCreative {
  if (!brut || typeof brut !== 'object') return POLITIQUE_STRICTE;
  const o = brut as Record<string, unknown>;
  const mode = typeof o.mode === 'string'
    && (MODES_CREATIFS as readonly string[]).includes(o.mode)
    ? o.mode as ModeCreatif : 'marque-stricte';
  const a = (o.autorises ?? {}) as Record<string, unknown>;
  const autorises = {} as Record<FamilleBibliotheque, readonly string[]>;
  for (const famille of FAMILLES_BIBLIOTHEQUE) {
    autorises[famille] = favorisValides(a[famille], famille);
  }
  const presetsAutorises = Array.isArray(o.presetsAutorises)
    ? [...new Set(o.presetsAutorises.filter((x): x is string => typeof x === 'string'))]
      .slice(0, FAVORIS_MAX_PAR_FAMILLE)
    : [];
  const audioMode = typeof o.audioMode === 'string'
    && (MODES_AUDIO as readonly string[]).includes(o.audioMode)
    ? o.audioMode as ModeAudio : 'fixe';
  return {
    mode, audioMode, autorises, presetsAutorises,
    version: VERSION_POLITIQUE_CREATIVE,
  };
}

/** La politique ne demande-t-elle rien de plus que le défaut ? */
export function politiqueVide(p: PolitiqueCreative): boolean {
  return p.mode === 'marque-stricte'
    && p.audioMode === 'fixe'
    && p.presetsAutorises.length === 0
    && FAMILLES_BIBLIOTHEQUE.every((f) => p.autorises[f].length === 0);
}


export const BIBLIOTHEQUE_VIDE: BibliothequeCreative = Object.freeze({
  favoris: FAVORIS_VIDES,
  presets: Object.freeze([]) as readonly PresetPersonnel[],
  automatisation: POLITIQUE_STRICTE,
  audio: BANQUE_AUDIO_VIDE,
  voixOff: null,
  prononciations: Object.freeze([]) as readonly Prononciation[],
  luts: Object.freeze([]) as readonly LutUtilisateur[],
});

/**
 * Les favoris d'une famille, nettoyés.
 *
 * Retire ce qui n'est pas une chaîne, ce qui n'existe plus au catalogue, et
 * les doublons ; borne la liste. L'ORDRE DE LA PERSONNE EST CONSERVÉ : c'est
 * l'ordre dans lequel elle les a ajoutés, et le réordonner serait lui prendre
 * un choix qu'elle a fait.
 */
export function favorisValides(
  brut: unknown, famille: FamilleBibliotheque,
): readonly string[] {
  if (!Array.isArray(brut)) return [];
  const connus = IDS_PAR_FAMILLE[famille];
  const vus = new Set<string>();
  const sortie: string[] = [];
  for (const v of brut) {
    if (typeof v !== 'string' || vus.has(v)) continue;
    /* ⚠️ LES MUSIQUES N'ONT PAS DE CATALOGUE A CONSULTER. Leur identifiant
       est une CLE de stockage du compte : la comparer a une liste partagee
       les refuserait toutes. Ce qui est verifie ici, c'est la FORME ; la
       propriete l'est par le prefixe, dans `banqueAudioValide`. */
    if (famille === 'audio') {
      if (v.length > 400 || v.includes('..') || v.includes('\\') || v.includes('://')) {
        continue;
      }
    } else if (!connus.includes(v)) continue;
    vus.add(v);
    sortie.push(v);
    if (sortie.length >= FAVORIS_MAX_PAR_FAMILLE) break;
  }
  return sortie;
}

/** La bibliothèque complète, telle qu'on accepte de la relire. */
/**
 * ⚠️ `userId` EST NECESSAIRE POUR LA BANQUE AUDIO, ET POUR ELLE SEULE.
 *
 * Une piste est designee par une CLE de stockage, et c'est son prefixe qui
 * prouve la propriete. Relire une banque sans savoir a qui elle appartient
 * laisserait entrer la cle d'autrui dans un catalogue — ou elle serait
 * affichee, cherchee, mise en favori, et finirait par ressembler a une piste
 * legitime. Sans `userId`, la banque est donc VIDE, jamais devinee.
 */
export function bibliothequeValide(
  brut: unknown, userId?: string,
): BibliothequeCreative {
  if (!brut || typeof brut !== 'object') return BIBLIOTHEQUE_VIDE;
  const o = brut as Record<string, unknown>;
  const f = (o.favoris ?? {}) as Record<string, unknown>;
  const favoris = {} as Record<FamilleBibliotheque, readonly string[]>;
  for (const famille of FAMILLES_BIBLIOTHEQUE) {
    favoris[famille] = favorisValides(f[famille], famille);
  }
  return {
    favoris,
    presets: presetsPersonnelsValides(o.presets),
    automatisation: politiqueValide(o.automatisation),
    audio: userId ? banqueAudioValide(o.audio, userId) : BANQUE_AUDIO_VIDE,
    voixOff: userId ? voixOffValide(o.voixOff, userId) : null,
    prononciations: prononciationsValides(o.prononciations),
    /* ⚠️ MEME REGLE QUE LA BANQUE AUDIO : sans compte, on ne devine pas. Une
       cle de LUT porte sa propriete dans son prefixe, et une bibliotheque
       relue sans savoir a qui elle appartient laisserait entrer celle d'un
       tiers. */
    luts: userId ? lutsUtilisateurValides(o.luts, userId) : [],
  };
}

/** La bibliothèque ne demande-t-elle rien ? */
export function bibliothequeVide(b: BibliothequeCreative): boolean {
  return b.voixOff === null
    && b.prononciations.length === 0
    && b.luts.length === 0
    && b.audio.pistes.length === 0
    && b.presets.length === 0
    && politiqueVide(b.automatisation)
    && FAMILLES_BIBLIOTHEQUE.every((f) => b.favoris[f].length === 0);
}

/**
 * Ajoute ou retire un favori.
 *
 * ⚠️ AU PLAFOND, LE PLUS ANCIEN PART. Refuser l'ajout obligerait à expliquer
 * un plafond que personne n'a en tête au moment où il clique un cœur ; faire
 * de la place, en revanche, ne perd que ce qu'il n'a plus regardé depuis
 * quarante ajouts.
 */
export function basculerFavori(
  favoris: FavorisCreatifs, famille: FamilleBibliotheque, id: string,
): FavorisCreatifs {
  const liste = favoris[famille];
  const suivant = liste.includes(id)
    ? liste.filter((x) => x !== id)
    : [...liste, id].slice(-FAVORIS_MAX_PAR_FAMILLE);
  return { ...favoris, [famille]: favorisValides(suivant, famille) };
}

// ─────────────────────────────────────────────────────────────────────────
// LES RÉCENTS
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ LES RÉCENTS NE SONT PAS STOCKÉS, ILS SONT DÉDUITS.
 *
 * Une seconde liste `recentIds`, mise à jour après chaque rendu, serait un
 * historique de plus à écrire, à borner et à réparer — et elle mentirait dès
 * le premier rendu échoué ou le premier enregistrement manqué.
 *
 * Un rendu RÉUSSI est déjà la meilleure preuve qu'un choix a servi. Les
 * récents se lisent donc dans `usage.creatif` des derniers montages, dans
 * l'ordre où ils ont été faits.
 */
export const RECENTS_MAX_PAR_FAMILLE = 10;

/** La clé de `usage.creatif` qui porte le choix d'une famille. */
export const CLE_USAGE_PAR_FAMILLE: Record<FamilleBibliotheque, string> = {
  lut: 'lutId',
  styleTexte: 'styleTexteId',
  animationBloc: 'animationBlocId',
  animationContenu: 'animationContenuId',
  transition: 'transitionId',
  caption: 'captionStyleId',
  audio: 'musicTrackId',
};

/**
 * Les identifiants récemment utilisés, du plus récent au plus ancien.
 *
 * `usages` arrive DÉJÀ TRIÉ, le plus récent d'abord. Les doublons
 * s'effondrent : un look employé six fois n'apparaît qu'une, à sa place la
 * plus récente.
 */
export function recentsDepuisUsages(
  usages: readonly Record<string, unknown>[],
): FavorisCreatifs {
  const sortie = {} as Record<FamilleBibliotheque, readonly string[]>;
  for (const famille of FAMILLES_BIBLIOTHEQUE) {
    const cle = CLE_USAGE_PAR_FAMILLE[famille];
    const connus = IDS_PAR_FAMILLE[famille];
    const vus = new Set<string>();
    const liste: string[] = [];
    for (const u of usages) {
      const creatif = u?.creatif;
      if (!creatif || typeof creatif !== 'object') continue;
      const v = (creatif as Record<string, unknown>)[cle];
      if (typeof v !== 'string' || vus.has(v)) continue;
      /* ⚠️ MEME EXCEPTION QUE POUR LES FAVORIS. Les musiques n'ont pas de
         catalogue partage : leur identifiant est une CLE du compte. La
         comparer a une liste vide les rejetterait toutes, et « Recents »
         resterait desesperement vide. */
      if (famille !== 'audio' && !connus.includes(v)) continue;
      vus.add(v);
      liste.push(v);
      if (liste.length >= RECENTS_MAX_PAR_FAMILLE) break;
    }
    sortie[famille] = liste;
  }
  return sortie;
}
