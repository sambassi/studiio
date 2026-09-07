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
}

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
}): string {
  const hex = `0x${o.couleur.slice(1).toLowerCase()}`;
  /* `x=(w-text_w)/2` : centré horizontalement, calculé par ffmpeg sur la
     largeur RÉELLE du texte rendu — la seule façon de centrer sans mesurer
     la police nous-mêmes. */
  return [
    `drawtext=textfile='${o.fichierTexte}'`,
    'expansion=none',
    `fontfile='${o.fichierPolice}'`,
    `fontsize=${Math.round(o.taillePx)}`,
    `fontcolor=${hex}`,
    // ⚠️ LA LISIBILITÉ, SANS DEVINER LE FOND. Une ombre portée coûte deux
    // paramètres et sauve un texte clair sur une image claire ; deviner la
    // couleur du fond image par image serait un autre lot.
    'shadowcolor=0x000000@0.65',
    'shadowx=2',
    'shadowy=2',
    'x=(w-text_w)/2',
    `y=${Math.round(o.y)}`,
    `enable='between(t\\,${o.debutSecondes.toFixed(3)}\\,${o.finSecondes.toFixed(3)})'`,
  ].join(':');
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
    const police = policeDe(p.typographie.policeTitreId ?? p.typographie.policeTexteId);
    for (const [nature, brut] of [
      ['hook', p.texte.titre], ['titre', p.texte.sousTitre],
    ] as const) {
      const texte = texteRetenu(brut, nature);
      if (texte === null) continue;
      couches.push({
        nature,
        texte,
        police,
        graisse: p.typographie.graisse,
        taillePct: TAILLE_PCT[nature],
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
        texte: texteFin,
        police,
        graisse: p.typographie.graisse,
        taillePct: TAILLE_PCT.fin,
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
    const police = policeDe(p.typographie.policeTexteId ?? p.typographie.policeTitreId);

    const texteCta = texteRetenu(s.appelAction.texte, 'cta');
    if (texteCta !== null) {
      couches.push({
        nature: 'cta',
        texte: texteCta,
        police,
        graisse: 'grasse',
        taillePct: TAILLE_PCT.cta,
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
        taillePct: TAILLE_PCT.lien,
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
  ].join('')).join('');
}
