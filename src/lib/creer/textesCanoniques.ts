/**
 * Resolveur canonique des trois textes d'un montage.
 *
 * ── LE PROBLEME QU'IL RESOUT ──────────────────────────────────────────────
 *
 * Trois concepts INDEPENDANTS coexistent dans un montage :
 *
 *   1. CTA PRINCIPAL    le grand texte d'action     « RESERVEZ MAINTENANT »
 *   2. CTA SECONDAIRE   la ligne complementaire     « Lien en bio »
 *   3. FILIGRANE        la signature de la marque   « Afroboost »
 *
 * Six cles se les partagent, avec des conventions CONTRADICTOIRES selon le
 * producteur du post. L'audit du 2026-08-26 les a inventoriees :
 *
 *   - `creer-avance` ecrit le GROS texte dans `branding.watermarkText` ET
 *     `design.ctaMainText`, la PETITE ligne dans `branding.ctaText` ET
 *     `design.ctaSubTextDesign`. Il n'a aucun champ « filigrane ».
 *   - L'Assistant ecrit le principal dans `branding.ctaText` ET
 *     `design.ctaMainText`, le secondaire dans `branding.ctaSubText` ET
 *     `design.ctaSubText`, et le filigrane — le vrai — dans `design.siteText`.
 *   - L'Autopilote met la MEME valeur dans les trois cles `ctaText`,
 *     `watermarkText` et `ctaMainText`.
 *   - `video-composer.drawCTA` lit `ctaMainText || watermarkText` pour le gros
 *     texte : c'est la seule chaine ou le filigrane sert de repli a un CTA.
 *
 * ── LA REGLE CARDINALE ────────────────────────────────────────────────────
 *
 * `branding.watermarkText` N'EST PAS LE FILIGRANE. Les deux jeux d'essai
 * reels le prouvent : `watermarkText === design.ctaMainText` chez les DEUX
 * producteurs (`canonical-design.ts`, ADVANCED l.100/120 et ASSISTANT
 * l.230/253). C'est un CTA principal range sous un nom trompeur.
 *
 * Le seul champ qui porte, dans des donnees reelles, une signature de marque
 * DISTINCTE du CTA est `design.siteText.text` — et c'est deja lui que le
 * compositeur peint en calque separe (`video-composer.ts` l.3933) et que le
 * Calendrier affiche independamment (`calendar/page.tsx` l.4047).
 *
 * D'ou les deux interdits, absolus et sans exception :
 *   - le filigrane n'est JAMAIS un repli de CTA ;
 *   - un CTA n'ecrit JAMAIS dans `branding.watermarkText`.
 *
 * ── PURETE ────────────────────────────────────────────────────────────────
 *
 * Aucun React, aucun reseau, aucune base, aucun stockage, aucun effet de bord,
 * aucune mutation de l'entree. Aucun appelant applicatif : ce module est le
 * socle du lot 1 de la migration, pose avant tout branchement.
 *
 * ── PRESENCE, PAS VERACITE ────────────────────────────────────────────────
 *
 * Une cle presente valant `''` est une extinction VOLONTAIRE, pas une absence.
 * Aucune resolution n'utilise `||` : la presence est lue avec
 * `Object.prototype.hasOwnProperty`, jamais deduite de la valeur.
 */

/** Chemin exact de la cle d'ou vient une valeur resolue. */
export type CleTexte =
  | 'branding.ctaText'
  | 'branding.ctaSubText'
  | 'branding.watermarkText'
  | 'design.ctaMainText'
  | 'design.ctaSubText'
  | 'design.ctaSubTextDesign'
  | 'design.siteText.text';

/**
 * Convention d'ecriture du post, deduite de la FORME des cles presentes.
 *
 *   - `jumele`        `watermarkText` recopie `design.ctaMainText`. Assistant,
 *                     editeur avance et Autopilote produisent tous cette
 *                     forme. `watermarkText` y est un CTA, pas un filigrane.
 *   - `avance-herite` pas de `design.ctaMainText`, mais un `watermarkText` :
 *                     ancien post de l'editeur avance, dont le GROS texte vit
 *                     sous `watermarkText` et la PETITE ligne sous `ctaText`.
 *   - `canonique`     tout le reste, y compris les posts sans aucun texte.
 */
