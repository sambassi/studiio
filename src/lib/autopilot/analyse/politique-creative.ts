/**
 * A_3e3 — CHOISIR LE STYLE D'UNE VIDÉO, SANS JAMAIS TIRER AU SORT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ `Math.random()` EST INTERDIT ICI, ET CE N'EST PAS UNE PRÉFÉRENCE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un rendu est REJOUÉ : le cron réessaie, un worker reprend, une génération
 * repart après une panne. Avec du hasard, chaque tentative produirait une
 * autre vidéo — et `lireRenduReussiIdentique`, qui évite de refaire ce qui
 * existe, ne retrouverait jamais rien.
 *
 * Le choix vient donc d'une GRAINE : même compte, même plan, même politique
 * → mêmes effets, toujours. La variété vient de ce qui change réellement
 * d'une vidéo à l'autre — le plan — et non d'un générateur.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LA POLITIQUE N'EST PAS LE CHOIX
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le profil du compte porte ce qui est PERMIS ; ce module en tire ce qui est
 * FAIT pour cette vidéo-ci. C'est ce profil EFFECTIF qui part au rendu, donc
 * qui entre dans l'identité — deux vidéos aux looks différents sont deux
 * fichiers différents, et c'est exactement ce qu'on veut.
 *
 * MODULE PUR : aucune base, aucun disque, aucun réseau, aucune horloge.
 */
import {
  FAMILLES_BIBLIOTHEQUE, VERSION_POLITIQUE_CREATIVE,
  type FamilleBibliotheque, type PolitiqueCreative,
} from '@/lib/creatif/bibliotheque';
import {
  appliquerPreset, presetStudiioParId, styleDepuisProfil,
  type BlocsCreatifs, type PresetPersonnel, type StylePreset,
} from '@/lib/creatif/presets';

/**
 * Le hachage de la graine — FNV-1a, 32 bits.
 *
 * ⚠️ IL N'A PAS BESOIN D'ÊTRE CRYPTOGRAPHIQUE, et il ne l'est pas. Il ne
 * protège rien : il répartit. `node:crypto` l'aurait rendu inutilisable dans
 * un aperçu de navigateur, pour une propriété dont personne n'a besoin ici.
 */
export function graineHachee(texte: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texte.length; i += 1) {
    h ^= texte.charCodeAt(i);
    // Le multiplicateur FNV, écrit en décalages : `*` déborderait le 32 bits.
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    h >>>= 0;
  }
  return h >>> 0;
}

/**
 * ⚠️ LA GRAINE NE PORTE AUCUN SECRET, mais elle porte un identifiant de
 * compte : elle ne doit donc JAMAIS être journalisée ni persistée telle
 * quelle. Ce qui remonte dans `usage`, c'est le RÉSULTAT, pas l'entrée.
 */
export function graineCreative(
  userId: string, planId: string, planVersion: number, version: string,
): string {
  return `${userId}|${planId}|${planVersion}|${version}`;
}

/** Ce qui a été retenu pour CETTE vidéo. */
export type ChoixCreatifs = Record<FamilleBibliotheque, string>;

/** La signature d'une combinaison — ce qui la rend reconnaissable. */
export function signatureCreative(choix: ChoixCreatifs): string {
  return FAMILLES_BIBLIOTHEQUE.map((f) => choix[f]).join('|');
}

/**
 * ⚠️ LE COÛT D'UN EFFET RÉCENT, ET POURQUOI IL EST GRADUÉ.
 *
 * Sans pénalité, la même transition reviendrait sur toutes les vidéos même en
 * variant les looks : la graine change, mais rien ne pousse à s'éloigner de
 * ce qu'on vient de voir. Une pénalité PLATE, elle, interdirait purement tout
 * ce qui a servi — et avec deux effets autorisés, plus rien ne serait
 * choisissable. Le coût décroît donc avec l'ancienneté : très cher hier,
 * gratuit après dix vidéos.
 */
export const PENALITE_RECENCE = 40_000;
export const HISTORIQUE_MAX = 10;
/** Combien de combinaisons on essaie avant d'accepter une répétition. */
export const VARIANTES_MAX = 8;

const ESPACE = 100_000;

function scoreCandidat(
  graine: string, variante: number, famille: FamilleBibliotheque,
  id: string, recents: readonly string[],
): number {
  const base = graineHachee(`${graine}|${variante}|${famille}|${id}`) % ESPACE;
  const rang = recents.indexOf(id);
  if (rang < 0) return base;
  // `rang` 0 = la dernière vidéo. Plus c'est frais, plus c'est cher.
  return base - Math.round((PENALITE_RECENCE * (HISTORIQUE_MAX - rang)) / HISTORIQUE_MAX);
}

