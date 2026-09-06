/**
 * L'ÉTAPE `signaux` — LE CONTRAT DE L'ENRICHISSEMENT SÉMANTIQUE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE MODULE EST PUR, ET DOIT LE RESTER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il n'importe que `signaux-contrat`, lui-même sans import. Même raison que
 * `candidat-contrat` : l'écran d'analyse le lira peut-être un jour, et la
 * moindre arête vers `visuel.ts` tirerait MinIO dans le paquet navigateur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA SEULE CHOSE QUE CE LECTEUR PROTÈGE VRAIMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'enrichissement travaille sur des candidats DÉJÀ FIGÉS. Le seul dégât
 * qu'un fournisseur pourrait causer serait de faire glisser un relevé d'un
 * moment vers un autre : les signaux de la foule attribués au gros plan.
 * Personne ne s'en apercevrait — les deux relevés sont plausibles, aucun
 * champ n'est aberrant, et le plan ne change pas.
 *
 * D'où l'appariement STRICT, et non « au mieux » :
 *
 *   • autant de relevés que de moments envoyés, ni plus ni moins ;
 *   • chaque `indice` dans la plage envoyée ;
 *   • aucun `indice` en double ;
 *   • aucun `indice` manquant.
 *
 * Un seul de ces quatre points violé, et TOUT est refusé. Retenir « ce qui
 * est appariable » laisserait un jeu partiel dont personne ne saurait dire
 * lequel des relevés a glissé.
 *
 * ⚠️ L'INDICE EST UNE POSITION DANS NOTRE LISTE, PAS UN INSTANT. Le modèle ne
 * peut donc pas désigner une seconde qu'il aurait inventée : il n'a que des
 * numéros que nous avons émis, et le lecteur refuse tous les autres.
 */
import { lireSignauxVision, type SignauxVision } from './signaux-contrat';

// ───────────────────────────────────────────────────────────────────────────
// Les bornes
// ───────────────────────────────────────────────────────────────────────────

/**
 * Le plafond d'octets d'une réponse.
 *
 * Six relevés de huit champs courts : quatre kilo-octets suffisent
 * largement. Plus bas que les seize de M3-C, parce que la sortie attendue
 * ne porte aucune phrase.
 */
export const REPONSE_SIGNAUX_MAX_OCTETS = 8 * 1024;

/** Le plafond de moments enrichis en un appel — celui de M3-C, repris. */
export const SIGNAUX_MAX = 6;

// ───────────────────────────────────────────────────────────────────────────
// Les motifs — journalisables, jamais persistés tels quels
// ───────────────────────────────────────────────────────────────────────────

export const MOTIFS_SIGNAUX = [
  'reponse_illisible',   // pas du JSON, ou plus longue que la borne d'octets
  'forme_invalide',      // JSON correct, forme fausse
  'champ_inconnu',       // une cle que ce contrat ne connait pas
  'borne_depassee',      // plus de releves que de moments envoyes
  'indice_invalide',     // un numero que nous n'avons pas emis
  'indice_duplique',     // deux releves pour le meme moment
  'indice_manquant',     // un moment envoye sans releve
] as const;
export type MotifSignauxEtape = (typeof MOTIFS_SIGNAUX)[number];

export function motifSignauxValide(v: unknown): v is MotifSignauxEtape {
  return typeof v === 'string' && (MOTIFS_SIGNAUX as readonly string[]).includes(v);
}

export type ResultatSignaux =
  | { ok: true; valeur: SignauxVision[] }
  | { ok: false; motif: MotifSignauxEtape; champ: string; detail: string | null };

function refus(
  motif: MotifSignauxEtape, champ: string, detail: string | null = null,
): ResultatSignaux {
  return { ok: false, motif, champ, detail };
}

/** Les clés connues. Tout le reste est `champ_inconnu`. */
const CLES_RACINE = ['signaux'] as const;

// ───────────────────────────────────────────────────────────────────────────
// La lecture
// ───────────────────────────────────────────────────────────────────────────

/**
 * Lit la réponse du fournisseur, et rend UN relevé PAR MOMENT ENVOYÉ.
 *
 * Le tableau rendu est indexé comme la liste des moments : `valeur[i]` est le
 * relevé du moment `i`, et il y en a exactement `nombreMoments`.
 *
 * ⚠️ NE REND JAMAIS UN JEU PARTIEL. Voir l'en-tête : un appariement partiel
 * est indistinguable d'un appariement décalé.
 */
