'use client';

/**
 * Catalogue de polices — LA source unique.
 *
 * L'apercu (DOM) et le compositeur (canvas) doivent charger exactement les
 * memes familles, avec exactement les memes graisses. Deux listes finiraient
 * par diverger, et la video ne ressemblerait plus a ce que l'utilisateur a
 * valide a l'ecran.
 *
 * Les GRAISSES sont declarees famille par famille : c'est ce qui permet de ne
 * telecharger que ce qui existe, et de VERIFIER le chargement sur les seules
 * graisses qu'une famille publie — controler le 900 d'une Pacifico qui n'a que
 * le 400 faisait conclure a tort a un echec.
 *
 * ⚠️ Le vrai piege est ailleurs, et il est silencieux : `document.fonts.load()`
 * appele juste apres avoir insere la balise `<link>` ne trouve encore AUCUNE
 * `@font-face` — la feuille n'est pas analysee — et resout donc sur un tableau
 * vide, immediatement. Pire, `document.fonts.check()` renvoie `true` par
 * specification quand rien ne correspond (le texte se rendra, en police
 * systeme). Un chargement qui ne charge rien se declarait ainsi reussi en
 * quelques millisecondes, et le canvas dessinait en Helvetica pendant que
 * l'apercu, lui, affichait la bonne police. Il faut attendre le `load` de la
 * balise AVANT de demander les polices, et se fier aux `FontFace` reellement
 * renvoyees, jamais a `check()`.
 */

export type FontGroup = 'display' | 'text' | 'script';

export interface FontDef {
  family: string;
  /** Graisses REELLEMENT publiees par Google pour cette famille. */
  weights: number[];
  group: FontGroup;
  /**
   * Variable CSS posee par `next/font` dans `layout.tsx`, quand la famille en
   * a une. Ces six-la sont deja dans la page : elles s'affichent sans aucun
   * telechargement, et leur pile CSS ne doit pas changer — c'est le rendu
   * d'avant ce catalogue.
   */
  cssVar?: string;
}

/**
 * Ordre d'affichage dans le selecteur. « Titres » d'abord : c'est ce qu'on
 * cherche pour une affiche.
 */
export const FONT_GROUP_LABELS: Record<FontGroup, string> = {
  display: 'Titres',
  text: 'Texte',
  script: 'Script',
};

