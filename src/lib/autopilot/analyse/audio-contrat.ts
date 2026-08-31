/**
 * M3-D1 — LE CONTRAT DE LA MESURE AUDIO LOCALE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER GARANTIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tout ce qui finit dans `rush_analyses.audio` passe par ici, et rien d'autre
 * ne s'y écrit. La colonne est rendue au navigateur par `analysePublique` :
 * ce qui entre ici doit donc être aussi montrable qu'un nombre.
 *
 *   • Des NOMBRES FINIS, des booléens, et un vocabulaire FERMÉ. Jamais une
 *     URL, jamais une clé de stockage, jamais une ligne de ffmpeg, jamais un
 *     morceau de `stderr` — l'objet est RECONSTRUIT champ par champ par
 *     `audioPourBase`, il n'est jamais recopié depuis une source brute.
 *   • Des bornes : cent silences au plus, triés, disjoints, tous dans
 *     `[0, dureeSecondes]`.
 *   • `NaN` et `Infinity` n'existent pas en JSON : ils deviennent `null`, et
 *     `null` se lit « pas mesuré », ce qui est vrai.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI `present` EST UN BOOLÉEN **NULLABLE**, ET POURQUOI IL LE RESTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Trois situations que rien n'autorise à confondre :
 *
 *   A. le fichier NE PORTE PAS de piste audio      → `present: false`
 *   B. il en porte une, mais la mesure a échoué    → `present: true`
 *   C. on ne sait pas s'il en porte une            → `present: null`
 *
 * Écrire `false` dans le cas B serait un MENSONGE : un rush parlé passerait
 * pour muet, et le lot qui suivra (M3-D2) sauterait sa transcription sans
 * que personne ne sache pourquoi. `etatMesure` porte donc la nuance, et
 * `present` ne dit que ce qui est établi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE CONTRAT N'AJOUTE NI ÉTAPE, NI FOURNISSEUR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rush_analyses.etape` est borné EN BASE à `extraction | visuel |
 * transcription`, et `fournisseurs` n'accepte que ces mêmes clés
 * (`fournisseursValides`). Y ajouter « audio » demanderait une migration, que
 * ce lot n'a pas. La provenance de la mesure vit donc DANS l'objet, sous
 * `mesure.outil` — au même endroit que les réglages qui l'ont produite, ce
 * qui est de toute façon là qu'on la cherche.
 */

// ─────────────────────────────────────────────────────────────────────────
// Les réglages de la mesure
// ─────────────────────────────────────────────────────────────────────────

/**
 * Le seuil sous lequel ffmpeg considère qu'il n'y a plus de son, en dBFS.
 *
 * −35 dB, et non −50 : un tournage réel porte un souffle de préampli, une
 * climatisation, une rue. À −50 dB, presque aucun « silence » ne serait
 * jamais détecté sur du matériel de terrain, et la mesure ne servirait à
 * rien. À −20 dB, une voix douce serait découpée en morceaux.
 */
export const SEUIL_SILENCE_DB = -35;

/**
 * La durée minimale d'un silence pour qu'il compte, en secondes.
 *
 * 0,4 s : c'est l'ordre de grandeur d'une respiration entre deux phrases.
 * Plus court, on remonterait les micro-pauses INTERNES à une phrase — celles
 * où une coupe est justement interdite.
 */
export const SILENCE_MIN_SECONDES = 0.4;

/** L'outil qui produit la mesure. Fermé, et local — aucun fournisseur externe. */
export const OUTIL_AUDIO = 'ffmpeg' as const;

/** Le plafond dur de silences consignés. Cent racontent un rush ; mille non. */
export const SILENCES_MAX = 100;

/** Le nombre de décimales des instants. La même que `rush_analyses.duree_secondes`. */
export const DECIMALES_AUDIO = 3;

// ─────────────────────────────────────────────────────────────────────────
// Le vocabulaire
// ─────────────────────────────────────────────────────────────────────────

/**
 * L'état de la mesure — et NON l'état de l'audio.
 *
 * `mesuree`      — la passe s'est faite, ce qui suit est mesuré.
 * `absente`      — le fichier ne porte aucune piste audio. Rien à mesurer,
 *                  et ce n'est pas un échec.
 * `indisponible` — la mesure n'a pas pu se faire. `motif` dit pourquoi, et
 *                  `present` ne bascule PAS à `false` pour autant.
 */
export const ETATS_MESURE_AUDIO = ['mesuree', 'absente', 'indisponible'] as const;
export type EtatMesureAudio = (typeof ETATS_MESURE_AUDIO)[number];

