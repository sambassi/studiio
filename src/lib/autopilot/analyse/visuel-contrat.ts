/**
 * Le vocabulaire du RÉSULTAT VISUEL — ce qu'un modèle a le droit de dire des
 * vignettes d'un rush, et rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN MODULE SÉPARÉ DE `contrat.ts`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `contrat.ts` décrit ce que la BASE stocke : des colonnes, des états, des
 * bornes de colonnes. Ce module-ci décrit ce qu'un FOURNISSEUR TIERS rend, et
 * les deux ne se valident pas pour les mêmes raisons. `contrat.ts` se défend
 * d'un appelant maladroit ; ce module-ci se défend d'une réponse qui peut être
 * fausse, bavarde, ou dictée par du texte imprimé dans l'image analysée.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE MODULE N'IMPORTE PAS `extraction.ts`, ET CE N'EST PAS UN OUBLI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `presentation.ts` importe `./contrat`, et `components/creer/AnalyseRush.tsx`
 * — un composant CLIENT — importe `presentation.ts`. Le graphe des contrats
 * d'analyse atteint donc le paquet du navigateur. `extraction.ts` tire
 * `child_process` et `minio` : l'importer ici les y ferait entrer.
 *
 * Conséquence directe : ce module ne déclare AUCUN nombre maximal d'images.
 * Il reçoit en argument les vignettes RÉELLEMENT envoyées et en dérive tout ce
 * qui concerne le temps. Le plafond vit dans le moteur, côté serveur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST PAS ICI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni segment candidat, ni score de montage, ni timecode de coupe, ni accroche,
 * ni musique, ni transition. Ces concepts appartiennent à M3-C et n'ont pas de
 * forme arrêtée : les déclarer ici figerait un vocabulaire avant d'avoir la
 * fonctionnalité qui le porte.
 *
 * Ni parole, ni audio : ce sont les colonnes `parole` et `audio`, et l'étape
 * `transcription` (M3-B5). `qualite.energie` mesure ici un mouvement VISIBLE,
 * jamais un volume sonore — le modèle n'entend rien, il regarde des images.
 */
import { RESUME_MAX } from './contrat';

// ─────────────────────────────────────────────────────────────────────────
// Bornes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Longueur maximale du résumé. REPRISE de `contrat.ts`, jamais redéclarée.
 *
 * C'est la borne de la COLONNE (`length(resume) <= 4000`). Poser ici une
 * borne plus basse créerait deux plafonds pour une même valeur, et le jour où
 * l'un bougerait, un résumé parfaitement stockable serait refusé en amont. La
 * concision se demande dans l'invite, elle ne se fait pas respecter par un
 * refus.
 */
export { RESUME_MAX };

/**
 * Nombre maximal de textes visibles retenus.
 *
 * Au plus huit images sont montrées. Plus d'un ou deux textes LISIBLES par
 * image, ce n'est plus une vidéo filmée, c'est une capture d'écran — et un mur
 * de texte qu'aucun montage n'utilisera.
 */
export const TEXTES_VISIBLES_MAX = 12;

/**
 * Longueur maximale d'UN texte visible.
 *
 * Ce qui se lit vraiment sur une vignette de 640 px de large est un titre, un
 * logo, un sous-titre incrusté, un dossard. Au-delà de deux cents caractères,
 * le modèle ne transcrit plus, il paraphrase.
 */
export const TEXTE_VISIBLE_MAX = 200;

/**
 * Nombre maximal de problèmes techniques retenus.
 *
 * Le vocabulaire fermé ci-dessous en compte dix. Un rush qui en cumulerait
 * plus de six est inexploitable quoi qu'on en dise : la borne ne perd aucune
 * information utile, et elle empêche une liste répétitive.
 */
export const PROBLEMES_MAX = 6;

