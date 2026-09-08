/**
 * A_1 — DU TEXTE RÉEL DANS LE RENDU M3.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EXISTAIT, ET CE QUI MANQUAIT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le profil créatif savait déjà STOCKER `texte.titre`, `texte.sousTitre`,
 * `texte.libre`, leur position et leur durée — validés, persistés, et
 * consommés par PERSONNE. Le CTA, lui, était un bandeau coloré sans un mot
 * dedans : l'écran l'appelait d'ailleurs « Bandeau de fin » et prévenait que
 * « le texte arrivera plus tard ». C'était un réglage qui ne réglait rien.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE VALEUR UTILISATEUR NE DEVIENT DE LA SYNTAXE FFMPEG
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `drawtext` accepte `text=…` dans le graphe de filtres, et c'est un piège :
 * `:` sépare les options, `,` et `;` séparent les filtres, `'` délimite,
 * `\` échappe, et `%{…}` est un langage d'expansion. Un texte comme
 * « Réserve : 50% de remise, c'est aujourd'hui ! » casse le graphe — ou pire,
 * en change le sens sans rien casser.
 *
 * On n'échappe donc RIEN : le texte part dans un FICHIER (`textfile=`), et
 * l'expansion est coupée (`expansion=none`). Ce qui entre dans le graphe est
 * un chemin que nous fabriquons, des nombres, et des couleurs validées. Il
 * n'existe aucun chemin par lequel un caractère saisi puisse être lu comme
 * une instruction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES POLICES SONT UN CATALOGUE, JAMAIS UN CHEMIN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `fontfile=` prend un chemin absolu. L'accepter depuis un réglage
 * utilisateur donnerait la lecture d'un fichier arbitraire du serveur. Le
 * profil ne porte donc qu'un IDENTIFIANT, résolu ici vers l'un des trois
 * fichiers installés par `fonts-liberation` dans l'image — et rien d'autre.
 */

import { styleTexteParId } from '@/lib/creatif/styles-texte';
import {
  animationTexteParId, type ExpressionsAnimation,
} from '@/lib/creatif/animations-texte';

/** Les familles réellement présentes dans l'image (paquet `fonts-liberation`). */
export const POLICES_RENDU = ['sans', 'serif', 'mono'] as const;
export type PoliceRendu = (typeof POLICES_RENDU)[number];

/*
 * ⚠️ AUCUN `node:fs` DANS CE MODULE, ET C'EST STRUCTUREL.
 *
 * `rendu-style` l'importe, et `rendu-style` est atteint — de proche en proche
 * — par `AutopilotPanel` et `AssistantWizard`, deux composants CLIENT. Une
 * seule arête vers `node:fs` fait donc échouer le build entier :
 *
 *   Module build failed: UnhandledSchemeError: Reading from "node:fs" is not
 *   handled by plugins (Unhandled scheme).
 *
 * Mesuré sur ce lot, pas supposé. La résolution du FICHIER de police — la
 * seule chose qui ait besoin du disque — vit donc dans `rendu-polices.ts`,
 * que seul le serveur importe. Ce module-ci ne manipule que des noms, des
 * nombres et des chaînes.
 */

/** Les cinq natures de texte que ce lot sait rendre. Liste fermée. */
export const NATURES_TEXTE = ['hook', 'titre', 'cta', 'lien', 'fin'] as const;
export type NatureTexte = (typeof NATURES_TEXTE)[number];

/**
 * Les longueurs maximales, par nature.
 *
 * ⚠️ BORNÉES ICI, PAS À L'ÉCRAN. Deux mille caractères ne « débordent » pas :
 * ils couvrent l'image, et la vidéo est perdue. La borne est courte
 * volontairement — un hook de quatre-vingts caractères est déjà une phrase
 * qu'on ne lit pas en trois secondes.
 */
export const LONGUEURS_MAX: Record<NatureTexte, number> = {
  hook: 80, titre: 80, cta: 60, lien: 60, fin: 60,
};

