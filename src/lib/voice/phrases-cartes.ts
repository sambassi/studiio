/**
 * Voix off des CARTES — une seule liste de phrases pour le texte dit ET
 * pour l'apparition des lignes.
 *
 * Aucun moteur vocal branché ne rend aujourd'hui d'horodatage par mot ou
 * par phrase : la voix des cartes est UN fichier dont on ne connaît que la
 * durée MESURÉE. On la découpe donc, phrase par phrase, au prorata du texte
 * réellement DIT (prononciations et normalisation comprises), puis on cale
 * l'apparition de chaque carte sur le début de sa phrase.
 *
 *   phrasesCartes()      carte → phrase (même ordre que la narration)
 *   texteCartes()        les phrases jointes : le texte envoyé au moteur
 *   segmentsPhrases()    durée mesurée → [début, fin] de chaque phrase
 *
 * Module PUR : mêmes entrées, même sortie. Le jour où un moteur fournit un
 * alignement réel, il remplace `segmentsPhrases`, rien d'autre.
 */

export interface CarteNarree {
  label?: string | null;
  description?: string | null;
  value?: string | null;
}

export interface PhraseCarte {
  /** Rang de la carte dans le post (celui que lisent les rendus). */
  index: number;
  texte: string;
}

/** Séparateur entre deux phrases de cartes dans le texte narré. */
export const SEPARATEUR_PHRASES = ' ';

/** Une phrase par carte non vide : « label. description. valeur ». */
export function phrasesCartes(cartes: readonly CarteNarree[]): PhraseCarte[] {
  const out: PhraseCarte[] = [];
  cartes.forEach((c, index) => {
    const texte = [c.label, c.description, c.value]
      .filter((s) => s && String(s).trim().length > 0)
      .join('. ');
    if (texte.length > 0) out.push({ index, texte });
  });
  return out;
}

/** Le texte narré des cartes — exactement les phrases, dans l'ordre. */
export function texteCartes(phrases: readonly PhraseCarte[]): string {
  return phrases.map((p) => p.texte).join(SEPARATEUR_PHRASES).trim();
}

/**
 * Les phrases réellement présentes dans `texte` (le texte narré, peut-être
 * tronqué à une longueur maximale) : une phrase coupée garde sa partie dite,
 * une phrase au-delà de la coupe disparaît (elle n'est pas prononcée).
 */
export function phrasesDansTexte(phrases: readonly PhraseCarte[], texte: string): PhraseCarte[] {
  const out: PhraseCarte[] = [];
  let curseur = 0;
  for (const p of phrases) {
    if (curseur >= texte.length) break;
    const morceau = texte.slice(curseur, curseur + p.texte.length).trim();
    if (morceau) out.push({ index: p.index, texte: morceau });
    curseur += p.texte.length + SEPARATEUR_PHRASES.length;
  }
  return out;
}

export interface SegmentPhrase {
  index: number;
  /** Secondes depuis le début du fichier audio des cartes. */
  debut: number;
  fin: number;
}

/** Ce qui se prononce : lettres et chiffres. Les espaces et la ponctuation n'ont pas de durée propre. */
const PRONONCABLE = /[\p{L}\p{N}]/gu;
/** Une fin de phrase ou une virgule : une courte pause du moteur. */
const PAUSE = /[.!?…;:,]/g;
/** Poids d'une pause, en « caractères » (≈ 0,2 s à débit normal). */
const POIDS_PAUSE = 3;

function poids(texteDit: string): number {
  const lettres = texteDit.match(PRONONCABLE)?.length ?? 0;
  const pauses = texteDit.match(PAUSE)?.length ?? 0;
  return lettres + pauses * POIDS_PAUSE;
}

/**
 * Découpe la durée MESURÉE de la voix des cartes en un segment par phrase,
 * au prorata du texte DIT de chacune (séparateur compté comme une pause).
 * Les segments sont contigus, couvrent exactement [0, dureeAudio], et
 * suivent l'ordre des phrases. Vide si la durée ou le texte manquent.
 */
export function segmentsPhrases(
  phrasesDites: ReadonlyArray<{ index: number; dit: string }>,
  dureeAudio: number,
): SegmentPhrase[] {
  if (!(dureeAudio > 0) || phrasesDites.length === 0) return [];
  const poidsPhrases = phrasesDites.map((p, i) => poids(p.dit) + (i < phrasesDites.length - 1 ? POIDS_PAUSE : 0));
  const total = poidsPhrases.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return [];
  const r = (n: number) => Math.round(n * 1000) / 1000;
  const out: SegmentPhrase[] = [];
  let cumul = 0;
  phrasesDites.forEach((p, i) => {
    const debut = (cumul / total) * dureeAudio;
    cumul += poidsPhrases[i];
    const fin = i === phrasesDites.length - 1 ? dureeAudio : (cumul / total) * dureeAudio;
    out.push({ index: p.index, debut: r(debut), fin: r(fin) });
  });
  return out;
}