/**
 * Écart toléré, en secondes, entre l'instant annoncé par le modèle et la
 * position de vignette la plus proche.
 *
 * Ne sert qu'à borner le DÉPASSEMENT en bout de rush : un modèle qui écrit
 * `12.4` pour un rush de `12.3` s a fait une erreur d'arrondi, pas une
 * hallucination.
 */
export const TOLERANCE_SECONDE = 0.5;

/**
 * Plafond d'octets de la réponse BRUTE, avant tout `JSON.parse`.
 *
 * Une réponse légitime complète tient sous 8 Ko. Huit fois de marge, et
 * surtout : on ne `JSON.parse` jamais une chaîne non bornée.
 */
export const REPONSE_MAX_OCTETS = 64 * 1024;

// ─────────────────────────────────────────────────────────────────────────
// Vocabulaire
// ─────────────────────────────────────────────────────────────────────────

/**
 * Les problèmes techniques VISIBLES. Fermé, comme `MOTIFS_EXTRACTION`.
 *
 * Une chaîne libre serait plus expressive et strictement inutile : personne ne
 * peut compter « combien de rushes sont tremblants » sur un corpus où le même
 * défaut s'appelle tour à tour « flou », « bougé » et « manque de stabilité ».
 *
 * `ProblemeVisuel` reste une union de chaînes : un `ProblemeVisuel[]` est donc
 * bien un `string[]`, ce que la colonne `qualite` accepte tel quel.
 */
export const PROBLEMES_VISUELS = [
  'flou',              // mise au point manquée, image molle
  'tremblant',         // caméra à la main, secousses visibles
  'sous_expose',       // trop sombre, détails perdus dans les noirs
  'sur_expose',        // brûlé, détails perdus dans les blancs
  'contre_jour',       // sujet en ombre devant une source lumineuse
  'bruit',             // grain numérique, montée en sensibilité
  'basse_resolution',  // image visiblement pixelisée ou ré-agrandie
  'bande_noire',       // bandes incrustées dans l'image
  'cadrage_coupe',     // le sujet sort du cadre sans que ce soit voulu
  'sujet_absent',      // aucun sujet identifiable dans l'image
] as const;
export type ProblemeVisuel = (typeof PROBLEMES_VISUELS)[number];

/**
 * Les motifs de REFUS d'une réponse. Fermé, et distinct de `motif_echec`.
 *
 * ⚠️ Ces motifs ne vont PAS en base. La colonne `motif_echec` porte le
 * vocabulaire MÉTIER de la route : une réponse refusée ici, quelle qu'en soit
 * la cause fine, y devient `resultat_visuel_invalide`. Le motif ci-dessous va
 * au JOURNAL, où il dit LAQUELLE des façons de mal répondre s'est produite —
 * c'est ce qui permettra de savoir si un modèle dérive, et par où.
 */
export const MOTIFS_VISUEL = [
  'reponse_illisible',   // pas du JSON, ou plus longue que la borne d'octets
  'forme_invalide',      // JSON correct, forme fausse : type, absence, vide
  'champ_inconnu',       // une clé que ce contrat ne connaît pas
  'borne_depassee',      // trop long, trop d'éléments
  'valeur_hors_plage',   // score hors 0–100, non entier, confiance hors 0–1
  'seconde_incoherente', // un instant en dehors du rush
  'ordre_incoherent',    // des instants qui ne vont pas en croissant
] as const;
export type MotifVisuel = (typeof MOTIFS_VISUEL)[number];

export function motifVisuelValide(valeur: unknown): valeur is MotifVisuel {
  return typeof valeur === 'string'
    && (MOTIFS_VISUEL as readonly string[]).includes(valeur);
}