export type Producteur = 'canonique' | 'jumele' | 'avance-herite';

/** Un texte resolu, avec la trace exacte de son origine. */
export interface TexteResolu {
  /** La valeur, `''` compris. `null` seulement si rien ne l'a fournie. */
  readonly valeur: string | null;
  /** Chemin de la cle d'origine. `null` si defaut ou absence. */
  readonly cle: CleTexte | null;
  /** Une cle de la metadata portait reellement cette valeur. */
  readonly present: boolean;
  /** Valeur venue d'un defaut d'appelant : A NE JAMAIS PERSISTER. */
  readonly parDefaut: boolean;
}

/** Le filigrane porte en plus son interrupteur, qui n'est pas son texte. */
export interface FiligraneResolu extends TexteResolu {
  /**
   * `design.siteText.enabled !== false`. Volontairement SEPARE du texte : un
   * filigrane eteint garde son libelle, et le rallumer doit le retrouver.
   */
  readonly actif: boolean;
}

export interface TextesResolus {
  readonly ctaPrincipal: TexteResolu;
  readonly ctaSecondaire: TexteResolu;
  readonly filigrane: FiligraneResolu;
  readonly producteur: Producteur;
}

/** Les trois concepts, nommes — pour `ecrireTexte`. */
export type ChampTexte = 'ctaPrincipal' | 'ctaSecondaire' | 'filigrane';

export interface Defauts {
  readonly ctaPrincipal?: string;
  readonly ctaSecondaire?: string;
  readonly filigrane?: string;
}

export interface OptionsResolution {
  /**
   * Defauts d'AFFICHAGE, appliques uniquement si l'appelant les fournit.
   *
   * Volontairement optionnels : le resolveur ne doit rien inventer qu'un
   * appelant pourrait ensuite persister par megarde. Une valeur issue d'un
   * defaut est marquee `parDefaut: true` et n'a pas de cle d'origine.
   */
  readonly defauts?: Defauts;
}

/**
 * Les litteraux que `video-composer.drawCTA` applique AUJOURD'HUI (l.2806-2807).
 *
 * Fournis tels quels pour qu'un futur appelant reproduise le rendu actuel sans
 * le reinventer. Le filigrane n'y figure PAS : le compositeur retombe sur
 * « Afroboost.com » (l.3933) et l'Assistant sur « Studiio.pro »
 * (`AssistantWizard.tsx` l.489) — deux valeurs qui se contredisent. Trancher
 * entre elles est une decision produit, pas une decision de resolveur.
 */
export const DEFAUTS_COMPOSITEUR: Required<Pick<Defauts, 'ctaPrincipal' | 'ctaSecondaire'>> = Object.freeze({
  ctaPrincipal: 'AFROBOOST',
  ctaSecondaire: "CHAT POUR PLUS D'INFOS",
});

/** Cle d'ecriture quand AUCUNE cle ne portait encore la valeur. */
const CLE_CANONIQUE: Readonly<Record<ChampTexte, CleTexte>> = Object.freeze({
  // Choisies pour que l'ecriture GAGNE la relecture : la priorite de lecture
  // ne les depasse que par des cles absentes, sinon la valeur ecrite serait
  // invisible.
  ctaPrincipal: 'branding.ctaText',
  ctaSecondaire: 'branding.ctaSubText',
  filigrane: 'design.siteText.text',
});

// ── Lecture defensive ───────────────────────────────────────────────────────

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Sous-objet nomme, ou `undefined` — jamais une exception. */
function sousObjet(parent: unknown, nom: string): Record<string, unknown> | undefined {
  if (!estObjet(parent)) return undefined;
  const v = parent[nom];
  return estObjet(v) ? v : undefined;
}

/**
 * Une chaine reellement PRESENTE sous `nom`.
 *
 * `hasOwnProperty` d'abord : c'est ce qui distingue `''` (extinction voulue)
 * d'une cle absente. Une cle presente mais non-chaine — `undefined`, `null`,
 * un nombre — est traitee comme absente : elle ne porte pas de texte.
 */
