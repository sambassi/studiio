/**
 * LOT 2A — LA RECETTE AUDIO D'UN RENDU.
 *
 * ---------------------------------------------------------------------------
 * CE QU'ELLE EST, ET OU ELLE VIT
 * ---------------------------------------------------------------------------
 *
 * Le PLAN de montage dit ce qui est monte : quels clips, dans quel ordre, dans
 * quel format, pour quelle duree cible. La RECETTE AUDIO dit comment ce plan
 * est materialise en son. Ce sont deux choses differentes, et c'est pour cela
 * que la recette n'entre PAS dans l'identite du plan :
 *
 *     MEME PLAN + RECETTE DIFFERENTE = RENDU DIFFERENT
 *
 * Trois rendus du meme plan — l'un sur une musique X, l'autre sur une musique
 * Y, le troisieme sans musique — sont trois materialisations legitimes du meme
 * choix editorial. Faire entrer la musique dans
 * `rush_montage_plans_identite_unique` obligerait a recalculer un plan qui n'a
 * pas bouge, et melangerait deux niveaux de decision.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI L'EMPREINTE EST LE COEUR DE CE MODULE
 * ---------------------------------------------------------------------------
 *
 * `rush_montage_renders_reussi_unique` porte
 * `(montage_plan_id, montage_plan_version, methode_rendu)`. La reutilisation
 * d'un rendu reussi est STRUCTURELLE : la base refuse le second, et l'appelant
 * relit le premier. C'est ce qui evite de payer deux fois le meme encodage.
 *
 * Consequence directe : si la recette ne change pas `methode_rendu`, changer
 * de musique rendrait L'ANCIEN FICHIER. Pas une erreur, pas un message — la
 * video precedente, avec son ancienne bande son. C'est exactement la panne
 * silencieuse que le passage de `m3e-v2` a `m3e-v3` a servi a eviter cote
 * coupes, et elle se rejouerait ici a l'identique.
 *
 * D'ou : toute difference de recette DOIT produire une empreinte differente.
 *
 * ---------------------------------------------------------------------------
 * LA FORME CANONIQUE, ET POURQUOI PAS `JSON.stringify`
 * ---------------------------------------------------------------------------
 *
 * `JSON.stringify` serialise dans l'ordre d'insertion des proprietes. Deux
 * objets porteurs des memes valeurs, construits dans un ordre different,
 * rendraient deux chaines differentes — donc deux empreintes, donc deux
 * encodages du meme resultat. L'inverse est pire : un champ ajoute plus tard
 * et oublie dans la serialisation rendrait la MEME empreinte pour deux
 * recettes differentes.
 *
 * `recetteCanonique` ecrit donc les champs UN A UN, dans un ordre fixe, avec
 * un nombre de decimales fixe. Le test qui compte n'est pas qu'elle soit
 * jolie : c'est qu'ajouter un champ a `RecetteAudio` sans l'ajouter ici casse
 * un test.
 *
 * ---------------------------------------------------------------------------
 * LA NORMALISATION, QUI EVITE DE PAYER DEUX FOIS LE MEME SON
 * ---------------------------------------------------------------------------
 *
 * Un volume de musique n'a aucun sens sans musique ; un volume de son original
 * n'en a aucun quand le son original est coupe. Sans normalisation, deux
 * recettes AUDITIVEMENT IDENTIQUES — « aucune musique, volume 30 % » et
 * « aucune musique, volume 70 % » — auraient deux empreintes, donc deux
 * encodages du meme fichier. `normaliser` ramene ces champs sans objet a leur
 * valeur par defaut AVANT l'empreinte.
 *
 * ⚠️ CE MODULE EST PUR, ET SANS AUCUN IMPORT. Ni MinIO, ni reseau, ni base,
 * ni meme `crypto` : il decrit et il valide, il ne resout rien. C'est ce qui
 * lui permet d'etre lu par l'ECRAN autant que par le moteur — l'empreinte,
 * elle, vit dans `rendu-contrat` cote serveur, parce qu'elle a besoin de
 * `crypto` et que le tirer dans le paquet navigateur pour un curseur de
 * volume serait absurde. La verification que la musique EXISTE et
 * APPARTIENT au compte vit dans `musique-source.ts`, cote serveur. Cette
 * separation est ce qui permet de tester tout le raisonnement d'identite sans
 * monter un stockage.
 */