/**
 * Pourquoi l'ÉTAPE visuelle a échoué. Vocabulaire FERMÉ.
 *
 * ⚠️ IL VIT ICI, ET PAS DANS LE MOTEUR. `moteur-visuel.ts` doit pouvoir
 * vérifier un motif SANS importer `visuel.ts` — qui tire ffmpeg et MinIO. Le
 * mettre côté moteur ferait entrer le pipeline d'extraction dans tout ce qui
 * touche à la route, et casserait les tests qui doublent `extraction`.
 *
 * Contrairement aux `MOTIFS_VISUEL` ci-dessus, ceux-là VONT en base, dans
 * `motif_echec` : `presentation.ts` leur associe un message et décide s'ils
 * sont relançables. Un motif hors liste y afficherait le message générique et
 * proposerait de relancer un échec définitif.
 */
export const MOTIFS_VISUEL_ETAPE = [
  'aucune_image',             // rien de lisible — le fournisseur n'est pas appelé
  'fournisseur_absent',       // aucun adaptateur branché sur ce serveur
  'fournisseur_en_erreur',    // il a levé, ou le délai a été dépassé
  'resultat_visuel_invalide', // il a répondu, mais hors du contrat
] as const;
export type MotifVisuelEtape = (typeof MOTIFS_VISUEL_ETAPE)[number];

export function motifVisuelEtapeValide(valeur: unknown): valeur is MotifVisuelEtape {
  return typeof valeur === 'string'
    && (MOTIFS_VISUEL_ETAPE as readonly string[]).includes(valeur);
}

export function problemeVisuelValide(valeur: unknown): valeur is ProblemeVisuel {
  return typeof valeur === 'string'
    && (PROBLEMES_VISUELS as readonly string[]).includes(valeur);
}

// ─────────────────────────────────────────────────────────────────────────
// La forme du résultat
// ─────────────────────────────────────────────────────────────────────────

/**
 * Un texte réellement LU sur une image.
 *
 * `seconde` n'est PAS ce que le modèle a écrit : c'est la position de la
 * vignette dont il relève, remplacée par la nôtre à la validation. Un modèle
 * ne peut pas connaître un instant qu'on ne lui a pas montré, donc un instant
 * qu'il invente n'entre pas en base.
 *
 * `confiance` est la lisibilité déclarée, dans 0–1. Elle existe parce qu'un
 * texte à demi masqué doit pouvoir être rapporté SANS être affirmé : sans ce
 * champ, le modèle n'a le choix qu'entre taire et affirmer.
 */
export interface TexteVisible {
  texte: string;
  seconde: number;
  confiance: number;
}

/**
 * Ce qui s'apprécie, en NOMBRES.
 *
 * Six entiers 0–100 plutôt qu'une prose : ce sont les seules valeurs que M3-C
 * pourra comparer entre deux rushes. Une échelle 0–100 et non 0–1 ni 1–5 :
 * elle se lit sans conversion, elle tolère une granularité fine sans décimale,
 * et l'entier est vérifiable là où `0.7000000000000001` ne l'est pas.
 *
 * `scoreGlobal` n'est PAS calculé à partir des cinq autres et n'est pas tenu
 * de leur être cohérent. Une pondération figée ici serait une décision de
 * montage déguisée — combien vaut la netteté face à l'énergie dépend de ce
 * qu'on monte, donc de M3-C.
 */
export interface QualiteVisuelle {
  /** Appréciation d'ensemble. 0–100, entier. */
  scoreGlobal: number;
  /** Netteté, mise au point. 0–100, entier. */
  nettete: number;
  /** Exposition et lisibilité lumineuse. 0–100, entier. */
  lumiere: number;
  /** Composition, placement du sujet dans le cadre. 0–100, entier. */
  cadrage: number;
  /** Mouvement et dynamisme VISIBLES. 0–100, entier. */
  energie: number;
  /** Ce qui retient l'œil, indépendamment de la technique. 0–100, entier. */
  interetVisuel: number;
  /** Défauts constatés, vocabulaire fermé, sans doublon, borné. */
  problemes: ProblemeVisuel[];
}

