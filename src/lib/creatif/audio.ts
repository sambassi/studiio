/**
 * A_5a — LA BANQUE AUDIO PERSONNELLE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE MIGRATION, ET C'EST UN CHOIX RAISONNÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une table `user_audio_tracks` serait plus propre au-delà de quelques
 * centaines de pistes. Elle a été écartée pour une raison précise : la
 * migration d'A_0c attend toujours d'être appliquée. Une seconde migration
 * non appliquée ferait d'A_5 du code mort en production, exactement comme
 * l'Autopilote automatique l'est aujourd'hui.
 *
 * Le catalogue vit donc dans `design_style.bibliothequeCreative.audio`, à
 * côté des favoris et des presets — du `jsonb` déjà en place, avec son
 * écrivain atomique et son cloisonnement par compte.
 *
 * ⚠️ ET IL EST BORNÉ. Deux cents pistes tiennent dans un document renvoyé à
 * chaque enregistrement ; au-delà, une table devient le bon outil, et ce sera
 * un lot à part. Le dire ici vaut mieux que de le découvrir en production.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LES FICHIERS NE SONT PAS DUPLIQUÉS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une piste ne PORTE pas un fichier : elle DÉSIGNE un objet déjà présent dans
 * la médiathèque du compte, par sa clé. Le téléversement reste celui qui
 * existe, la propriété reste celle du préfixe `<userId>/`, et supprimer une
 * piste du catalogue ne détruit rien tant que personne ne l'a demandé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE URL, JAMAIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `CHAMPS_INTERDITS_RENDU` bannit déjà `musicUrl`, et `PisteMusicale` désigne
 * un couple compartiment/clé. Ce catalogue ne réintroduit pas une URL par la
 * fenêtre : il ne stocke qu'une CLÉ, et c'est le serveur qui la résout.
 *
 * MODULE PUR.
 */
import type { EntreeCreative } from './catalogue-contrat';

export const VERSION_BANQUE_AUDIO = 'audio-banque-v1';

/**
 * Les ambiances. Simples, utiles, et choisies par la personne.
 *
 * ⚠️ AUCUNE IA NE LES DEVINE. Classer une musique automatiquement demanderait
 * un modèle, un coût et une explication ; laisser choisir demande une liste.
 */
export const MOODS_AUDIO = [
  'energique', 'positif', 'cinematique', 'emotionnel', 'calme',
  'sport', 'urbain', 'elegant', 'dramatique', 'inspiration',
] as const;
export type MoodAudio = (typeof MOODS_AUDIO)[number];

export const LIBELLES_MOOD: Record<MoodAudio, string> = {
  energique: 'Énergique',
  positif: 'Positif',
  cinematique: 'Cinématique',
  emotionnel: 'Émotionnel',
  calme: 'Calme',
  sport: 'Sport',
  urbain: 'Urbain',
  elegant: 'Élégant',
  dramatique: 'Dramatique',
  inspiration: 'Inspiration',
};

/** Au-delà, le document deviendrait lourd : une table serait le bon outil. */
export const PISTES_AUDIO_MAX = 200;
export const NOM_PISTE_MAX = 60;
export const MOODS_PAR_PISTE_MAX = 3;

/** Ce qu'une piste dure au plus. Une heure de musique n'a aucun usage ici. */
export const DUREE_AUDIO_MAX_MS = 15 * 60 * 1000;
export const DUREE_AUDIO_MIN_MS = 1_000;

/**
 * Les points de la forme d'onde.
 *
 * ⚠️ SOIXANTE-QUATRE, ET PAS UNE IMAGE. Un PNG par piste pèserait mille fois
 * plus pour la même information ; soixante-quatre valeurs suffisent à
 * reconnaître une montée, un refrain, une fin qui s'éteint.
 */
export const POINTS_FORME_ONDE = 64;

/**
 * Une piste de la banque.
 *
 * ⚠️ `cle` EST L'IDENTIFIANT. Elle vaut `<userId>/<usage>/<horodatage>-<nom>`,
 * elle est fabriquée par le serveur, et elle prouve la propriété par son
 * préfixe. Lui préférer un identifiant inventé obligerait à tenir une seconde
 * correspondance, qui dériverait le jour où un objet est supprimé.
 */