/**
 * Le meilleur candidat d'une famille — déterministe, à égalité près.
 *
 * ⚠️ L'ÉGALITÉ EST TRANCHÉE PAR L'ORDRE DE LA LISTE, jamais laissée au
 * hasard du tri : deux exécutions doivent rendre le même identifiant même
 * quand deux scores se rejoignent.
 */
function meilleur(
  graine: string, variante: number, famille: FamilleBibliotheque,
  candidats: readonly string[], recents: readonly string[],
): string {
  let gagnant = candidats[0];
  let meilleurScore = scoreCandidat(graine, variante, famille, gagnant, recents);
  for (const id of candidats.slice(1)) {
    const s = scoreCandidat(graine, variante, famille, id, recents);
    if (s > meilleurScore) { gagnant = id; meilleurScore = s; }
  }
  return gagnant;
}

export interface ContexteVariation {
  graine: string;
  /** Les signatures des derniers montages, le plus récent d'abord. */
  historique: readonly ChoixCreatifs[];
}

export interface IssueVariation<T extends BlocsCreatifs> {
  profil: T;
  choix: ChoixCreatifs;
  /**
   * Pourquoi ces choix — une phrase courte, en français, sans identifiant de
   * compte. Elle part dans `usage` : le jour où quelqu'un demande « pourquoi
   * ce look ? », la réponse existe déjà.
   */
  raison: string;
  /** `false` en marque stricte : rien n'a été choisi, tout était fixé. */
  varie: boolean;
}

/**
 * Le style EFFECTIF de cette vidéo.
 *
 * ⚠️ EN MARQUE STRICTE, IL NE SE PASSE RIEN. Ce n'est pas un cas d'erreur ni
 * une répétition à corriger : c'est le mode qui dit « toujours pareil », et
 * l'anti-répétition n'a pas à le contredire.
 */
export function resoudreStyleEffectif<T extends BlocsCreatifs>(
  profil: T,
  politique: PolitiqueCreative,
  presetsPersonnels: readonly PresetPersonnel[],
  ctx: ContexteVariation,
): IssueVariation<T> {
  const courant = styleDepuisProfil(profil);
  const choixCourant = choixDepuisStyle(courant);

  if (politique.mode === 'marque-stricte') {
    return {
      profil, choix: choixCourant, varie: false,
      raison: 'Marque stricte : les choix du compte, sans variation.',
    };
  }

  if (politique.mode === 'varier-presets') {
    return varierPresets(profil, politique, presetsPersonnels, ctx, choixCourant);
  }
  return varierElements(profil, politique, ctx, choixCourant);
}

function choixDepuisStyle(style: StylePreset): ChoixCreatifs {
  return {
    lut: style.lutId,
    styleTexte: style.styleTexteId,
    animationBloc: style.animationBlocId,
    animationContenu: style.animationContenuId,
    transition: style.transitionId,
  };
}

function styleDepuisChoix(base: StylePreset, choix: ChoixCreatifs): StylePreset {
  return {
    ...base,
    lutId: choix.lut,
    styleTexteId: choix.styleTexte,
    animationBlocId: choix.animationBloc,
    animationContenuId: choix.animationContenu,
    transitionId: choix.transition,
  };
}