export function lireReponseSignaux(
  brut: unknown, nombreMoments: number,
): ResultatSignaux {
  if (!Number.isInteger(nombreMoments) || nombreMoments <= 0) {
    return refus('forme_invalide', 'moments', 'aucun moment a enrichir');
  }
  if (nombreMoments > SIGNAUX_MAX) {
    return refus('borne_depassee', 'moments', `${nombreMoments} > ${SIGNAUX_MAX}`);
  }

  // ── Le corps ────────────────────────────────────────────────────────────
  let racine: unknown = brut;
  if (typeof brut === 'string') {
    const octets = Buffer.byteLength(brut, 'utf8');
    if (octets > REPONSE_SIGNAUX_MAX_OCTETS) {
      return refus('reponse_illisible', 'reponse', `${octets} octets`);
    }
    try { racine = JSON.parse(brut); } catch {
      return refus('reponse_illisible', 'reponse', 'json illisible');
    }
  }
  if (typeof racine !== 'object' || racine === null || Array.isArray(racine)) {
    return refus('forme_invalide', 'racine', 'objet attendu');
  }
  const objet = racine as Record<string, unknown>;

  const cleRacine = Object.keys(objet).find(
    (k) => !(CLES_RACINE as readonly string[]).includes(k),
  );
  if (cleRacine) return refus('champ_inconnu', cleRacine);

  const liste = objet.signaux;
  if (!Array.isArray(liste)) return refus('forme_invalide', 'signaux', 'liste attendue');
  if (liste.length !== nombreMoments) {
    // Ni plus — il aurait relevé un moment qu'on ne lui a pas montré — ni
    // moins : un relevé manquant laisserait un moment sans signal, sans
    // qu'on puisse dire lequel a été oublié.
    return refus(
      liste.length > nombreMoments ? 'borne_depassee' : 'indice_manquant',
      'signaux', `${liste.length} pour ${nombreMoments} moments`,
    );
  }

  // ── Chaque relevé ───────────────────────────────────────────────────────
  const parIndice = new Map<number, SignauxVision>();

  for (const [i, item] of liste.entries()) {
    const ou = `signaux[${i}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return refus('forme_invalide', ou, 'objet attendu');
    }
    const { indice, ...vision } = item as Record<string, unknown>;

    if (typeof indice !== 'number' || !Number.isInteger(indice)
      || indice < 0 || indice >= nombreMoments) {
      return refus('indice_invalide', `${ou}.indice`);
    }
    if (parIndice.has(indice)) {
      return refus('indice_duplique', `${ou}.indice`);
    }

    // ⚠️ LE MÊME LECTEUR QUE PARTOUT AILLEURS. Une faute de forme est
    // refusée ; une valeur illisible est déjà devenue « inconnu » à
    // l'intérieur. Voir `signaux-contrat.ts` pour le raisonnement.
    const lu = lireSignauxVision(vision);
    if (!lu.ok) return refus(lu.motif, `${ou}.${lu.champ}`);

    parIndice.set(indice, lu.valeur);
  }

  // Ceinture : la longueur est bonne et les indices sont uniques et dans la
  // plage, donc la couverture EST complète. On le vérifie tout de même — un
  // raisonnement juste aujourd'hui peut cesser de l'être après une retouche.
  const valeur: SignauxVision[] = [];
  for (let i = 0; i < nombreMoments; i += 1) {
    const s = parIndice.get(i);
    if (!s) return refus('indice_manquant', `signaux.indice[${i}]`);
    valeur.push(s);
  }

  return { ok: true, valeur };
}

/**
 * L'usage, assemblé par le TRANSPORT — jamais lu dans le JSON du modèle.
 *
 * ⚠️ RENSEIGNÉ, JAMAIS DÉBITÉ, comme partout dans ce pipeline. Il existe
 * parce que l'enrichissement est un SECOND appel payant : sans compteur à
 * lui, son coût se confondrait avec celui de la sélection.
 */
export function usageSignaux(brut: {
  images?: unknown; inputTokens?: unknown; outputTokens?: unknown;
}): { images: number; inputTokens: number; outputTokens: number } {
  const entier = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  return {
    images: entier(brut.images),
    inputTokens: entier(brut.inputTokens),
    outputTokens: entier(brut.outputTokens),
  };
}