// ---------------------------------------------------------------------------
// Le vocabulaire
// ---------------------------------------------------------------------------

/**
 * La version de la recette, ecrite DANS la forme canonique.
 *
 * Le jour ou un champ s'ajoute, ce numero change et toutes les empreintes
 * changent avec lui — ce qui est le comportement voulu : une recette lue sous
 * l'ancienne grammaire ne decrit plus le meme son.
 */
export const VERSION_RECETTE_AUDIO = 'audio-v1' as const;

/** Les bornes d'un volume. Une part, jamais un pourcentage ni des decibels. */
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 1;

/**
 * Le nombre de decimales d'un volume, dans la forme canonique ET dans le
 * graphe ffmpeg.
 *
 * Deux decimales, soit un pas de 1 %. Plus fin ne s'entend pas et ferait
 * dependre l'empreinte d'un bruit d'arrondi de curseur ; moins fin priverait
 * d'un reglage utile en bas d'echelle.
 */
export const DECIMALES_VOLUME = 2;

/** Le seul compartiment ou une musique est cherchee. */
export const BUCKET_MUSIQUE = 'audio' as const;

/**
 * La musique, designee comme le reste du socle : compartiment et cle.
 *
 * ⚠️ PAS UNE URL, ET C'EST LE POINT. `CHAMPS_INTERDITS_RENDU` bannit deja
 * `musicUrl` : une URL venue du client ferait sortir une requete arbitraire
 * du moteur. `GET /api/media/list` rend deja `bucket` et `path` pour chaque
 * fichier du compte — le couple est donc le contrat EXISTANT le plus propre,
 * et il n'y a pas d'identifiant de media stable a lui preferer : la
 * mediatheque liste des objets de stockage, elle n'a pas de table.
 */
export interface PisteMusicale {
  bucket: string;
  cle: string;
}

export interface RecetteAudio {
  /** `null` = aucune musique. */
  musique: PisteMusicale | null;
  /** Part appliquee a la musique, de 0 a 1. */
  volumeMusique: number;
  /** Garder le son des rushes ? */
  sonOriginal: boolean;
  /** Part appliquee au son des rushes, de 0 a 1. */
  volumeSonOriginal: number;
}

/**
 * La recette par defaut, qui EST le comportement historique.
 *
 * ⚠️ `sonOriginal: true` et `volumeSonOriginal: 1` ne sont pas un choix
 * esthetique : c'est exactement ce que le moteur faisait avant ce lot — le son
 * des rushes, sans attenuation. Les changer transformerait tous les rendus
 * existants en rendus differents.
 */
export const RECETTE_AUDIO_DEFAUT: RecetteAudio = Object.freeze({
  musique: null,
  volumeMusique: 0.5,
  sonOriginal: true,
  volumeSonOriginal: 1,
});

// ---------------------------------------------------------------------------
// Normalisation et forme canonique
// ---------------------------------------------------------------------------

