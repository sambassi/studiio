'use client';

/**
 * Catalogue de polices — LA source unique.
 *
 * L'apercu (DOM) et le compositeur (canvas) doivent charger exactement les
 * memes familles, avec exactement les memes graisses. Deux listes finiraient
 * par diverger, et la video ne ressemblerait plus a ce que l'utilisateur a
 * valide a l'ecran.
 *
 * ⚠️ Les GRAISSES sont declarees famille par famille, et ce n'est pas du
 * confort : l'API CSS de Google Fonts repond **400 Bad Request** quand on lui
 * demande une graisse qu'une famille ne possede pas. Reclamer
 * `Pacifico:wght@400;500;600;700;800;900` — ce que faisait le repli generique
 * du compositeur — ne renvoie donc AUCUNE feuille : la police n'arrive jamais,
 * le canvas retombe sur une police systeme, et la video sort dans une autre
 * typographie que l'apercu. C'est precisement le cas de toutes les scriptes et
 * de la plupart des display, qui n'existent qu'en 400.
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
 * Demander une graisse absente fait repondre 400 a l'API : la feuille n'arrive
 * pas, et la police non plus.
 */
export function googleFontsUrl(family: string, weights: number[]): string {
  const name = family.trim().replace(/\s+/g, '+');
  const list = [...new Set(weights)].sort((a, b) => a - b).join(';');
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${list}&display=swap`;
}

/** Familles deja demandees — une seule balise `<link>` par famille. */
const injected = new Set<string>();
/** Chargements en cours ou termines, par famille. */
const pending = new Map<string, Promise<boolean>>();

/**
 * Rend une famille utilisable — dans le DOM **et** dans un canvas.
 *
 * Charge a la demande : le catalogue compte des dizaines de familles, les
 * telecharger toutes plomberait la page pour n'en servir qu'une ou deux.
 *
 * Renvoie `true` si au moins une graisse est reellement disponible. `false`
 * dit que le canvas dessinera dans une police de repli — l'appelant peut
 * alors le signaler plutot que de produire en silence une video qui ne
 * ressemble pas a l'apercu.
 */
export async function ensureFontLoaded(family: string, timeoutMs = 8000): Promise<boolean> {
  if (typeof document === 'undefined' || !family || family === 'sans-serif') return false;
  const cached = pending.get(family);
  if (cached) return cached;

  const def = findFont(family);
  // Famille hors catalogue (metadonnee d'un ancien post, saisie manuelle) :
  // on ne demande que le 400, la seule graisse que toute famille possede.
  // Reclamer 900 ferait repondre 400 a l'API et ne chargerait rien du tout.
  const weights = def?.weights ?? [400];

  const run = (async () => {
    if (!injected.has(family)) {
      injected.add(family);
      // La variable `next/font` ne sert QUE le DOM : `ctx.font` du canvas ne
      // sait pas la lire. La feuille Google enregistre la famille sous son
      // vrai nom, ce qui rend les deux rendus possibles.
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = googleFontsUrl(family, weights);
      link.dataset.font = family;
      document.head.appendChild(link);
    }

    const loads = weights.map((w) =>
      document.fonts.load(`${w} 48px "${family}"`).catch(() => []),
    );
    await Promise.race([
      Promise.all(loads).then(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);

    // On ne verifie QUE les graisses que la famille publie : demander 900 a
    // une Pacifico qui n'existe qu'en 400 ferait conclure a tort a un echec.
    const ok = weights.some((w) => document.fonts.check(`${w} 48px "${family}"`));
    if (!ok) console.warn(`[Fonts] « ${family} » indisponible — rendu en police de repli`);
    return ok;
  })();

  pending.set(family, run);
  return run;
}

/** Charge plusieurs familles de front, et dit lesquelles ont echoue. */
export async function ensureFontsLoaded(families: Array<string | undefined | null>): Promise<string[]> {
  const unique = [...new Set(families.filter((f): f is string => !!f && f !== 'sans-serif'))];
  const results = await Promise.all(unique.map((f) => ensureFontLoaded(f)));
  return unique.filter((_, i) => !results[i]);
}