export interface PisteAudio {
  cle: string;
  /** Le nom AFFICHÉ. Renommer ici ne renomme aucun fichier. */
  nom: string;
  moods: readonly MoodAudio[];
  dureeMs: number;
  /** Ce que `silencedetect` a mesuré à l'import. `0` = aucun blanc. */
  silenceInitialMs: number;
  octets: number;
  /**
   * ⚠️ CE QUI IDENTIFIE LES OCTETS, PAS LE NOM. Deux fichiers différents sous
   * la même clé — un ré-téléversement — doivent produire deux rendus
   * différents. Sans cela, l'ancien montage ressortirait avec la nouvelle
   * musique dans son titre et l'ancienne dans son son.
   */
  empreinte: string;
  /** Quand la personne a déclaré disposer des droits. ISO 8601. */
  droitsConfirmesLe: string;
  /** La forme d'onde, 64 octets en base64. Absente si non calculée. */
  formeOnde?: string;
}

export interface BanqueAudio {
  pistes: readonly PisteAudio[];
}

export const BANQUE_AUDIO_VIDE: BanqueAudio = Object.freeze({
  pistes: Object.freeze([]) as readonly PisteAudio[],
});

/**
 * ⚠️ LA CLÉ EST VÉRIFIÉE ICI AUSSI, ET CE N'EST PAS REDONDANT.
 *
 * `verifierMusique` la contrôle au moment du rendu ; ce contrôle-ci empêche
 * qu'une clé d'autrui entre seulement dans le CATALOGUE — où elle serait
 * affichée, cherchée, mise en favori, et finirait par ressembler à une piste
 * légitime.
 */
export function cleAudioValide(cle: unknown, userId: string): cle is string {
  if (typeof cle !== 'string' || cle.length === 0 || cle.length > 400) return false;
  if (!userId || !cle.startsWith(`${userId}/`)) return false;
  return !cle.includes('..') && !cle.includes('\\') && !cle.includes('://');
}

export function nomPisteValide(brut: unknown): string | null {
  if (typeof brut !== 'string') return null;
  const propre = brut.replace(/[\r\n\t]+/g, ' ').trim().slice(0, NOM_PISTE_MAX);
  return propre.length > 0 ? propre : null;
}

export function moodsValides(brut: unknown): readonly MoodAudio[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const sortie: MoodAudio[] = [];
  for (const v of brut) {
    if (typeof v !== 'string' || vus.has(v)) continue;
    if (!(MOODS_AUDIO as readonly string[]).includes(v)) continue;
    vus.add(v);
    sortie.push(v as MoodAudio);
    if (sortie.length >= MOODS_PAR_PISTE_MAX) break;
  }
  return sortie;
}

const entier = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

/** Une piste relue — TOUT OU RIEN, comme les presets. */
export function pisteAudioValide(brut: unknown, userId: string): PisteAudio | null {
  if (!brut || typeof brut !== 'object') return null;
  const o = brut as Record<string, unknown>;
  if (!cleAudioValide(o.cle, userId)) return null;
  const nom = nomPisteValide(o.nom);
  const dureeMs = entier(o.dureeMs, DUREE_AUDIO_MIN_MS, DUREE_AUDIO_MAX_MS);
  const octets = entier(o.octets, 1, Number.MAX_SAFE_INTEGER);
  if (nom === null || dureeMs === null || octets === null) return null;
  if (typeof o.empreinte !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(o.empreinte)) {
    return null;
  }
  if (typeof o.droitsConfirmesLe !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T/.test(o.droitsConfirmesLe)) return null;

  const forme = typeof o.formeOnde === 'string'
    && /^[A-Za-z0-9+/=]{1,256}$/.test(o.formeOnde) ? o.formeOnde : undefined;

  return {
    cle: o.cle,
    nom,
    moods: moodsValides(o.moods),
    dureeMs,
    silenceInitialMs: entier(o.silenceInitialMs, 0, 60_000) ?? 0,
    octets,
    empreinte: o.empreinte,
    droitsConfirmesLe: o.droitsConfirmesLe,
    ...(forme ? { formeOnde: forme } : {}),
  };
}