/** Un volume arrondi au pas du contrat. `-0` ramene a `0`. */
export function arrondirVolume(v: number): number {
  const f = 10 ** DECIMALES_VOLUME;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Ramene les champs sans objet a leur valeur par defaut.
 *
 * Voir l'en-tete : sans cela, deux recettes auditivement identiques
 * produiraient deux encodages.
 */
export function normaliserRecette(r: RecetteAudio): RecetteAudio {
  const musique = r.musique === null ? null : { bucket: r.musique.bucket, cle: r.musique.cle };
  return {
    musique,
    volumeMusique: musique === null
      ? RECETTE_AUDIO_DEFAUT.volumeMusique
      : arrondirVolume(r.volumeMusique),
    sonOriginal: r.sonOriginal,
    volumeSonOriginal: r.sonOriginal
      ? arrondirVolume(r.volumeSonOriginal)
      : RECETTE_AUDIO_DEFAUT.volumeSonOriginal,
  };
}

/**
 * La forme canonique : champ par champ, dans un ordre fixe.
 *
 * ⚠️ NE JAMAIS REMPLACER PAR `JSON.stringify`. Voir l'en-tete.
 */
export function recetteCanonique(r: RecetteAudio): string {
  const n = normaliserRecette(r);
  const d = DECIMALES_VOLUME;
  return [
    `version=${VERSION_RECETTE_AUDIO}`,
    n.musique === null
      ? 'musique=aucune'
      : `musique=${n.musique.bucket}:${n.musique.cle}`,
    `volumeMusique=${n.volumeMusique.toFixed(d)}`,
    `sonOriginal=${n.sonOriginal ? 'oui' : 'non'}`,
    `volumeSonOriginal=${n.volumeSonOriginal.toFixed(d)}`,
  ].join('|');
}

/**
 * Cette recette decrit-elle exactement le comportement d'avant ce lot ?
 *
 * Aucune musique, le son des rushes garde, sans attenuation. Dans ce cas — et
 * dans ce cas seulement — le moteur emet le graphe historique et la methode
 * historique, si bien qu'un rendu deja reussi reste reutilisable.
 */
export function estRecetteHistorique(r: RecetteAudio | null | undefined): boolean {
  if (!r) return true;
  const n = normaliserRecette(r);
  return n.musique === null && n.sonOriginal && n.volumeSonOriginal === 1;
}

// ---------------------------------------------------------------------------
// La lecture d'un corps de requete — schema FERME
// ---------------------------------------------------------------------------

export const MOTIFS_RECETTE = [
  'corps_invalide',
  'champ_inconnu',
  'musique_invalide',
  'volume_invalide',
  'son_original_invalide',
] as const;
export type MotifRecette = (typeof MOTIFS_RECETTE)[number];

const CHAMPS_RECETTE = [
  'musique', 'volumeMusique', 'sonOriginal', 'volumeSonOriginal',
] as const;
const CHAMPS_MUSIQUE = ['bucket', 'cle'] as const;

export type LectureRecette =
  | { ok: true; recette: RecetteAudio }
  | { ok: false; motif: MotifRecette; message: string };

function objet(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? v as Record<string, unknown> : null;
}

/**
 * Un volume est-il recevable ?
 *
 * ⚠️ REFUS, ET NON BORNAGE. Borner silencieusement `1.5` a `1` accepterait une
 * demande que personne n'a formulee et la rendrait indiscernable d'un reglage
 * legitime a fond. Un curseur d'ecran ne produit jamais 1,5 : une valeur hors
 * bornes signale un appelant qui s'est trompe, et on le lui dit.
 */
/**
 * Une cle de musique est-elle recevable, sur sa seule forme ?
 *
 * ⚠️ LA MEME LISTE DE REFUS QUE `cleObjetValide`, RECOPIEE ICI A DESSEIN.
 *
 * Ce module est pur et sans import — c'est ce qui le rend lisible par l'ecran
 * autant que par le moteur. Importer `@/lib/storage/acces-objet` y tirerait la
 * chaine du stockage. La recopie est donc assumee, et gardee par un test qui
 * compare les deux comportements.
 *
 * ⚠️ ET CE N'EST PAS LA GARDE FINALE. `verifierMusique` reposera le prefixe de
 * propriete et interrogera le stockage ; `descendreSource` reposera les trois
 * gardes du socle avant de lire le moindre octet. Ce controle-ci ferme la
 * porte le plus tot possible — une URL glissee dans une cle doit etre refusee
 * par le CONTRAT, pas seulement rattrapee trois etages plus bas.
 */
function cleMusiqueValide(v: unknown): v is string {
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

function volume(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < VOLUME_MIN || v > VOLUME_MAX) return null;
  return arrondirVolume(v);
}

/**
 * Lit une recette depuis un corps de requete, sans rien deviner.
 *
 * ⚠️ SCHEMA FERME. Toute propriete inconnue est REFUSEE, a la racine comme
 * dans `musique`. Un schema permissif laisserait passer `musicUrl`,
 * `filtre`, `codec` ou `chemin` sans que personne le remarque — et le jour ou
 * un champ de ce nom deviendrait signifiant ailleurs, il serait deja accepte
 * ici. Refuser ce qu'on ne connait pas est le seul contrat qui ne derive pas.
 *
 * ⚠️ NE VERIFIE NI L'EXISTENCE NI LA PROPRIETE DE LA MUSIQUE. Ce module est
 * pur ; `musique-source.ts` s'en charge, cote serveur.
 */
export function lireRecetteAudio(brut: unknown): LectureRecette {
  const o = objet(brut);
  if (o === null) {
    return { ok: false, motif: 'corps_invalide', message: 'Reglage audio invalide.' };
  }

  for (const cle of Object.keys(o)) {
    if (!(CHAMPS_RECETTE as readonly string[]).includes(cle)) {
      return {
        ok: false, motif: 'champ_inconnu',
        message: `Le champ « ${cle} » n'existe pas dans les reglages audio.`,
      };
    }
  }

  // ── La musique ────────────────────────────────────────────────────────
  let musique: PisteMusicale | null = null;
  if (o.musique !== undefined && o.musique !== null) {
    const m = objet(o.musique);
    if (m === null) {
      return { ok: false, motif: 'musique_invalide', message: 'Musique invalide.' };
    }
    for (const cle of Object.keys(m)) {
      if (!(CHAMPS_MUSIQUE as readonly string[]).includes(cle)) {
        return {
          ok: false, motif: 'champ_inconnu',
          message: `Le champ « ${cle} » n'existe pas dans le choix de musique.`,
        };
      }
    }
    if (m.bucket !== BUCKET_MUSIQUE) {
      return {
        ok: false, motif: 'musique_invalide',
        message: 'Cette musique ne vient pas de ta mediatheque.',
      };
    }
    if (!cleMusiqueValide(m.cle)) {
      return { ok: false, motif: 'musique_invalide', message: 'Musique invalide.' };
    }
    musique = { bucket: BUCKET_MUSIQUE, cle: m.cle };
  }

  // ── Les volumes et l'interrupteur ─────────────────────────────────────
  const vMus = o.volumeMusique === undefined
    ? RECETTE_AUDIO_DEFAUT.volumeMusique : volume(o.volumeMusique);
  if (vMus === null) {
    return {
      ok: false, motif: 'volume_invalide',
      message: 'Le volume de la musique doit etre compris entre 0 et 1.',
    };
  }

  if (o.sonOriginal !== undefined && typeof o.sonOriginal !== 'boolean') {
    return {
      ok: false, motif: 'son_original_invalide',
      message: 'Le son original s\'active ou se desactive, rien d\'autre.',
    };
  }
  const sonOriginal = o.sonOriginal === undefined
    ? RECETTE_AUDIO_DEFAUT.sonOriginal : o.sonOriginal;

  const vOrig = o.volumeSonOriginal === undefined
    ? RECETTE_AUDIO_DEFAUT.volumeSonOriginal : volume(o.volumeSonOriginal);
  if (vOrig === null) {
    return {
      ok: false, motif: 'volume_invalide',
      message: 'Le volume du son original doit etre compris entre 0 et 1.',
    };
  }

  return {
    ok: true,
    recette: normaliserRecette({
      musique, volumeMusique: vMus, sonOriginal, volumeSonOriginal: vOrig,
    }),
  };
}

/**
 * La recette telle qu'elle est archivee dans `usage`.
 *
 * ⚠️ RIEN DE SENSIBLE, PAR CONSTRUCTION. Le compartiment et la cle sont des
 * coordonnees de stockage internes, jamais une URL, jamais une signature,
 * jamais un identifiant temporaire — et `usage` refuse d'ailleurs `://` par
 * contrainte de base. On y ajoute la forme canonique : c'est elle qui a produit
 * l'empreinte, et la relire est le seul moyen d'auditer un rendu sans
 * reconstruire le raisonnement. L'empreinte, elle, est deja dans
 * `methode_rendu` : la repeter ici la ferait diverger le jour ou l'une des
 * deux serait recalculee et pas l'autre.
 */
export function recettePourUsage(r: RecetteAudio): Record<string, unknown> {
  const n = normaliserRecette(r);
  return {
    version: VERSION_RECETTE_AUDIO,
    musique: n.musique === null ? null : { bucket: n.musique.bucket, cle: n.musique.cle },
    volumeMusique: n.volumeMusique,
    sonOriginal: n.sonOriginal,
    volumeSonOriginal: n.volumeSonOriginal,
    canonique: recetteCanonique(n),
  };
}