/** Ce qu'un style de texte ajoute à une couche. Toutes options réelles. */
export interface HabillageTexte {
  /** `borderw` + `bordercolor`. */
  contour: { largeur: number; teinte: 'noir' | 'blanc' } | null;
  /** `shadowx/y` + `shadowcolor`. */
  ombre: { decalage: number; opacite: number; teinte: 'noir' | 'blanc' } | null;
  /** `box` + `boxcolor` + `boxborderw`. */
  fond: { opacite: number; marge: number; teinte: 'noir' | 'blanc' } | null;
}

export interface CoucheTexte {
  nature: NatureTexte;
  texte: string;
  police: PoliceRendu;
  graisse: 'normale' | 'grasse';
  /** En part de la HAUTEUR du cadre : la même valeur tient en 9:16 comme en 16:9. */
  taillePct: number;
  couleur: string;
  ancre: 'haut' | 'centre' | 'bas';
  debutSecondes: number;
  finSecondes: number;
  /** L'habillage du style choisi. Absent = l'ombre douce historique. */
  habillage?: HabillageTexte;
  /**
   * L'animation choisie. Absente = le texte apparaît net, comme avant A_3c.
   *
   * ⚠️ UN IDENTIFIANT, JAMAIS UNE EXPRESSION. Les expressions ffmpeg sont
   * fabriquées côté serveur à partir de ce nom ; en accepter une serait
   * exécuter un langage reçu du navigateur.
   */
  animationId?: string;
}

/** L'habillage d'avant A_3b : l'ombre douce, et rien d'autre. */
export const HABILLAGE_HISTORIQUE: HabillageTexte = {
  contour: null,
  ombre: { decalage: 2, opacite: 0.65, teinte: 'noir' },
  fond: null,
};

const HEX_AIDE = { noir: '0x000000', blanc: '0xffffff' } as const;