function varierElements<T extends BlocsCreatifs>(
  profil: T, politique: PolitiqueCreative,
  ctx: ContexteVariation, choixCourant: ChoixCreatifs,
): IssueVariation<T> {
  /* ⚠️ UNE LISTE VIDE NE BLOQUE PAS : elle veut dire « ne varie pas ça ».
     Le choix actif du compte reste alors le seul candidat, ce qui est
     exactement ce qu'une personne attend en n'ayant rien coché. */
  const candidats = {} as Record<FamilleBibliotheque, readonly string[]>;
  let familles = 0;
  for (const f of FAMILLES_BIBLIOTHEQUE) {
    const permis = politique.autorises[f];
    candidats[f] = permis.length > 0 ? permis : [choixCourant[f]];
    if (candidats[f].length > 1) familles += 1;
  }

  const recents = recentsParFamille(ctx.historique);
  const vues = new Set(ctx.historique.slice(0, HISTORIQUE_MAX).map(signatureCreative));

  let choix = choixCourant;
  let variante = 0;
  let repete = false;
  for (; variante < VARIANTES_MAX; variante += 1) {
    const essai = {} as ChoixCreatifs;
    for (const f of FAMILLES_BIBLIOTHEQUE) {
      essai[f] = meilleur(ctx.graine, variante, f, candidats[f], recents[f]);
    }
    choix = essai;
    if (!vues.has(signatureCreative(essai))) break;
  }
  if (variante >= VARIANTES_MAX) repete = true;

  const base = styleDepuisProfil(profil);
  const style = styleDepuisChoix(base, choix);
  return {
    profil: appliquerPreset(profil, style),
    choix,
    varie: familles > 0,
    raison: repete
      // On le DIT plutôt que d'imposer un effet non autorisé pour éviter une
      // répétition : c'est la liste de la personne qui décide, pas nous.
      ? `Choisi parmi ${familles} familles autorisées ; toutes les combinaisons `
        + 'possibles ont déjà servi récemment.'
      : `Choisi parmi ${familles} familles autorisées, en évitant les `
        + `${Math.min(vues.size, HISTORIQUE_MAX)} dernières combinaisons.`,
  };
}

function varierPresets<T extends BlocsCreatifs>(
  profil: T, politique: PolitiqueCreative,
  presetsPersonnels: readonly PresetPersonnel[],
  ctx: ContexteVariation, choixCourant: ChoixCreatifs,
): IssueVariation<T> {
  const styles: { id: string; style: StylePreset }[] = [];
  for (const id of politique.presetsAutorises) {
    const studiio = presetStudiioParId(id);
    if (studiio) { styles.push({ id, style: studiio.style }); continue; }
    const mien = presetsPersonnels.find((x) => x.id === id);
    if (mien) styles.push({ id, style: mien.style });
  }

  /* Aucun preset retenu — ou tous supprimés depuis : on garde le style du
     compte. Choisir à sa place serait pire que ne rien changer. */
  if (styles.length === 0) {
    return {
      profil, choix: choixCourant, varie: false,
      raison: 'Aucun preset autorisé n’est encore disponible : style du compte conservé.',
    };
  }

  const vues = new Set(ctx.historique.slice(0, HISTORIQUE_MAX).map(signatureCreative));
  const recentsPresets = ctx.historique
    .map((h) => styles.find((s) => signatureCreative(choixDepuisStyle(s.style))
      === signatureCreative(h))?.id)
    .filter((x): x is string => x !== undefined);

  let retenu = styles[0];
  for (let variante = 0; variante < VARIANTES_MAX; variante += 1) {
    const id = meilleur(
      ctx.graine, variante, 'lut', styles.map((s) => s.id), recentsPresets,
    );
    retenu = styles.find((s) => s.id === id) ?? styles[0];
    if (!vues.has(signatureCreative(choixDepuisStyle(retenu.style)))) break;
  }

  return {
    profil: appliquerPreset(profil, retenu.style),
    choix: choixDepuisStyle(retenu.style),
    varie: styles.length > 1,
    raison: `Choisi parmi ${styles.length} preset(s) autorisé(s).`,
  };
}

/** Les identifiants récents de chaque famille, le plus récent d'abord. */
function recentsParFamille(
  historique: readonly ChoixCreatifs[],
): Record<FamilleBibliotheque, readonly string[]> {
  const sortie = {} as Record<FamilleBibliotheque, readonly string[]>;
  for (const f of FAMILLES_BIBLIOTHEQUE) {
    const vus = new Set<string>();
    const liste: string[] = [];
    for (const h of historique.slice(0, HISTORIQUE_MAX)) {
      const v = h[f];
      if (typeof v !== 'string' || vus.has(v)) continue;
      vus.add(v); liste.push(v);
    }
    sortie[f] = liste;
  }
  return sortie;
}

/** L'historique, lu depuis les `usage.creatif` des derniers montages. */
export function historiqueDepuisUsages(
  usages: readonly Record<string, unknown>[],
): ChoixCreatifs[] {
  const sortie: ChoixCreatifs[] = [];
  for (const u of usages) {
    const c = u?.creatif;
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    const lu = (v: unknown) => (typeof v === 'string' ? v : '');
    sortie.push({
      lut: lu(o.lutId),
      styleTexte: lu(o.styleTexteId),
      animationBloc: lu(o.animationBlocId),
      animationContenu: lu(o.animationContenuId),
      transition: lu(o.transitionId),
    });
  }
  return sortie;
}

export { VERSION_POLITIQUE_CREATIVE };