/**
 * Ce que le MODÈLE a le droit de produire. Rien de plus.
 *
 * ⚠️ `usage` N'EN FAIT PAS PARTIE, ET C'EST LE POINT. Un modèle qui
 * déclarerait sa propre consommation déclarerait le coût de son propre appel.
 * `usage` est assemblé par le TRANSPORT — donc une clé `usage` dans le JSON du
 * modèle est une clé inconnue, et elle est refusée comme telle.
 *
 * Le type de scène, les sujets visibles et l'action n'ont PAS de champ propre,
 * volontairement : `sujets: string[]` serait un vocabulaire ouvert qu'aucun
 * consommateur ne lit encore, donc figé avant d'avoir servi. Ils vivent dans
 * `resume`, dont l'invite impose l'ordre.
 */
export interface ReponseVisuelle {
  resume: string;
  textesVisibles: TexteVisible[];
  qualite: QualiteVisuelle;
}

/**
 * Ce que le fournisseur a coûté. Des MÉTRIQUES, jamais un débit.
 *
 * ⚠️ AUCUN MONTANT, AUCUN CRÉDIT, AUCUNE DEVISE — et ce n'est pas un oubli.
 * La migration M3-B1 le dit pour la colonne : « RENSEIGNE, JAMAIS DEBITE ». Un
 * champ `cout` ici serait la première pierre d'un second chemin de
 * facturation, sans idempotence et sans trace dans `credit_transactions`.
 *
 * `images` est le nombre d'images RÉELLEMENT envoyées, qui peut être inférieur
 * au nombre de vignettes produites : une image illisible est écartée avant
 * l'envoi.
 */
export interface UsageVisuel {
  images: number;
  inputTokens: number;
  outputTokens: number;
}

/** Le résultat complet : ce que le modèle a dit, plus ce que l'appel a coûté. */
export interface AnalyseVisuelle extends ReponseVisuelle {
  usage: UsageVisuel;
}

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

/**
 * Le contexte SANS lequel on ne peut rien vérifier de temporel.
 *
 * Il vient de l'analyse déjà en base : les positions des vignettes réellement
 * envoyées et la durée mesurée. Les passer en argument, plutôt que de les
 * redéclarer en constantes, est ce qui permet à ce module de ne pas importer
 * `extraction.ts`.
 */
export interface ContexteVisuel {
  /** Les positions des vignettes montrées, en secondes, dans l'ordre. */
  positions: readonly number[];
  /** La durée MESURÉE du rush. Strictement positive. */
  dureeSecondes: number;
}

/**
 * Le résultat d'une validation. Union discriminée, comme `ResultatExtraction`.
 *
 * Ne lève JAMAIS. Un moteur qui doit marquer une ligne `echouee` a besoin
 * d'une cause, pas d'une exception à rattraper — et une exception non
 * rattrapée laisserait l'analyse `en_cours` pour toujours, où le verrou
 * d'unicité de M3-B1 interdirait d'en relancer une.
 */
export type ResultatVisuel =
  | { ok: true; valeur: ReponseVisuelle }
  | { ok: false; motif: MotifVisuel; champ: string; detail: string | null };

/** Un refus qui NOMME le champ fautif. Même geste que `refus()` du service. */
function refus(motif: MotifVisuel, champ: string, detail: string | null = null): ResultatVisuel {
  return { ok: false, motif, champ, detail };
}

/** Les clés connues, par niveau. Tout le reste est `champ_inconnu`. */
const CLES_RACINE = ['resume', 'textesVisibles', 'qualite'] as const;
const CLES_TEXTE = ['texte', 'seconde', 'confiance'] as const;
const CLES_QUALITE = [
  'scoreGlobal', 'nettete', 'lumiere', 'cadrage', 'energie', 'interetVisuel', 'problemes',
] as const;