/** Une couleur `#rrggbb` — la seule forme que le profil produit. */
export function couleurValide(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/**
 * Le texte retenu, ou `null`.
 *
 * ⚠️ UN TEXTE VIDE N'EST PAS UN TEXTE. Rendre une chaîne blanche dessinerait
 * une couche invisible — et, pour le lien, réserverait une ligne vide sous le
 * CTA. On coupe ici, une fois, plutôt que de vérifier partout ensuite.
 */
export function texteRetenu(brut: unknown, nature: NatureTexte): string | null {
  if (typeof brut !== 'string') return null;
  /* Les caractères de contrôle sortent : `textfile` les rendrait tels quels,
     et une tabulation dans un hook est un accident, jamais une intention. */
  const propre = brut
    .split('').filter((c) => c.charCodeAt(0) >= 32 || c === ' ').join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (propre === '') return null;
  // ⚠️ ON TRONQUE, ON NE REFUSE PAS : un hook trop long reste un hook, et
  // refuser le rendu entier pour deux mots de trop serait disproportionné.
  return propre.length > LONGUEURS_MAX[nature]
    ? propre.slice(0, LONGUEURS_MAX[nature])
    : propre;
}

/**
 * La position verticale, en pixels.
 *
 * ⚠️ CALCULÉE DEPUIS LES MARGES SÛRES, jamais depuis des coordonnées pensées
 * pour 1080×1920. La même ancre doit tomber au bon endroit en 9:16, en 16:9
 * et en 1:1 — sinon un compte qui change de format découvre son hook sous le
 * bord de l'écran.
 */
export function positionY(
  ancre: CoucheTexte['ancre'], hauteurCadre: number, hauteurTexte: number,
  marges: { haut: number; bas: number },
): number {
  const bas = hauteurCadre - marges.bas - hauteurTexte;
  const y = ancre === 'haut' ? marges.haut
    : ancre === 'centre' ? Math.round((hauteurCadre - hauteurTexte) / 2)
      : bas;
  return Math.max(marges.haut, Math.min(y, Math.max(marges.haut, bas)));
}

/**
 * Le filtre `drawtext` d'une couche.
 *
 * Tout ce qui entre ici est soit fabriqué par nous (le chemin du fichier
 * texte, celui de la police), soit un nombre, soit une couleur déjà validée.
 * `textfile` + `expansion=none` ferment la question de l'échappement.
 */
export function filtreDrawtext(o: {
  fichierTexte: string;
  fichierPolice: string;
  taillePx: number;
  couleur: string;
  y: number;
  debutSecondes: number;
  finSecondes: number;
  habillage?: HabillageTexte;
  /** Les expressions déjà calculées par `expressionsAnimation`. */
  animation?: ExpressionsAnimation;
}): string {
  const hex = `0x${o.couleur.slice(1).toLowerCase()}`;
  /* `x=(w-text_w)/2` : centré horizontalement, calculé par ffmpeg sur la
     largeur RÉELLE du texte rendu — la seule façon de centrer sans mesurer
     la police nous-mêmes. */
  const h = o.habillage ?? HABILLAGE_HISTORIQUE;
  const morceaux = [
    `drawtext=textfile='${o.fichierTexte}'`,
    'expansion=none',
    `fontfile='${o.fichierPolice}'`,
    `fontsize=${Math.round(o.taillePx)}`,
    `fontcolor=${hex}`,
  ];
  /* ⚠️ TROIS AIDES À LA LISIBILITÉ, ET AUCUNE COULEUR DE MARQUE.
     Contour, ombre et fond sont noirs ou blancs : ils servent à LIRE le
     texte sur une image quelconque. La couleur du texte, elle, reste celle
     du compte — un style qui la repeindrait ferait perdre son identité au
     compte pour un choix de forme. */
  if (h.contour) {
    morceaux.push(`borderw=${Math.max(0, Math.round(h.contour.largeur))}`);
    morceaux.push(`bordercolor=${HEX_AIDE[h.contour.teinte]}`);
  }
  if (h.ombre) {
    const d = Math.max(0, Math.round(h.ombre.decalage));
    morceaux.push(`shadowcolor=${HEX_AIDE[h.ombre.teinte]}@${
      Math.min(1, Math.max(0, h.ombre.opacite)).toFixed(2)}`);
    morceaux.push(`shadowx=${d}`, `shadowy=${d}`);
  }
  if (h.fond) {
    morceaux.push('box=1');
    morceaux.push(`boxcolor=${HEX_AIDE[h.fond.teinte]}@${
      Math.min(1, Math.max(0, h.fond.opacite)).toFixed(2)}`);
    morceaux.push(`boxborderw=${Math.max(0, Math.round(h.fond.marge))}`);
  }
  /* ⚠️ LES EXPRESSIONS REMPLACENT LES CONSTANTES, elles ne s'y ajoutent pas.
     `x`, `y` et `fontsize` sont déjà posés plus haut en valeurs fixes ;
     écrire les deux ferait gagner la dernière occurrence, ce qui marcherait
     par accident et casserait au premier réordonnancement. */
  const anim = o.animation ?? { alpha: null, x: null, y: null, fontsize: null };
  if (anim.fontsize) {
    const i = morceaux.findIndex((m) => m.startsWith('fontsize='));
    if (i >= 0) morceaux[i] = `fontsize=${anim.fontsize}`;
  }
  if (anim.alpha) morceaux.push(`alpha='${anim.alpha}'`);
  morceaux.push(
    anim.x ? `x='${anim.x}'` : 'x=(w-text_w)/2',
    anim.y ? `y='${anim.y}'` : `y=${Math.round(o.y)}`,
    `enable='between(t\\,${o.debutSecondes.toFixed(3)}\\,${o.finSecondes.toFixed(3)})'`,
  );
  return morceaux.join(':');
}

// ─────────────────────────────────────────────────────────────────────────
// DU PROFIL AUX COUCHES
// ─────────────────────────────────────────────────────────────────────────

/** La taille d'un texte, en part de la hauteur du cadre. */
const TAILLE_PCT: Record<NatureTexte, number> = {
  hook: 6.5, titre: 5.5, cta: 4.5, lien: 3.2, fin: 4.5,
};

/**
 * La police d'une nature, résolue depuis la typographie du profil.
 *
 * ⚠️ LE CATALOGUE DU PROFIL EST CELUI DE L'ÉCRAN (« Anton », « Syne »…), et
 * l'image serveur ne porte que trois familles. On ne fabrique donc pas un
 * chemin à partir du nom : on RANGE le nom dans l'une des trois familles
 * disponibles. Un profil qui demande une police absente reçoit `sans`, pas un
 * échec de rendu — et surtout pas un chemin deviné.
 */
export function policeDe(policeId: string | null | undefined): PoliceRendu {
  const id = (policeId ?? '').toLowerCase();
  if (id.includes('mono') || id.includes('space') || id.includes('courier')) return 'mono';
  if (id.includes('serif') || id.includes('georgia') || id.includes('times')) return 'serif';
  return 'sans';
}

export interface SourcesTexte {
  /** Le profil créatif du compte. */
  profil: {
    typographie: {
      policeTitreId: string | null; policeTexteId: string | null;
      graisse: 'normale' | 'grasse';
      /**
       * Le style de texte choisi dans la bibliothèque.
       *
       * ⚠️ ABSENT = LE RENDU D'AVANT A_3b, au pixel près. Un compte qui n'a
       * jamais ouvert la bibliothèque ne doit rien voir changer.
       */
      styleTexteId?: string | null;
    };
    couleurs: { primaire: string | null; accent: string | null; texte: string | null };
    texte: {
      actif: boolean; titre: string | null; sousTitre: string | null;
      libre: string | null; position: 'haut' | 'centre' | 'bas';
      debutSecondes: number; dureeSecondes: number;
    };
    ctaVisuel: {
      actif: boolean; dureeSecondes: number; position: 'haut' | 'centre' | 'bas';
    };
    /** Le bloc `animations` du profil. Absent = aucune animation. */
    animations?: { texteId?: string | null };
  } | null;
  /**
   * Ce que le CTA DIT, et où il mène.
   *
   * ⚠️ CELA VIENT DE L'OBJECTIF, PAS DU STYLE, et le dépôt le dit déjà :
   * changer « Réserve ta place » ne doit pas obliger à rejouer un style, et
   * changer la couleur d'un bandeau ne doit pas rejouer un montage.
   */
  appelAction: { texte: string | null; destination: string | null } | null;
  dureeTotaleSecondes: number;
}

/**
 * Les couches à dessiner, dans l'ordre, déjà validées et bornées.
 *
 * Fonction PURE : aucun accès disque, aucun ffmpeg. C'est ce qui permet de la
 * tester sur les cas tordus — apostrophes, deux-points, textes trop longs,
 * couleurs invalides — sans lancer un encodage.
 */
export function preparerCouches(s: SourcesTexte): CoucheTexte[] {
  const p = s.profil;
  if (!p) return [];
  /* ⚠️ LE STYLE EST RÉSOLU UNE FOIS, ICI. L'écran et le moteur appellent
     cette même fonction : un style qui serait relu ailleurs finirait par
     être interprété deux fois, et l'aperçu montrerait autre chose que la
     vidéo. Un identifiant inconnu retombe sur le style par défaut, qui
     reproduit exactement le rendu d'avant ce lot. */
  const style = styleTexteParId(p.typographie.styleTexteId);
  const habillage: HabillageTexte = {
    contour: style.contour, ombre: style.ombre, fond: style.fond,
  };
  /* La casse s'applique au TEXTE, pas à son apparence : `drawtext` ne sait
     pas mettre en capitales, et le fichier doit donc déjà l'être. */
  const casser = (t: string) => (style.casse === 'majuscules' ? t.toLocaleUpperCase('fr') : t);
  /* L'animation est GLOBALE au profil : une par couche demanderait quatre
     réglages là où une personne en veut un, et le contrat pourra toujours
     s'étendre sans casser celui-ci. */
  const animationId = animationTexteParId(p.animations?.texteId).id;
  const taille = (base: number) => base * style.echelle;
  const couches: CoucheTexte[] = [];
  const duree = Number.isFinite(s.dureeTotaleSecondes) && s.dureeTotaleSecondes > 0
    ? s.dureeTotaleSecondes : 0;
  if (duree <= 0) return [];

  const couleurTexte = couleurValide(p.couleurs.texte) ? p.couleurs.texte : '#ffffff';
  const couleurAccent = couleurValide(p.couleurs.accent)
    ? p.couleurs.accent
    : couleurValide(p.couleurs.primaire) ? p.couleurs.primaire : '#ffffff';

  // ── Les textes de marque, si le bloc est actif ──────────────────────
  if (p.texte.actif) {
    const debut = Math.max(0, Math.min(p.texte.debutSecondes, duree));
    const fin = Math.max(debut, Math.min(debut + Math.max(0, p.texte.dureeSecondes), duree));
    const police = style.police;
    for (const [nature, brut] of [
      ['hook', p.texte.titre], ['titre', p.texte.sousTitre],
    ] as const) {
      const texte = texteRetenu(brut, nature);
      if (texte === null) continue;
      couches.push({
        nature,
        texte: casser(texte),
        police,
        graisse: style.graisse,
        taillePct: taille(TAILLE_PCT[nature]),
        habillage,
        animationId,
        couleur: couleurTexte,
        ancre: p.texte.position,
        debutSecondes: debut,
        finSecondes: fin,
      });
    }
    /* Le texte de FIN : les dernières secondes, et elles seules. Il partage
       la durée du bloc, mais pas son début — sinon « Places limitées »
       s'afficherait sur le premier plan. */
    const texteFin = texteRetenu(p.texte.libre, 'fin');
    if (texteFin !== null) {
      const depart = Math.max(
        0, duree - Math.max(0.5, Math.min(p.texte.dureeSecondes, duree)),
      );
      couches.push({
        nature: 'fin',
        texte: casser(texteFin),
        police,
        graisse: style.graisse,
        taillePct: taille(TAILLE_PCT.fin),
        habillage,
        animationId,
        couleur: couleurTexte,
        ancre: 'centre',
        debutSecondes: depart,
        finSecondes: duree,
      });
    }
  }

  // ── Le CTA : le bandeau existait, il parle enfin ────────────────────
  //
  // ⚠️ AUCUN CTA INVENTÉ. Si le bandeau est inactif, ou si l'objectif ne
  // porte aucun texte, rien n'est dessiné : ce lot RESTITUE ce que la
  // personne a écrit, il n'écrit pas à sa place.
  if (p.ctaVisuel.actif && s.appelAction) {
    const dureeCta = Math.max(0, Math.min(p.ctaVisuel.dureeSecondes, duree));
    const depart = Math.max(0, duree - dureeCta);
    const police = style.police;

    const texteCta = texteRetenu(s.appelAction.texte, 'cta');
    if (texteCta !== null) {
      couches.push({
        nature: 'cta',
        texte: casser(texteCta),
        police,
        graisse: 'grasse',
        taillePct: taille(TAILLE_PCT.cta),
        habillage,
        animationId,
        couleur: couleurTexte,
        ancre: p.ctaVisuel.position,
        debutSecondes: depart,
        finSecondes: duree,
      });
    }
    const lien = texteRetenu(s.appelAction.destination, 'lien');
    if (lien !== null) {
      couches.push({
        nature: 'lien',
        texte: lien,
        police,
        graisse: 'normale',
        taillePct: taille(TAILLE_PCT.lien),
        habillage,
        animationId,
        couleur: couleurAccent,
        ancre: p.ctaVisuel.position,
        debutSecondes: depart,
        finSecondes: duree,
      });
    }
  }
  return couches;
}

/**
 * L'empreinte des couches — ce qui les fait entrer dans l'identité du rendu.
 *
 * ⚠️ SANS ELLE, CHANGER UN TEXTE NE CHANGERAIT RIEN À L'ÉCRAN. Un rendu est
 * réutilisé quand son identité est la même ; or le texte du CTA vient de
 * l'OBJECTIF, donc ne passe pas par le profil, donc pas par `methodeRendu`.
 * On rendrait alors la vidéo d'hier, avec l'ancien texte, sans qu'aucune
 * erreur ne le dise — la pire des pannes, celle qui ne se voit pas.
 */
export function empreinteCouches(couches: readonly CoucheTexte[]): string {
  if (couches.length === 0) return '';
  return couches.map((c) => [
    c.nature, c.texte, c.police, c.graisse, String(c.taillePct), c.couleur,
    c.ancre, c.debutSecondes.toFixed(3), c.finSecondes.toFixed(3),
    // L'habillage change les pixels : il change donc l'empreinte.
    JSON.stringify(c.habillage ?? null),
    // L'animation change les pixels image par image.
    c.animationId ?? '',
  ].join('')).join('');
}
