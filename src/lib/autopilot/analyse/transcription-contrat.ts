/**
 * M3-D2 — LE CONTRAT DE LA TRANSCRIPTION.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER GARANTIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tout ce qui vient du fournisseur passe par ici avant d'exister. Rien de ce
 * qu'il rend n'est cru : ni les instants, ni l'ordre, ni les longueurs, ni la
 * langue. Un modèle de transcription est un outil statistique — il rend
 * couramment un `end` avant son `start` sur un silence, ou un dernier segment
 * qui dépasse la fin du fichier de quelques centièmes.
 *
 *   • Des NOMBRES FINIS, à trois décimales, et des chaînes bornées.
 *   • `0 ≤ debut < fin ≤ dureeSecondes` du rush, toujours.
 *   • Segments et mots TRIÉS, listes PLAFONNÉES avant insertion.
 *   • L'objet écrit est RECONSTRUIT champ par champ : une URL, un en-tête ou
 *     un fragment de réponse brute n'a aucun chemin vers la base.
 *
 * ⚠️ AUCUN DÉBIT. `usage` est une MESURE. Ce module n'importe pas
 * `@/lib/credits`, et un test le vérifie.
 */

// ─────────────────────────────────────────────────────────────────────────
// Les bornes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Le texte complet, en caractères.
 *
 * Cinquante minutes de parole continue à 150 mots/minute font ~7 500 mots,
 * soit ~45 000 caractères. Soixante mille laissent la marge d'une langue plus
 * verbeuse sans jamais laisser une réponse aberrante entrer en base.
 */
export const TEXTE_MAX = 60_000;

/** Un segment est une phrase, pas un chapitre. */
export const SEGMENT_TEXTE_MAX = 1_000;
export const SEGMENTS_MAX = 1_000;

/** Un mot est un mot. Cent caractères couvrent l'allemand composé. */
export const MOT_TEXTE_MAX = 100;
export const MOTS_MAX = 20_000;

/**
 * La langue, telle que Whisper la rend.
 *
 * ⚠️ PAS un code ISO : le format `verbose_json` rend le NOM de la langue en
 * anglais et en minuscules — `"french"`, `"english"`. Un `enum` fermé serait
 * donc faux dès la première langue oubliée, et refuserait une transcription
 * parfaitement valide. On borne la FORME — minuscules, lettres et tirets — et
 * la longueur, ce qui suffit à empêcher qu'un champ libre transporte autre
 * chose qu'un nom de langue.
 */
export const LANGUE_MAX = 40;
const LANGUE_FORME = /^[a-z][a-z -]{0,39}$/;

/**
 * La réponse du fournisseur, en octets, lue AVANT toute analyse.
 *
 * Les mots horodatés d'une longue transcription pèsent quelques mégaoctets.
 * Huit mégaoctets couvrent le pire cas admissible et protègent le tas d'une
 * réponse aberrante — la borne est vérifiée avant `JSON.parse`, pas après.
 */
export const REPONSE_MAX_OCTETS = 8 * 1024 * 1024;

/**
 * La taille maximale du FLAC envoyé au fournisseur, en octets.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI CETTE BORNE REMPLACE UN DÉCOUPEUR EN V1
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La documentation Groq annonce « 25 MB (free tier), 100MB (dev tier) ». On
 * retient la borne BASSE : elle vaut quel que soit le palier du compte, donc
 * elle ne devient jamais fausse dans le dos de l'exploitant.
 *
 * En FLAC 16 kHz mono, la parole pèse ~8 ko/s : vingt-quatre mébioctets
 * couvrent donc de l'ordre de cinquante minutes. Nos rushes durent des
 * dizaines de secondes. Écrire un découpeur en chevauchement — avec le
 * recollage des instants globaux et la déduplication des mots qu'il impose —
 * serait construire l'usine avant d'avoir la commande.
 *
 * ⚠️ ELLE PORTE SUR LES OCTETS PRODUITS, PAS SUR LA DURÉE. La compression
 * FLAC dépend du contenu : de la musique dense compresse bien moins que de la
 * parole. Borner la durée laisserait passer un fichier trop lourd, et
 * refuserait un fichier parfaitement acceptable.
 *
 * Au-delà : refus nommé `audio_trop_long`, AUCUN appel, AUCUN coût. Jamais de
 * troncature silencieuse — un texte amputé sans le dire est pire que pas de
 * texte.
 */
export const FLAC_OCTETS_MAX = 24 * 1024 * 1024;

/** Le nombre de décimales des instants. La même que `rush_analyses.duree_secondes`. */
export const DECIMALES = 3;

export const MOTIF_ECHEC_MAX = 200;