/** Un objet JSON simple : ni tableau, ni `null`, ni scalaire. */
function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * La seule clé refusée sans être nommée est celle qui n'existe pas.
 *
 * `Object.keys` d'un objet issu de `JSON.parse` voit `__proto__` comme une clé
 * PROPRE — donc inconnue, donc refusée. Rien n'est fusionné ni étalé dans ce
 * module : chaque objet rendu est un littéral neuf construit de feuilles
 * validées, il n'y a donc aucun chemin de pollution de prototype.
 */
function clesInconnues(o: Record<string, unknown>, connues: readonly string[]): string | null {
  for (const cle of Object.keys(o)) if (!connues.includes(cle)) return cle;
  return null;
}

/**
 * Une chaîne exploitable : présente, non vide une fois nettoyée, bornée.
 *
 * Les caractères de contrôle sautent — sauf le saut de ligne, que le résumé a
 * le droit d'utiliser. Ils n'apportent rien et rendent illisible tout journal
 * qui les recopierait. La borne est appliquée APRÈS nettoyage : sinon une
 * réponse pourrait la franchir avec des caractères qu'on allait retirer.
 *
 * On ne masque PAS les URL, contrairement à `masquerUrls` de l'extraction.
 * Là-bas le risque était que NOTRE URL signée fuie dans un journal. Ici, une
 * URL rapportée est une URL imprimée à l'écran dans le rush : c'est un fait
 * sur la vidéo, et l'effacer serait mentir sur son contenu.
 */
function chaineBornee(v: unknown, max: number, multiligne = false): string | null {
  if (typeof v !== 'string') return null;
  // Le saut de ligne est conserve pour le resume seul : c'est le seul
  // champ qui a le droit d'avoir des paragraphes.
  const motif = multiligne
    ? /[\u0000-\u0009\u000B-\u001F\u007F]/g
    : /[\u0000-\u001F\u007F]/g;
  const propre = v.replace(motif, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!propre) return null;
  return propre.length <= max ? propre : null;
}

/** Un score : entier, 0–100. `85.5` est refusé, `"85"` aussi. */
function scoreValide(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
}

/**
 * L'instant annoncé par le modèle → NOTRE position de vignette.
 *
 * ⚠️ ON NE STOCKE JAMAIS LE NOMBRE DU MODÈLE.
 *
 * Le modèle n'a d'autre information temporelle que les positions étiquetées
 * sur les images. Toute autre valeur est déduite ou inventée. On ramène donc
 * l'instant à la vignette dont il relève, et c'est cette position-là — la
 * nôtre, mesurée par ffmpeg — qui part en base.
 *
 * Refuser sur un simple écart d'arrondi serait sévère sans rien protéger : un
 * instant COMPRIS DANS LE RUSH est toujours attribuable à une vignette. Ce qui
 * est refusé, c'est un instant qui n'existe pas dans le rush.
 */
export function normaliserSeconde(v: unknown, contexte: ContexteVisuel): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < -TOLERANCE_SECONDE) return null;
  if (v > contexte.dureeSecondes + TOLERANCE_SECONDE) return null;
  if (contexte.positions.length === 0) return null;

  let meilleure = contexte.positions[0];
  let ecart = Math.abs(meilleure - v);
  for (const p of contexte.positions) {
    const d = Math.abs(p - v);
    if (d < ecart) { meilleure = p; ecart = d; }
  }
  return meilleure;
}

/**
 * Le texte brut → un objet validé, ou un refus. Aucune indulgence de forme.
 *
 * ⚠️ NI DÉCLÔTURE DE BLOC ```json, NI « CHERCHER LA PREMIÈRE ACCOLADE ».
 *
 * Ces deux tolérances sont exactement le chemin d'injection : « chercher la
 * première accolade » finit un jour par analyser un objet que le modèle a
 * écrit DANS une phrase, en citant le texte lu sur l'image. On refuse.
 */