export const FONT_CATALOG: FontDef[] = [
  // ── Titres / display ────────────────────────────────────────────────
  { family: 'Anton', weights: [400], group: 'display', cssVar: '--font-anton' },
  { family: 'Bebas Neue', weights: [400], group: 'display', cssVar: '--font-bebas' },
  { family: 'Syne', weights: [400, 500, 600, 700, 800], group: 'display', cssVar: '--font-syne' },
  { family: 'Archivo Black', weights: [400], group: 'display' },
  { family: 'Oswald', weights: [200, 300, 400, 500, 600, 700], group: 'display' },
  { family: 'Teko', weights: [300, 400, 500, 600, 700], group: 'display' },
  { family: 'Righteous', weights: [400], group: 'display' },
  { family: 'Bungee', weights: [400], group: 'display' },
  { family: 'Alfa Slab One', weights: [400], group: 'display' },
  { family: 'Titan One', weights: [400], group: 'display' },
  { family: 'Fjalla One', weights: [400], group: 'display' },
  { family: 'Staatliches', weights: [400], group: 'display' },
  { family: 'Chivo', weights: [300, 400, 700, 900], group: 'display' },
  { family: 'Playfair Display', weights: [400, 500, 600, 700, 800, 900], group: 'display' },
  { family: 'Abril Fatface', weights: [400], group: 'display' },
  { family: 'Bodoni Moda', weights: [400, 500, 600, 700, 800, 900], group: 'display' },
  { family: 'Cinzel', weights: [400, 500, 600, 700, 800, 900], group: 'display' },
  { family: 'Anton SC', weights: [400], group: 'display' },
  { family: 'Rubik Mono One', weights: [400], group: 'display' },
  { family: 'Passion One', weights: [400, 700, 900], group: 'display' },

  // ── Texte courant ───────────────────────────────────────────────────
  { family: 'Inter', weights: [400, 500, 600, 700, 800, 900], group: 'text', cssVar: '--font-inter' },
  { family: 'Poppins', weights: [400, 500, 600, 700, 800, 900], group: 'text', cssVar: '--font-poppins' },
  { family: 'Space Grotesk', weights: [400, 500, 600, 700], group: 'text', cssVar: '--font-space' },
  { family: 'Roboto', weights: [400, 500, 700, 900], group: 'text' },
  { family: 'Lato', weights: [400, 700, 900], group: 'text' },
  { family: 'Open Sans', weights: [400, 500, 600, 700, 800], group: 'text' },
  { family: 'Montserrat', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Raleway', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Nunito', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Work Sans', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'DM Sans', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Manrope', weights: [400, 500, 600, 700, 800], group: 'text' },
  { family: 'Rubik', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Karla', weights: [400, 500, 600, 700, 800], group: 'text' },
  { family: 'Figtree', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Source Sans 3', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Merriweather', weights: [400, 700, 900], group: 'text' },
  { family: 'Lora', weights: [400, 500, 600, 700], group: 'text' },
  { family: 'Roboto Condensed', weights: [400, 500, 600, 700, 800, 900], group: 'text' },
  { family: 'Barlow', weights: [400, 500, 600, 700, 800, 900], group: 'text' },

  // ── Scriptes / manuscrites ──────────────────────────────────────────
  { family: 'Pacifico', weights: [400], group: 'script' },
  { family: 'Dancing Script', weights: [400, 500, 600, 700], group: 'script' },
  { family: 'Caveat', weights: [400, 500, 600, 700], group: 'script' },
  { family: 'Permanent Marker', weights: [400], group: 'script' },
  { family: 'Satisfy', weights: [400], group: 'script' },
  { family: 'Great Vibes', weights: [400], group: 'script' },
  { family: 'Lobster', weights: [400], group: 'script' },
  { family: 'Sacramento', weights: [400], group: 'script' },
  { family: 'Shadows Into Light', weights: [400], group: 'script' },
  { family: 'Indie Flower', weights: [400], group: 'script' },
  { family: 'Kalam', weights: [300, 400, 700], group: 'script' },
  { family: 'Courgette', weights: [400], group: 'script' },
];

const BY_FAMILY = new Map(FONT_CATALOG.map((f) => [f.family, f]));

export function findFont(family: string | undefined | null): FontDef | undefined {
  return family ? BY_FAMILY.get(family) : undefined;
}

/** Le selecteur, groupe par usage — memes donnees, autre forme. */
export const FONT_GROUPS: Array<{ group: FontGroup; label: string; fonts: string[] }> = (
  ['display', 'text', 'script'] as FontGroup[]
).map((group) => ({
  group,
  label: FONT_GROUP_LABELS[group],
  fonts: FONT_CATALOG.filter((f) => f.group === group).map((f) => f.family),
}));

/**
 * Pile CSS d'une famille.
 *
 * La variable `next/font` en tete quand elle existe : ces six familles sont
 * deja dans la page, elles s'affichent sans le moindre telechargement. Le nom
 * brut ensuite — c'est sous ce nom que la feuille Google Fonts injectee
 * enregistre la famille, et c'est aussi le seul nom que `ctx.font` comprend
 * cote canvas.
 */
export function fontStack(family: string): string {
  const def = findFont(family);
  const quoted = `'${family}'`;
  return def?.cssVar ? `var(${def.cssVar}), ${quoted}, sans-serif` : `${quoted}, sans-serif`;
}

/**
 * URL de la feuille Google Fonts d'une famille, avec SES graisses.
 *
 * L'API tolere les graisses surnumeraires — elle les rabat sur les plus
 * proches — et ne repond 400 que si AUCUNE des graisses demandees n'existe.
 * Ne demander que les graisses publiees allege donc la feuille et permet de
 * verifier le chargement sur les bonnes, sans etre en soi un correctif.
 */
export function googleFontsUrl(family: string, weights: number[]): string {
  const name = family.trim().replace(/\s+/g, '+');
  const list = [...new Set(weights)].sort((a, b) => a - b).join(';');
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${list}&display=swap`;
}

/** Familles deja servies par une feuille complete — une balise par famille. */
const injected = new Map<string, Promise<boolean>>();
/** Chargements REUSSIS, memorises. Les echecs, eux, doivent pouvoir etre rejoues. */
const loaded = new Map<string, Promise<boolean>>();

/**
 * Insere une feuille et attend qu'elle soit ANALYSEE.
 *
 * C'est l'etape qui manquait : sans elle, `document.fonts` est encore vide
 * quand on lui demande la police, et tout le reste s'ecroule en silence.
 */
function injectSheet(href: string, key: string, timeoutMs: number): Promise<boolean> {
  const existing = injected.get(key);
  if (existing) return existing;
  const ready = new Promise<boolean>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.font = key;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    // Delai de garde : un CDN injoignable ne doit pas retenir un export.
    const timer = setTimeout(() => finish(false), timeoutMs);
    link.onload = () => finish(true);
    link.onerror = () => finish(false);
    document.head.appendChild(link);
  });
  injected.set(key, ready);
  // Une feuille qui n'arrive pas ne doit pas rester en cache : le prochain
  // export — ou le prochain reseau — doit pouvoir la redemander.
  void ready.then((ok) => { if (!ok) injected.delete(key); });
  return ready;
}

/**
 * Rend une famille utilisable — dans le DOM **et** dans un canvas.
 *
 * Charge a la demande : le catalogue compte des dizaines de familles, les
 * telecharger toutes plomberait la page pour n'en servir qu'une ou deux.
 *
 * Renvoie `true` quand au moins une graisse est REELLEMENT arrivee — mesure
 * sur les `FontFace` que renvoie `document.fonts.load`, et non sur
 * `document.fonts.check`, qui repond `true` des qu'aucune `@font-face` ne
 * correspond. Un `false` dit que le canvas dessinera dans une police de
 * repli : l'appelant peut le signaler plutot que de produire en silence une
 * video qui ne ressemble pas a l'apercu.
 *
 * Seuls les SUCCES sont memorises. Memoriser un echec figerait pour toute la
 * session une police que le prochain export aurait pu obtenir.
 */
export async function ensureFontLoaded(family: string, timeoutMs = 8000): Promise<boolean> {
  if (typeof document === 'undefined' || !family || family === 'sans-serif') return false;
  const cached = loaded.get(family);
  if (cached) return cached;

  const def = findFont(family);
  // Famille hors catalogue (metadonnee d'un ancien post, saisie manuelle) : on
  // ne demande que le 400. L'API Google repond 400 Bad Request quand AUCUNE
  // des graisses demandees n'existe, et le 400 est la seule que toute famille
  // publie.
  const weights = def?.weights ?? [400];

  const run = (async () => {
    // La variable `next/font` ne sert QUE le DOM : `ctx.font` du canvas ne
    // sait pas lire `var(--font-anton)`, il lui faut la famille sous son vrai
    // nom. D'ou cette feuille, meme pour les familles deja dans la page.
    const sheetOk = await injectSheet(googleFontsUrl(family, weights), family, timeoutMs);
    if (!sheetOk) {
      console.warn(`[Fonts] feuille « ${family} » non chargée — rendu en police de repli`);
      return false;
    }

    // `load()` renvoie les `FontFace` reellement obtenues : un tableau vide
    // signifie qu'aucune ne correspond, la seule mesure fiable ici.
    const faces = await Promise.race([
      Promise.all(weights.map((w) => document.fonts.load(`${w} 48px "${family}"`).catch(() => []))),
      new Promise<FontFace[][]>((r) => setTimeout(() => r([]), timeoutMs)),
    ]);
    const ok = faces.some((f) => f.length > 0);
    if (!ok) console.warn(`[Fonts] « ${family} » indisponible — rendu en police de repli`);
    return ok;
  })();

  loaded.set(family, run);
  // Un echec ne doit pas rester en cache : l'ancien compositeur rattrapait au
  // second export, ce cache-la l'en empecherait.
  void run.then((ok) => { if (!ok) loaded.delete(family); });
  return run;
}

/**
 * Charge les 400 de TOUT le catalogue, en UNE requete.
 *
 * Sert l'apercu du selecteur : sans police chargee, les cinquante et quelques
 * noms s'affichent tous dans la meme police systeme — pour un catalogue dont
 * la variete est justement l'interet, c'est le plus visible des defauts.
 * L'API Google accepte plusieurs `family=` dans la meme URL : une seule
 * feuille, une seule requete, uniquement la graisse normale.
 */
export function preloadCatalogPreview(timeoutMs = 8000): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const href = `https://fonts.googleapis.com/css2?${FONT_CATALOG.map(
    (f) => `family=${f.family.trim().replace(/\s+/g, '+')}:wght@400`,
  ).join('&')}&display=swap`;
  return injectSheet(href, '__catalog-preview', timeoutMs);
}

/** Charge plusieurs familles de front, et dit lesquelles ont echoue. */
export async function ensureFontsLoaded(families: Array<string | undefined | null>): Promise<string[]> {
  const unique = [...new Set(families.filter((f): f is string => !!f && f !== 'sans-serif'))];
  const results = await Promise.all(unique.map((f) => ensureFontLoaded(f)));
  return unique.filter((_, i) => !results[i]);
}
