/**
 * A_3c2 — LE DOCUMENT ASS : un seul fichier, un seul filtre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN `node:fs` ICI NON PLUS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce module est atteint par `rendu-style`, lui-même atteint par des
 * composants CLIENT. Il FABRIQUE le texte du document ; c'est le moteur qui
 * l'écrit sur le disque. La même séparation que `rendu-texte` /
 * `rendu-polices`, et pour la même raison mesurée : une seule arête vers
 * `node:fs` fait échouer le build entier.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ RIEN DE CE QUE L'UTILISATEUR SAISIT N'EST UNE COMMANDE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le serveur écrit CHAQUE octet du document : l'en-tête, le style, les
 * balises. De l'extérieur n'arrivent que trois choses — un texte passé par
 * `echapperAss`, un identifiant d'animation cherché dans un catalogue, et
 * des nombres. Il n'existe aucun chemin par lequel une accroche puisse
 * devenir une balise, un style, ou un chemin de fichier.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA MISE EN PAGE EST CELLE DU TEXTE FINAL, DÈS LA PREMIÈRE IMAGE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Chaque événement porte le texte COMPLET. Ce qui n'est pas encore révélé
 * est rendu transparent, jamais absent : le mot « BOUGE » reste à sa place
 * pendant que « AVEC NOUS » apparaît derrière lui. Écrire les mots au fur et
 * à mesure les recentrerait à chaque étape, et le texte danserait.
 */
import {
  decouperContenu, couleurAss,
  type AnimationContenuCreative,
} from '@/lib/creatif/animations-contenu';
import type { HabillageTexte, PoliceRendu } from './rendu-texte';
import { HABILLAGE_HISTORIQUE } from './rendu-texte';

/**
 * ⚠️ UN NOM DE FAMILLE, PAS UN CHEMIN. libass résout la police par
 * fontconfig, dans le dossier que le moteur lui désigne — les trois familles
 * installées par `fonts-liberation`, et rien d'autre.
 */
export const POLICE_ASS: Record<PoliceRendu, string> = {
  sans: 'Liberation Sans',
  serif: 'Liberation Serif',
  mono: 'Liberation Mono',
};

const TEINTE_ASS = { noir: '&H000000&', blanc: '&HFFFFFF&' } as const;

/** Une couche animée dans son contenu, prête à devenir des événements. */
export interface CoucheAss {
  /** Le texte SAISI. Il ne va que dans le document, jamais dans le graphe. */
  texte: string;
  animation: AnimationContenuCreative;
  police: PoliceRendu;
  graisse: 'normale' | 'grasse';
  taillePx: number;
  couleur: string;
  /** Le centre de la ligne, en pixels du cadre — calculé comme pour drawtext. */
  xCentre: number;
  yCentre: number;
  debutSecondes: number;
  finSecondes: number;
  habillage?: HabillageTexte;
}

