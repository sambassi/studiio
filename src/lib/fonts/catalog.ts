'use client';

/**
 * Le catalogue de polices, COTE NAVIGATEUR.
 *
 * ⚠️ LES DONNEES NE SONT PLUS ICI. Elles vivent dans `./catalog-data`, qui est
 * pur et lisible par le serveur ; ce fichier les re-exporte pour que les
 * quelque dix composants qui importent deja `@/lib/fonts/catalog` n'aient rien
 * a changer, et il y ajoute ce qui n'a de sens que dans un navigateur :
 * insertion de la feuille Google Fonts, attente de son analyse, verification
 * des `FontFace` reellement obtenues.
 *
 * ⚠️ UN MODULE SERVEUR NE DOIT PAS IMPORTER D'ICI, MEME POUR UNE DONNEE.
 * La re-exportation ne change rien a la frontiere : Next rend une reference
 * client pour tout ce qui traverse un module `'use client'`. Le serveur importe
 * `@/lib/fonts/catalog-data`. Un test verifie que les deux modules du contrat
 * Autopilote le font.
 *
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

export {
  FONT_GROUP_LABELS,
  FONT_CATALOG,
  FONT_GROUPS,
  findFont,
  fontStack,
  googleFontsUrl,
  fontVariablesCss,
  googleFontsUrlMany,
} from './catalog-data';
export type { FontGroup, FontDef } from './catalog-data';

import { FONT_CATALOG, findFont, googleFontsUrl } from './catalog-data';

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