export function banqueAudioValide(brut: unknown, userId: string): BanqueAudio {
  if (!brut || typeof brut !== 'object') return BANQUE_AUDIO_VIDE;
  const o = brut as Record<string, unknown>;
  if (!Array.isArray(o.pistes)) return BANQUE_AUDIO_VIDE;
  const vues = new Set<string>();
  const pistes: PisteAudio[] = [];
  for (const v of o.pistes) {
    const p = pisteAudioValide(v, userId);
    if (p === null || vues.has(p.cle)) continue;
    vues.add(p.cle);
    pistes.push(p);
    if (pistes.length >= PISTES_AUDIO_MAX) break;
  }
  return { pistes };
}

export function banqueAudioVide(b: BanqueAudio): boolean {
  return b.pistes.length === 0;
}

export function pisteParCle(b: BanqueAudio, cle: unknown): PisteAudio | null {
  if (typeof cle !== 'string') return null;
  return b.pistes.find((p) => p.cle === cle) ?? null;
}

/**
 * Les pistes qui correspondent à une recherche — titre, mood, ou libellé.
 *
 * ⚠️ LOCALE, SANS APPEL RÉSEAU. Deux cents pistes tiennent en mémoire ; une
 * requête par frappe coûterait plus cher que le filtre lui-même.
 */
export function chercherPistes(
  pistes: readonly PisteAudio[], requete: string,
): readonly PisteAudio[] {
  const mots = requete.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return pistes;
  return pistes.filter((p) => {
    const foin = [
      p.nom,
      ...p.moods,
      ...p.moods.map((m) => LIBELLES_MOOD[m]),
    ].join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return mots.every((m) => foin.includes(m));
  });
}

/** `2:34` — la durée telle qu'on la lit sur une carte. */
export function dureeLisible(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Les 64 valeurs de la forme d'onde, de 0 à 255. */
export function decoderFormeOnde(base64: string | undefined): number[] {
  if (!base64) return [];
  try {
    const bin = typeof atob === 'function'
      ? atob(base64)
      : Buffer.from(base64, 'base64').toString('binary');
    const out: number[] = [];
    for (let i = 0; i < bin.length && i < POINTS_FORME_ONDE; i += 1) {
      out.push(bin.charCodeAt(i) & 0xff);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * La clé de stockage derrière une URL de médiathèque, ou `null`.
 *
 * ⚠️ ÉCRITE UNE SEULE FOIS, ET C'EST LE POINT. Le sélecteur de médias rend
 * une URL publique parce qu'il a été écrit pour des `<img>` et des `<audio>` ;
 * la banque, elle, ne stocke qu'une CLÉ. Deux extractions de cette clé
 * divergeraient au premier caractère encodé, et l'une des deux enverrait au
 * serveur une clé qu'il refuserait sans qu'on comprenne pourquoi.
 *
 * Le serveur revérifie de toute façon que la clé est dans le périmètre du
 * compte : cette fonction met en forme, elle n'autorise rien.
 */
export function cleDepuisUrlMediatheque(url: string, bucket: string): string | null {
  const marque = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marque);
  if (i < 0) return null;
  const cle = decodeURIComponent(url.slice(i + marque.length).split('?')[0]);
  return cle.length > 0 ? cle : null;
}

/** Les ambiances qui portent au moins une piste — les rayons de la grille. */
export function moodsPresents(pistes: readonly PisteAudio[]): readonly MoodAudio[] {
  const vus = new Set<MoodAudio>();
  for (const p of pistes) for (const m of p.moods) vus.add(m);
  return MOODS_AUDIO.filter((m) => vus.has(m));
}

/** Une piste vue comme une entrée créative — pour la recherche unifiée. */
export function entreePiste(p: PisteAudio): EntreeCreative {
  return {
    id: p.cle,
    nom: p.nom,
    famille: 'audio',
    categorie: 'ambiance',
    tags: [...p.moods],
    description: `${dureeLisible(p.dureeMs)} · ${p.moods.map((m) => LIBELLES_MOOD[m]).join(', ') || 'sans ambiance'}`,
    rendu: true,
    version: VERSION_BANQUE_AUDIO,
  };
}