/**
 * Les motifs d'indisponibilité. Fermé, comme `MOTIFS_EXTRACTION`.
 *
 * Un motif libre finirait par contenir la sortie de ffmpeg — donc l'URL
 * signée — et personne ne pourrait plus compter les échecs par cause.
 */
export const MOTIFS_AUDIO = [
  'cle_hors_perimetre',
  'stockage_injoignable',
  'outil_absent',
  'audio_illisible',
  'timeout',
  'capacite_saturee',
] as const;
export type MotifAudio = (typeof MOTIFS_AUDIO)[number];

export function etatMesureAudioValide(v: unknown): v is EtatMesureAudio {
  return typeof v === 'string' && (ETATS_MESURE_AUDIO as readonly string[]).includes(v);
}

export function motifAudioValide(v: unknown): v is MotifAudio {
  return typeof v === 'string' && (MOTIFS_AUDIO as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────────────────
// La forme
// ─────────────────────────────────────────────────────────────────────────

export interface SilenceAudio {
  debutSecondes: number;
  finSecondes: number;
}

/**
 * Le niveau sonore, tel que `volumedetect` le rend.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI `volumedetect` ET NON `ebur128` — UNE CONTRAINTE MESURÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `ebur128` donnerait la loudness normalisée EBU R128 (LUFS), qui est la
 * bonne unité perceptive. Mais il JOURNALISE UNE LIGNE TOUTES LES 100 ms, et
 * ce comportement n'a aucune option pour être désactivé : un rush de trente
 * minutes produirait dix-huit mille lignes, soit plus de deux méga-octets sur
 * `stderr` — que le processus doit tamponner, et au milieu desquelles les
 * lignes de `silencedetect` qu'on vient CHERCHER se perdraient.
 *
 * `volumedetect` n'écrit qu'à la fin du flux, quatre lignes, quelle que soit
 * la durée. Ses deux nombres — moyenne quadratique et crête d'échantillon, en
 * dBFS — suffisent à ce que M3-D1 doit répondre : « y a-t-il du signal, et à
 * quel niveau ». La loudness perceptive n'a d'intérêt qu'au mixage, qui n'est
 * pas ce lot.
 */
export interface NiveauAudio {
  /** Moyenne quadratique du signal, en dBFS. `null` = non mesurée. */
  moyenneDb: number | null;
  /** Crête d'échantillon, en dBFS. `null` = non mesurée. */
  creteDb: number | null;
}

export interface MesureAudio {
  /** `true`/`false` seulement quand c'est ÉTABLI. Voir l'en-tête du fichier. */
  present: boolean | null;
  etatMesure: EtatMesureAudio;
  /** Renseigné si et seulement si `etatMesure === 'indisponible'`. */
  motif: MotifAudio | null;
  /** La durée sur laquelle la mesure porte. Celle de l'analyse, pas une autre. */
  dureeSecondes: number | null;
  silences: SilenceAudio[];
  niveau: NiveauAudio;
  mesure: { outil: typeof OUTIL_AUDIO; seuilDb: number; silenceMinSecondes: number };
}

// ─────────────────────────────────────────────────────────────────────────
// Les outils de normalisation — 100 % locaux, déterministes, testables
// ─────────────────────────────────────────────────────────────────────────

/** Un nombre utilisable, ou `null`. `NaN` et `±Infinity` valent `null`. */
export function nombreFini(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Trois décimales, et pas un chiffre de plus. `-0` ramené à `0`. */
export function arrondirSeconde(n: number): number {
  const f = 10 ** DECIMALES_AUDIO;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Met une liste de silences bruts en état d'être écrite.
 *
 * Dans l'ordre, et l'ordre compte : on jette ce qui n'est pas un nombre, on
 * ramène dans les bornes du rush, on jette ce qui est vide ou inversé, on
 * trie, on FUSIONNE les chevauchements — deux détections qui se recouvrent
 * décrivent un seul silence, les garder toutes deux compterait deux fois le
 * même —, puis seulement on plafonne.
 *
 * Plafonner AVANT de fusionner rendrait le résultat dépendant de l'ordre
 * d'arrivée ; plafonner avant de trier rendrait « les cent premiers » vide de
 * sens.
 */
export function normaliserSilences(
  brut: readonly unknown[], dureeSecondes: number | null,
): SilenceAudio[] {
  const duree = nombreFini(dureeSecondes);
  const propres: SilenceAudio[] = [];

  for (const item of brut) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const d0 = nombreFini(o.debutSecondes);
    const f0 = nombreFini(o.finSecondes);
    if (d0 === null || f0 === null) continue;

    // Les bornes du rush. Un `silence_end` que ffmpeg place à 38.166 sur un
    // rush de 38.165 n'est pas une erreur de mesure, c'est un arrondi de fin
    // de flux : on le ramène, on ne le jette pas.
    let debut = Math.max(0, d0);
    let fin = f0;
    if (duree !== null && duree >= 0) {
      debut = Math.min(debut, duree);
      fin = Math.min(Math.max(0, fin), duree);
    }
    debut = arrondirSeconde(debut);
    fin = arrondirSeconde(fin);
    if (!(debut < fin)) continue;

    propres.push({ debutSecondes: debut, finSecondes: fin });
  }

  propres.sort((a, b) => (a.debutSecondes - b.debutSecondes)
    || (a.finSecondes - b.finSecondes));

  const fusionnes: SilenceAudio[] = [];
  for (const s of propres) {
    const precedent = fusionnes[fusionnes.length - 1];
    if (precedent && s.debutSecondes <= precedent.finSecondes) {
      precedent.finSecondes = Math.max(precedent.finSecondes, s.finSecondes);
      continue;
    }
    fusionnes.push({ ...s });
  }

  return fusionnes.slice(0, SILENCES_MAX);
}

/**
 * L'objet EXACT qui part en base — reconstruit, jamais recopié.
 *
 * C'est la garantie structurelle du lot : quoi qu'on lui passe, cette
 * fonction ne rend que des nombres finis, des booléens, `null`, et deux mots
 * pris dans des listes fermées. Une URL, une clé de compartiment ou un
 * fragment de `stderr` n'ont aucun chemin pour arriver dans sa sortie.
 */
export function audioPourBase(m: MesureAudio): Record<string, unknown> {
  const etat: EtatMesureAudio = etatMesureAudioValide(m.etatMesure) ? m.etatMesure : 'indisponible';
  // Le motif n'a de sens QUE pour `indisponible` : le laisser traîner sur une
  // mesure réussie ferait lire un échec là où il n'y en a pas.
  const motif = etat === 'indisponible' && motifAudioValide(m.motif) ? m.motif : null;
  const duree = m.dureeSecondes === null ? null : nombreFini(m.dureeSecondes);

  return {
    present: typeof m.present === 'boolean' ? m.present : null,
    etatMesure: etat,
    motif,
    dureeSecondes: duree === null ? null : arrondirSeconde(Math.max(0, duree)),
    silences: normaliserSilences(Array.isArray(m.silences) ? m.silences : [], duree)
      .map((s) => ({ debutSecondes: s.debutSecondes, finSecondes: s.finSecondes })),
    niveau: {
      moyenneDb: nombreFini(m.niveau?.moyenneDb),
      creteDb: nombreFini(m.niveau?.creteDb),
    },
    mesure: {
      outil: OUTIL_AUDIO,
      seuilDb: SEUIL_SILENCE_DB,
      silenceMinSecondes: SILENCE_MIN_SECONDES,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Les constructeurs des trois issues
// ─────────────────────────────────────────────────────────────────────────

const NIVEAU_VIDE: NiveauAudio = { moyenneDb: null, creteDb: null };
const REGLAGES = {
  outil: OUTIL_AUDIO, seuilDb: SEUIL_SILENCE_DB, silenceMinSecondes: SILENCE_MIN_SECONDES,
} as const;

/** Le fichier ne porte aucune piste audio. Ce n'est PAS un échec. */
export function audioAbsent(dureeSecondes: number | null): MesureAudio {
  return {
    present: false, etatMesure: 'absente', motif: null,
    dureeSecondes, silences: [], niveau: NIVEAU_VIDE, mesure: REGLAGES,
  };
}

/**
 * La mesure n'a pas pu se faire.
 *
 * ⚠️ `present` reçoit ce qu'on SAIT de la piste, et rien de plus : `true` si
 * le sondage en a vu une, `null` si personne n'a pu le dire. Jamais `false` —
 * c'est exactement le mensonge que ce lot interdit.
 */
export function audioIndisponible(
  motif: MotifAudio, dureeSecondes: number | null, pisteConnue: boolean | null,
): MesureAudio {
  return {
    present: pisteConnue === true ? true : null,
    etatMesure: 'indisponible',
    motif,
    dureeSecondes, silences: [], niveau: NIVEAU_VIDE, mesure: REGLAGES,
  };
}