function chaine(source: Record<string, unknown> | undefined, nom: string): string | undefined {
  if (!source) return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, nom)) return undefined;
  const v = source[nom];
  return typeof v === 'string' ? v : undefined;
}

// ── Detection du producteur ─────────────────────────────────────────────────

/**
 * Deduit la convention d'ecriture du post d'apres la FORME de ses cles.
 *
 * Aucune inspection de valeur metier : seules la presence des cles et
 * l'egalite `watermarkText === ctaMainText` entrent en jeu. Cette egalite
 * n'est pas une heuristique de contenu — c'est la signature mecanique du
 * jumelage que les trois producteurs ecrivent.
 */
export function detecterProducteur(metadata: unknown): Producteur {
  const branding = sousObjet(metadata, 'branding');
  const design = sousObjet(metadata, 'design');
  const watermark = chaine(branding, 'watermarkText');
  const principal = chaine(design, 'ctaMainText');

  if (watermark === undefined) return 'canonique';
  if (principal === undefined) return 'avance-herite';
  return watermark === principal ? 'jumele' : 'canonique';
}

// ── Resolution ──────────────────────────────────────────────────────────────

interface Rung {
  readonly cle: CleTexte;
  readonly valeur: string | undefined;
}

function premierPresent(echelons: readonly Rung[], defaut: string | undefined): TexteResolu {
  for (const e of echelons) {
    if (e.valeur !== undefined) {
      return { valeur: e.valeur, cle: e.cle, present: true, parDefaut: false };
    }
  }
  if (defaut !== undefined) {
    return { valeur: defaut, cle: null, present: false, parDefaut: true };
  }
  return { valeur: null, cle: null, present: false, parDefaut: false };
}

/**
 * Resout les trois textes, chacun avec sa provenance exacte.
 *
 * Ne modifie, ne complete et ne migre RIEN : l'objet recu ressort intact, et
 * aucune valeur resolue n'est ecrite nulle part.
 */
export function resoudreTextes(metadata: unknown, options?: OptionsResolution): TextesResolus {
  const branding = sousObjet(metadata, 'branding');
  const design = sousObjet(metadata, 'design');
  const siteText = sousObjet(design, 'siteText');
  const producteur = detecterProducteur(metadata);
  const defauts = options?.defauts;

  // ── CTA principal ────────────────────────────────────────────────────────
  // `design.ctaMainText` d'abord : la seule cle qu'aucun lecteur ne contredit.
  // Puis, pour les seuls posts `avance-herite`, `watermarkText` — qui y porte
  // le GROS texte. Ce n'est pas « le filigrane en repli » : sur ces posts,
  // `watermarkText` n'a jamais contenu de filigrane.
  const ctaPrincipal = premierPresent(
    [
      { cle: 'design.ctaMainText', valeur: chaine(design, 'ctaMainText') },
      ...(producteur === 'avance-herite'
        ? ([{ cle: 'branding.watermarkText', valeur: chaine(branding, 'watermarkText') }] as const)
        : []),
      { cle: 'branding.ctaText', valeur: chaine(branding, 'ctaText') },
    ],
    defauts?.ctaPrincipal,
  );

  // ── CTA secondaire ───────────────────────────────────────────────────────
  // `ctaSubTextDesign` est le nom que lit le compositeur, `ctaSubText` celui
  // que persiste l'Assistant : les deux sont acceptes, ce qui supprime la
  // dependance a la traduction faite aujourd'hui par le Calendrier.
  // Au niveau `branding`, la cle depend du producteur : chez `avance-herite`
  // la petite ligne vit sous `ctaText`, partout ailleurs sous `ctaSubText`.
  const ctaSecondaire = premierPresent(
    [
      { cle: 'design.ctaSubTextDesign', valeur: chaine(design, 'ctaSubTextDesign') },
      { cle: 'design.ctaSubText', valeur: chaine(design, 'ctaSubText') },
      producteur === 'avance-herite'
        ? { cle: 'branding.ctaText' as const, valeur: chaine(branding, 'ctaText') }
        : { cle: 'branding.ctaSubText' as const, valeur: chaine(branding, 'ctaSubText') },
    ],
    defauts?.ctaSecondaire,
  );

  // ── Filigrane ────────────────────────────────────────────────────────────
  // UNE seule source. Pas de repli sur `watermarkText`, sur un CTA, ni sur
  // quoi que ce soit d'autre : absent veut dire absent.
  const base = premierPresent(
    [{ cle: 'design.siteText.text', valeur: chaine(siteText, 'text') }],
    defauts?.filigrane,
  );
  const filigrane: FiligraneResolu = {
    ...base,
    // Absent vaut « allume » : c'est la regle du compositeur (l.3934), et la
    // seule qui n'eteigne pas retroactivement les montages existants.
    actif: siteText ? siteText.enabled !== false : true,
  };

  return { ctaPrincipal, ctaSecondaire, filigrane, producteur };
}