/** `h:mm:ss.cc` — le format de temps d'ASS, au centième près. */
export function tempsAss(secondes: number): string {
  const s = Math.max(0, secondes);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s - h * 3600 - m * 60;
  const cs = Math.min(59.99, Math.round(r * 100) / 100);
  const ent = Math.floor(cs);
  const cent = Math.round((cs - ent) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(ent).padStart(2, '0')}.${
    String(cent).padStart(2, '0')}`;
}

/** `&HAABBGGRR` — l'alpha d'ASS est INVERSÉ : 00 est opaque, FF transparent. */
function couleurAlphaAss(hex: string, opacite: number): string {
  const a = Math.round((1 - Math.min(1, Math.max(0, opacite))) * 255);
  const base = couleurAss(hex).replace(/^&H|&$/g, '');
  return `&H${a.toString(16).toUpperCase().padStart(2, '0')}${base}`;
}

/** Ce que voit un mot qui n'est pas encore révélé. */
const INVISIBLE = '{\\alpha&HFF&}';
const VISIBLE = '{\\alpha&H00&}';
/** Les mots déjà lus, quand un autre est mis en avant. */
const ATTENUE = '{\\alpha&H70&}';

/**
 * Le texte d'un événement : le texte COMPLET, avec ses balises de révélation.
 *
 * Fonction pure et exportée : c'est elle que le test d'échappement interroge,
 * et elle seule décide ce qui devient une balise.
 */
export function texteEvenement(
  anim: AnimationContenuCreative,
  unites: readonly string[], separateur: string,
  revelees: number, active: number, dureeFonduMs: number,
): string {
  const morceaux: string[] = [];
  for (let i = 0; i < unites.length; i += 1) {
    if (anim.revelation === 'surbrillance') {
      /* Tout est lisible du début à la fin ; SEULE l'intensité bouge. Une
         couleur d'accent serait un second choix de marque à faire quelque
         part — l'atténuation, elle, marche avec n'importe quelle couleur. */
      morceaux.push(i === active ? VISIBLE : ATTENUE);
    } else if (i < revelees - 1) {
      morceaux.push(VISIBLE);
    } else if (i === revelees - 1) {
      morceaux.push(anim.revelation === 'fondu'
        // `\t` anime DANS l'événement, en millisecondes depuis son début.
        ? `{\\alpha&HFF&\\t(0,${Math.round(dureeFonduMs)},\\alpha&H00&)}`
        : VISIBLE);
    } else {
      morceaux.push(INVISIBLE);
    }
    morceaux.push(unites[i]);
    if (separateur !== '' && i < unites.length - 1) morceaux.push(separateur);
  }
  return morceaux.join('');
}

/**
 * Le document complet.
 *
 * `PlayResX/Y` valent la taille du cadre : les coordonnées sont alors des
 * PIXELS, et `\pos` place la ligne exactement là où `drawtext` l'aurait mise.
 * Sans cela, libass mettrait à l'échelle depuis une résolution par défaut et
 * le texte animé ne serait pas au même endroit que le texte fixe.
 */
export function documentAss(
  cadre: { largeur: number; hauteur: number },
  couches: readonly CoucheAss[],
): string {
  const lignes: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${Math.round(cadre.largeur)}`,
    `PlayResY: ${Math.round(cadre.hauteur)}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,'
      + ' OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut,'
      + ' ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,'
      + ' Alignment, MarginL, MarginR, MarginV, Encoding',
  ];

  couches.forEach((c, i) => {
    const h = c.habillage ?? HABILLAGE_HISTORIQUE;
    /* ⚠️ LE FOND EST UN `BorderStyle: 3`, pas un rectangle dessiné. C'est la
       seule façon qu'a ASS de poser un pavé derrière le texte, et elle
       réutilise la couleur de contour — d'où le partage ci-dessous. */
    const boite = h.fond !== null;
    const contour = boite
      ? Math.max(1, Math.round(h.fond!.marge))
      : Math.max(0, Math.round(h.contour?.largeur ?? 0));
    const couleurContour = boite
      ? couleurAlphaAss(h.fond!.teinte === 'noir' ? '#000000' : '#ffffff', h.fond!.opacite)
      : TEINTE_ASS[h.contour?.teinte ?? 'noir'];
    const ombre = boite ? 0 : Math.max(0, Math.round(h.ombre?.decalage ?? 0));
    const couleurOmbre = couleurAlphaAss(
      (h.ombre?.teinte ?? 'noir') === 'noir' ? '#000000' : '#ffffff',
      h.ombre?.opacite ?? 0,
    );
    lignes.push([
      `Style: S${i}`, POLICE_ASS[c.police], String(Math.max(8, Math.round(c.taillePx))),
      couleurAss(c.couleur), couleurAss(c.couleur), couleurContour, couleurOmbre,
      c.graisse === 'grasse' ? '-1' : '0', '0', '0', '0',
      '100', '100', '0', '0',
      boite ? '3' : '1', String(contour), String(ombre),
      // 5 = centré dans les deux sens : `\pos` désigne alors le CENTRE de la
      // ligne, ce qui rend le placement indépendant de la longueur du texte.
      '5', '0', '0', '0', '1',
    ].join(','));
  });

  lignes.push('', '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  couches.forEach((c, i) => {
    /* ⚠️ AUCUN ÉCHAPPEMENT ICI : `decouperContenu` l'a déjà fait. Le refaire
       serait sans effet — les substitutions sont stables — mais surtout,
       l'échapper à deux endroits laisserait croire que l'un des deux suffit,
       et l'aperçu du navigateur ne passe QUE par le séquenceur. */
    const d = decouperContenu(c.animation, c.texte, c.debutSecondes, c.finSecondes);
    const pos = `{\\pos(${Math.round(c.xCentre)},${Math.round(c.yCentre)})}`;
    for (const e of d.etapes) {
      const fonduMs = Math.max(80, (e.finSecondes - e.debutSecondes) * 1000);
      const texte = texteEvenement(
        c.animation, d.unites, d.separateur, e.revelees, e.active, fonduMs,
      );
      lignes.push(`Dialogue: 0,${tempsAss(e.debutSecondes)},${tempsAss(e.finSecondes)},`
        + `S${i},,0,0,0,,${pos}${texte}`);
    }
  });

  return `${lignes.join('\n')}\n`;
}

/**
 * Le filtre `subtitles`, avec ses chemins échappés.
 *
 * ⚠️ LES DEUX-POINTS D'UN CHEMIN SÉPARENT DES OPTIONS. Un dossier temporaire
 * n'en contient pas aujourd'hui, mais s'en remettre à cela serait accepter
 * qu'un jour d'exploitation casse le graphe. Les deux chemins sont fabriqués
 * par le serveur ; ils sont quand même échappés.
 */
export function filtreSousTitres(fichierAss: string, dossierPolices: string | null): string {
  const ech = (p: string) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const morceaux = [`subtitles=filename='${ech(fichierAss)}'`];
  if (dossierPolices) morceaux.push(`fontsdir='${ech(dossierPolices)}'`);
  return morceaux.join(':');
}