export function lireReponseVisuelle(brut: unknown, contexte: ContexteVisuel): ResultatVisuel {
  if (estObjet(brut)) return analyseVisuelleValide(brut, contexte);
  if (typeof brut !== 'string') return refus('reponse_illisible', 'reponse', 'ni objet ni chaine');

  // La borne porte sur les OCTETS, pas sur les caractères : un caractère hors
  // du plan multilingue de base en pèse quatre, et c'est la mémoire qu'on
  // protège, pas la lisibilité.
  const octets = Buffer.byteLength(brut, 'utf8');
  if (octets > REPONSE_MAX_OCTETS) {
    return refus('reponse_illisible', 'reponse', `${octets} octets`);
  }

  let objet: unknown;
  try {
    objet = JSON.parse(brut.trim());
  } catch {
    // Le message d'erreur de `JSON.parse` CITE l'entrée. On ne le rend pas :
    // ce serait recopier dans le journal le texte même qu'on refuse.
    return refus('reponse_illisible', 'reponse', 'json invalide');
  }
  return analyseVisuelleValide(objet, contexte);
}

/**
 * Le validateur. Ne fait confiance à rien de ce qu'il reçoit.
 *
 * Ordre volontaire : la forme d'abord (ce qui est là), les bornes ensuite (ce
 * qui est trop), les plages enfin (ce qui est faux). Un refus s'arrête au
 * premier problème — ce n'est pas un formulaire, il n'y a personne à qui
 * rendre la liste complète des fautes.
 *
 * ⚠️ Une clé inconnue est REFUSÉE, pas ignorée. C'est la position de
 * `CHAMPS_INTERDITS_ANALYSE` : « un champ ignoré laisse croire qu'il a été
 * pris en compte ». Un argument s'y ajoute ici : une clé inconnue signifie que
 * le modèle n'a pas répondu au contrat qu'on lui a donné. Il y a exactement
 * deux causes — l'invite a dérivé, ou le modèle a été orienté par du texte
 * imprimé dans l'image. Ignorer la clé supprime le seul signal qui distinguait
 * ces deux cas d'une réponse normale.
 */