/**
 * Au bout de combien de temps une transcription active est réputée abandonnée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CALCULÉE, JAMAIS CHOISIE — ET LE PIÈGE QU'ELLE FERME
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rush_transcriptions_active_unique` interdit deux transcriptions actives
 * par rush : c'est ce qui empêche de payer deux fois. Mais un processus tué
 * au mauvais moment laisse sa ligne `en_cours` POUR TOUJOURS, et le rush
 * devient alors définitivement impossible à transcrire. Le piège s'est
 * présenté sur `rush_analyses`, puis sur `rush_candidate_sets`.
 *
 * Le pire cas de la route est `BUDGET_TRANSCRIPTION_MS` : la signature MinIO
 * (10 s), l'extraction FLAC qui traverse le rush entier (120 s), et l'appel
 * au fournisseur (180 s) — soit 310 s. Le seuil doit être franchement AU-DESSUS,
 * sans quoi on fermerait une transcription qui travaille encore et on
 * paierait un second appel pendant le premier.
 *
 * Dix minutes : le pire cas, presque doublé. En dessous du seuil, une
 * transcription active est PROTÉGÉE.
 */
export const PEREMPTION_TRANSCRIPTION_MS = 10 * 60 * 1000;

/** Le seuil, en ISO — ce que la requête de récupération compare à `created_at`. */
export function seuilPeremptionTranscription(maintenant: number = Date.now()): string {
  return new Date(maintenant - PEREMPTION_TRANSCRIPTION_MS).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────
// Le vocabulaire
// ─────────────────────────────────────────────────────────────────────────

/**
 * Les motifs d'échec. Fermé, comme `MOTIFS_EXTRACTION` et `MOTIFS_CANDIDATS`.
 *
 * Un motif libre finirait par contenir la réponse du fournisseur — donc une
 * URL, un identifiant de requête, voire un fragment de clé — et personne ne
 * pourrait plus compter les échecs par cause.
 */
export const MOTIFS_TRANSCRIPTION = [
  'rush_introuvable',            // le rush n'existe pas, ou n'est pas le sien
  'rush_non_verifie',            // aucun octet n'a été constaté dans le stockage
  'duree_inconnue',              // rien ne borne les instants : on ne mesure pas
  'cle_hors_perimetre',          // clé hors du préfixe utilisateur
  'stockage_injoignable',        // MinIO muet ou mal configuré
  'outil_absent',                // ffmpeg introuvable
  'audio_illisible',             // la piste ne se décode pas — ou n'existe pas
  'audio_trop_long',             // le FLAC dépasse la borne du fournisseur
  'fournisseur_absent',          // drapeau ouvert, ou configuration incomplète
  'fournisseur_en_erreur',       // il a levé, ou le délai a été dépassé
  'reponse_illisible',           // pas du JSON, ou plus longue que la borne
  'resultat_transcription_invalide', // JSON, mais hors contrat
  'timeout',                     // le processus local a été tué au délai
  'capacite_saturee',            // une autre transcription occupe le serveur
  'transcription_interrompue',   // fermée par péremption
] as const;
export type MotifTranscription = (typeof MOTIFS_TRANSCRIPTION)[number];

export function motifTranscriptionValide(v: unknown): v is MotifTranscription {
  return typeof v === 'string' && (MOTIFS_TRANSCRIPTION as readonly string[]).includes(v);
}

/**
 * L'issue du nettoyage du fichier temporaire. Vocabulaire fermé.
 *
 * ⚠️ POURQUOI CE N'EST PAS UN `MotifTranscription`.
 *
 * `motif_echec` répond à « pourquoi la transcription a-t-elle échoué ». Or un
 * nettoyage raté n'est PAS un échec de la transcription : le fournisseur a pu
 * répondre, le texte est là, il est valide, et il a été payé. L'écrire dans
 * `motif_echec` ferait passer un résultat exploitable pour un échec — et,
 * pire, inviterait à relancer, donc à repayer.
 *
 * Ce fait vit donc dans `usage`, qui décrit ce qu'une exécution a consommé et
 * comment elle s'est passée, jamais dans le vocabulaire des échecs.
 */
export const NETTOYAGES = ['ok', 'echoue'] as const;
export type Nettoyage = (typeof NETTOYAGES)[number];

/**
 * L'étiquette du nettoyage raté — pour le journal, et pour l'API.
 *
 * Un littéral À NOUS, donc incapable de transporter un chemin temporaire, un
 * message d'erreur système ou un nom de répertoire du serveur.
 */
export const MOTIF_NETTOYAGE_ECHOUE = 'nettoyage_temporaire_echoue';

/** La clé sous laquelle `usage` porte cette information. */
export const CLE_USAGE_NETTOYAGE = 'nettoyageTemporaire';

/**
 * Le fournisseur, tel qu'il s'écrit en base.
 *
 * ⚠️ `modele` reste `null` ici : il est renseigné à la CLÔTURE, avec le
 * modèle réellement employé, et cette valeur vient d'une constante de
 * l'adaptateur — jamais d'un champ de la réponse. Un modèle qui se nommerait
 * lui-même choisirait ce qu'on écrit à son sujet.
 */
export const FOURNISSEUR_TRANSCRIPTION = {
  fournisseur: 'groq' as const,
  modele: null as string | null,
};

// ─────────────────────────────────────────────────────────────────────────
// La forme
// ─────────────────────────────────────────────────────────────────────────

export interface IntervalleTexte {
  debutSecondes: number;
  finSecondes: number;
  texte: string;
}

export interface Transcription {
  presente: boolean;
  langue: string | null;
  texte: string;
  segments: IntervalleTexte[];
  mots: IntervalleTexte[];
}

// ─────────────────────────────────────────────────────────────────────────
// Les outils — 100 % locaux, déterministes, testables sans réseau
// ─────────────────────────────────────────────────────────────────────────

/** Un nombre utilisable, ou `null`. `NaN` et `±Infinity` valent `null`. */
export function nombreFini(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Trois décimales, et pas un chiffre de plus. `-0` ramené à `0`. */
export function arrondirSeconde(n: number): number {
  const f = 10 ** DECIMALES;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Une langue acceptable, ou `null`. Jamais une valeur inventée. */
export function langueValide(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = v.trim().toLowerCase();
  if (!n || n.length > LANGUE_MAX) return null;
  return LANGUE_FORME.test(n) ? n : null;
}

/**
 * Met une liste d'intervalles horodatés en état d'être écrite.
 *
 * Dans l'ordre, et l'ordre compte : on jette ce qui n'est pas un nombre, on
 * ramène dans les bornes du rush, on jette ce qui est vide ou inversé, on
 * borne le texte, on TRIE, puis seulement on plafonne.
 *
 * Plafonner avant de trier rendrait « les mille premiers » vide de sens ; et
 * le fournisseur ne garantit pas l'ordre, il l'observe simplement en pratique.
 *
 * ⚠️ CONTRAIREMENT AUX SILENCES DE M3-D1, LES CHEVAUCHEMENTS NE SONT PAS
 * FUSIONNÉS. Deux silences qui se recouvrent décrivent un seul silence ;
 * deux mots qui se recouvrent restent deux mots. Fusionner y perdrait du
 * texte — le seul contenu qu'on soit venu chercher.
 */
export function normaliserIntervalles(
  brut: unknown, dureeSecondes: number | null, plafond: number, texteMax: number,
): IntervalleTexte[] {
  if (!Array.isArray(brut)) return [];
  const duree = nombreFini(dureeSecondes);
  const propres: IntervalleTexte[] = [];

  // Une borne dure PENDANT le balayage : une réponse aberrante ne doit pas
  // faire grossir le tas avant d'être plafonnée. Le facteur laisse de la
  // marge à ce que le tri devra départager.
  const examen = Math.min(brut.length, plafond * 4);

  for (let i = 0; i < examen; i += 1) {
    const item = brut[i];
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;

    const d0 = nombreFini(o.debutSecondes ?? o.start);
    const f0 = nombreFini(o.finSecondes ?? o.end);
    if (d0 === null || f0 === null) continue;

    const brutTexte = o.texte ?? o.word ?? o.text;
    if (typeof brutTexte !== 'string') continue;
    const texte = brutTexte.trim().slice(0, texteMax);
    if (!texte) continue;

    // Les bornes du rush. Un `end` que le modèle place à 38.20 sur un rush de
    // 38.165 n'est pas une erreur de transcription, c'est un arrondi de fin
    // de flux : on le ramène, on ne jette pas le mot.
    let debut = Math.max(0, d0);
    let fin = f0;
    if (duree !== null && duree >= 0) {
      debut = Math.min(debut, duree);
      fin = Math.min(Math.max(0, fin), duree);
    }
    debut = arrondirSeconde(debut);
    fin = arrondirSeconde(fin);
    if (!(debut < fin)) continue;

    propres.push({ debutSecondes: debut, finSecondes: fin, texte });
  }

  propres.sort((a, b) => (a.debutSecondes - b.debutSecondes)
    || (a.finSecondes - b.finSecondes));

  return propres.slice(0, plafond);
}

/** Un intervalle relu depuis la base est-il encore conforme ? */
export function intervalleValide(v: unknown): v is IntervalleTexte {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const d = nombreFini(o.debutSecondes);
  const f = nombreFini(o.finSecondes);
  if (d === null || f === null || d < 0 || !(d < f)) return false;
  return typeof o.texte === 'string' && o.texte.length > 0;
}

/**
 * L'objet EXACT qui part en base — reconstruit, jamais recopié.
 *
 * C'est la garantie structurelle du lot : quoi qu'on lui passe, cette
 * fonction ne rend que des chaînes bornées, des booléens et des nombres
 * finis. Un en-tête HTTP, une URL signée ou un fragment de réponse brute
 * n'ont aucun chemin pour arriver dans sa sortie.
 */
export function transcriptionPourBase(
  t: Transcription, dureeSecondes: number | null,
): {
  presente: boolean; langue: string | null; texte: string;
  segments: IntervalleTexte[]; mots: IntervalleTexte[];
} {
  const segments = normaliserIntervalles(t.segments, dureeSecondes, SEGMENTS_MAX, SEGMENT_TEXTE_MAX);
  const mots = normaliserIntervalles(t.mots, dureeSecondes, MOTS_MAX, MOT_TEXTE_MAX);
  const texte = typeof t.texte === 'string' ? t.texte.trim().slice(0, TEXTE_MAX) : '';

  return {
    // ⚠️ `presente` est DÉDUIT, jamais recopié : un fournisseur qui rendrait
    // `presente: true` avec zéro segment et zéro texte ferait croire à une
    // parole que personne n'a entendue.
    presente: Boolean(t.presente) && (texte.length > 0 || segments.length > 0),
    langue: langueValide(t.langue),
    texte,
    segments,
    mots,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// La lecture de la réponse du fournisseur
// ─────────────────────────────────────────────────────────────────────────

export type ResultatTranscription =
  | { ok: true; transcription: Transcription }
  | { ok: false; motif: MotifTranscription; detail?: string };

/**
 * Lit le `verbose_json` d'un transcripteur compatible OpenAI.
 *
 * ⚠️ LA BORNE D'OCTETS EST LUE AVANT `JSON.parse`. Analyser d'abord pour
 * mesurer ensuite, c'est laisser une réponse de cent mégaoctets construire
 * son arbre en mémoire avant qu'on la refuse.
 *
 * ⚠️ RIEN N'EST DEVINÉ. Pas de « cherchons la première accolade », pas de
 * « prenons le champ qui ressemble à du texte ». La forme attendue est celle
 * que la documentation décrit ; toute autre est `resultat_transcription_invalide`,
 * et c'est un refus, pas un rattrapage.
 */
export function lireReponseTranscription(
  brut: string, dureeSecondes: number | null,
): ResultatTranscription {
  const refus = (
    motif: MotifTranscription, detail?: string,
  ): ResultatTranscription => ({ ok: false, motif, detail });

  if (typeof brut !== 'string' || !brut.trim()) return refus('reponse_illisible', 'vide');
  // `Buffer.byteLength` et non `.length` : ce qui compte est ce qui a
  // transité, et un caractère accentué pèse deux octets.
  if (Buffer.byteLength(brut, 'utf8') > REPONSE_MAX_OCTETS) {
    return refus('reponse_illisible', 'borne d’octets dépassée');
  }

  let objet: unknown;
  try { objet = JSON.parse(brut); } catch { return refus('reponse_illisible', 'JSON invalide'); }
  if (typeof objet !== 'object' || objet === null || Array.isArray(objet)) {
    return refus('resultat_transcription_invalide', 'racine');
  }

  const o = objet as Record<string, unknown>;
  if (typeof o.text !== 'string') return refus('resultat_transcription_invalide', 'text');

  const texte = o.text.trim().slice(0, TEXTE_MAX);
  const segments = normaliserIntervalles(o.segments, dureeSecondes, SEGMENTS_MAX, SEGMENT_TEXTE_MAX);
  const mots = normaliserIntervalles(o.words, dureeSecondes, MOTS_MAX, MOT_TEXTE_MAX);

  return {
    ok: true,
    transcription: {
      // Une piste muette rend un `text` vide et aucun segment : ce n'est pas
      // un échec, c'est un rush sans parole. `transcriptionPourBase` le
      // confirmera en déduisant `presente`.
      presente: texte.length > 0 || segments.length > 0,
      langue: langueValide(o.language),
      texte,
      segments,
      mots,
    },
  };
}

/** Le résultat d'un rush dont M3-D1 a établi qu'il ne porte aucune piste. */
export function transcriptionSansAudio(): Transcription {
  return { presente: false, langue: null, texte: '', segments: [], mots: [] };
}