// ── Ecriture ────────────────────────────────────────────────────────────────

/** Copie de surface d'un objet, ou objet neuf si l'entree n'en est pas un. */
function copieSurface(v: unknown): Record<string, unknown> {
  return estObjet(v) ? { ...v } : {};
}

/**
 * Ecrit UNE valeur dans la SEULE cle d'ou elle vient, et retourne une metadata
 * neuve.
 *
 * Trois garanties :
 *
 *   1. L'objet recu n'est jamais mute. Seuls les objets du CHEMIN ecrit sont
 *      recopies ; tout le reste est partage par reference, donc les cles
 *      inconnues traversent a l'identique.
 *   2. La cible est la cle d'ORIGINE quand la valeur en avait une — c'est ce
 *      qui garantit que l'ecriture gagne la relecture. Sinon, la cle
 *      canonique du concept.
 *   3. `branding.watermarkText` n'est JAMAIS une cible. Un CTA principal
 *      d'ancien post `avance-herite` migre vers `branding.ctaText`, et la cle
 *      ambigue est laissee telle quelle — ni reecrite, ni supprimee : la
 *      supprimer casserait la relecture par un build anterieur.
 */
export function ecrireTexte(
  metadata: unknown,
  champ: ChampTexte,
  valeur: string,
): Record<string, unknown> {
  // Garde de provenance. TypeScript interdit deja les autres valeurs, mais ce
  // module est une frontiere : il lit de la metadata non fiable, et rien ne
  // garantit que tous ses appelants soient types. Sans cette garde,
  // `ecrireTexte(m, '__proto__', v)` n'empoisonnait certes aucun prototype,
  // mais retombait en silence sur `design.ctaSubTextDesign` — une ecriture
  // dans une cle que PERSONNE n'avait demandee. Echouer bruyamment vaut
  // mieux que corrompre le sous-texte d'un montage.
  if (!Object.prototype.hasOwnProperty.call(CLE_CANONIQUE, champ)) {
    throw new TypeError(`ecrireTexte : champ inconnu « ${String(champ)} »`);
  }

  const resolus = resoudreTextes(metadata);
  const origine = resolus[champ].cle;
  const cible: CleTexte =
    origine === null || origine === 'branding.watermarkText' ? CLE_CANONIQUE[champ] : origine;

  const suivant = copieSurface(metadata);

  if (cible === 'branding.ctaText' || cible === 'branding.ctaSubText') {
    const branding = copieSurface(suivant.branding);
    branding[cible === 'branding.ctaText' ? 'ctaText' : 'ctaSubText'] = valeur;
    suivant.branding = branding;
    return suivant;
  }

  const design = copieSurface(suivant.design);

  if (cible === 'design.siteText.text') {
    const siteText = copieSurface(design.siteText);
    siteText.text = valeur;
    design.siteText = siteText;
  } else if (cible === 'design.ctaMainText') {
    design.ctaMainText = valeur;
  } else if (cible === 'design.ctaSubText') {
    design.ctaSubText = valeur;
  } else {
    design.ctaSubTextDesign = valeur;
  }

  suivant.design = design;
  return suivant;
}