export function analyseVisuelleValide(brut: unknown, contexte: ContexteVisuel): ResultatVisuel {
  if (!estObjet(brut)) return refus('forme_invalide', 'racine', 'objet attendu');

  const inconnue = clesInconnues(brut, CLES_RACINE);
  if (inconnue) return refus('champ_inconnu', inconnue);

  // ── resume ──────────────────────────────────────────────────────────────
  if (!('resume' in brut)) return refus('forme_invalide', 'resume', 'absent');
  const resume = chaineBornee(brut.resume, RESUME_MAX, true);
  if (resume === null) {
    return typeof brut.resume === 'string' && brut.resume.length > RESUME_MAX
      ? refus('borne_depassee', 'resume', `${brut.resume.length} > ${RESUME_MAX}`)
      : refus('forme_invalide', 'resume', 'chaine non vide attendue');
  }

  // ── textesVisibles ──────────────────────────────────────────────────────
  if (!('textesVisibles' in brut)) return refus('forme_invalide', 'textesVisibles', 'absent');
  if (!Array.isArray(brut.textesVisibles)) {
    return refus('forme_invalide', 'textesVisibles', 'tableau attendu');
  }
  if (brut.textesVisibles.length > TEXTES_VISIBLES_MAX) {
    return refus('borne_depassee', 'textesVisibles',
      `${brut.textesVisibles.length} > ${TEXTES_VISIBLES_MAX}`);
  }

  const textesVisibles: TexteVisible[] = [];
  let precedente = -1;
  for (const [i, item] of brut.textesVisibles.entries()) {
    const ou = `textesVisibles[${i}]`;
    if (!estObjet(item)) return refus('forme_invalide', ou, 'objet attendu');
    const k = clesInconnues(item, CLES_TEXTE);
    if (k) return refus('champ_inconnu', `${ou}.${k}`);

    const texte = chaineBornee(item.texte, TEXTE_VISIBLE_MAX);
    if (texte === null) {
      return typeof item.texte === 'string' && item.texte.length > TEXTE_VISIBLE_MAX
        ? refus('borne_depassee', `${ou}.texte`, `${item.texte.length} > ${TEXTE_VISIBLE_MAX}`)
        : refus('forme_invalide', `${ou}.texte`, 'chaine non vide attendue');
    }

    const seconde = normaliserSeconde(item.seconde, contexte);
    if (seconde === null) return refus('seconde_incoherente', `${ou}.seconde`);
    // L'invite impose l'ordre chronologique. Une liste désordonnée signifie
    // que le modèle n'a pas suivi l'ordre des images — donc que l'ancrage
    // temporel de chaque entrée est douteux, pas seulement son rang.
    if (seconde < precedente) return refus('ordre_incoherent', `${ou}.seconde`);
    precedente = seconde;

    const confiance = item.confiance;
    if (typeof confiance !== 'number' || !Number.isFinite(confiance)
        || confiance < 0 || confiance > 1) {
      return refus('valeur_hors_plage', `${ou}.confiance`);
    }

    textesVisibles.push({ texte, seconde, confiance: Math.round(confiance * 100) / 100 });
  }

  // ── qualite ─────────────────────────────────────────────────────────────
  if (!('qualite' in brut)) return refus('forme_invalide', 'qualite', 'absent');
  if (!estObjet(brut.qualite)) return refus('forme_invalide', 'qualite', 'objet attendu');
  const q = brut.qualite;
  const kq = clesInconnues(q, CLES_QUALITE);
  if (kq) return refus('champ_inconnu', `qualite.${kq}`);

  const scores: Record<string, number> = {};
  for (const cle of CLES_QUALITE) {
    if (cle === 'problemes') continue;
    if (!(cle in q)) return refus('forme_invalide', `qualite.${cle}`, 'absent');
    if (!scoreValide(q[cle])) return refus('valeur_hors_plage', `qualite.${cle}`);
    scores[cle] = q[cle] as number;
  }

  if (!('problemes' in q)) return refus('forme_invalide', 'qualite.problemes', 'absent');
  if (!Array.isArray(q.problemes)) {
    return refus('forme_invalide', 'qualite.problemes', 'tableau attendu');
  }
  if (q.problemes.length > PROBLEMES_MAX) {
    return refus('borne_depassee', 'qualite.problemes', `${q.problemes.length} > ${PROBLEMES_MAX}`);
  }
  const problemes: ProblemeVisuel[] = [];
  for (const [i, p] of q.problemes.entries()) {
    if (!problemeVisuelValide(p)) return refus('forme_invalide', `qualite.problemes[${i}]`);
    // Le doublon est retiré, pas refusé : répéter `flou` n'est pas répondre à
    // côté du contrat, c'est répondre deux fois la même chose vraie.
    if (!problemes.includes(p)) problemes.push(p);
  }

  const qualite: QualiteVisuelle = {
    scoreGlobal: scores.scoreGlobal,
    nettete: scores.nettete,
    lumiere: scores.lumiere,
    cadrage: scores.cadrage,
    energie: scores.energie,
    interetVisuel: scores.interetVisuel,
    problemes,
  };

  return { ok: true, valeur: { resume, textesVisibles, qualite } };
}

/**
 * L'usage, assemblé par le TRANSPORT — jamais lu dans le JSON du modèle.
 *
 * Trois entiers positifs ou nuls. Ce qui n'est pas un entier positif devient
 * `0` plutôt que de faire échouer une analyse par ailleurs valide : une
 * métrique de coût absente est un compteur faux, une analyse perdue est un
 * rush à refaire. C'est le seul endroit de ce module où l'indulgence est le
 * bon choix, et c'est parce que la valeur ne vient PAS du modèle.
 */
export function usageVisuel(brut: {
  images?: unknown; inputTokens?: unknown; outputTokens?: unknown;
}): UsageVisuel {
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
