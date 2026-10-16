/**
 * A5 — LES DURÉES DE SÉQUENCES D'UN MONTAGE-JUMEAU — une seule source de
 * vérité, PURE (aucun réseau, aucune base), importable côté client.
 *
 * `buildAutopilotDesign` (le rendu final) ET l'aperçu de l'Autopilote
 * (`AutopilotPreview`) appellent `dureesMontageJumeau` : l'aperçu ne peut plus
 * jouer 4 + 6 + 6 + 4 s quand la vidéo finale fera 4 + 6 + parole + 4 s.
 *
 * Avant la génération du jumeau (cas de l'aperçu : le jumeau d'un montage
 * n'existe qu'au créneau), la parole est ESTIMÉE par `estimerParoleJumeau` :
 * le script que le montage fera dire (`scriptJumeauMontage`) au débit du
 * rythme du brief — le débit qui dimensionne déjà ce script. La vidéo finale
 * prend la durée MESURÉE du jumeau (`mesurerDureeJumeau`) : l'aperçu le dit.
 */
import { auDixiemeSuperieur, enveloppeAutourDuJumeau } from '@/lib/autopilot/duree-cible';
import { DEFAULT_SEQUENCE_SECONDS, RUSH_SEQUENCE_SECONDS } from '@/lib/creer/designSpec';
import { TRANSITION_DURATION_SECONDS } from '@/lib/creer/transitionPreview';
import { CARACTERES_PAR_SECONDE, type RythmeBrief } from '@/lib/creer/brief';

export interface DureesMontage {
  intro: number;
  cards: number;
  video: number;
  cta: number;
}

/**
 * La séquence « Vidéo » du jumeau : SA parole au dixième supérieur (A4), plus
 * le fondu de sortie (A3 : le raccord vers le CTA se joue dans ses 0,8
 * dernières secondes, jamais sur ses derniers mots).
 */
export function dureeSequenceJumeau(paroleSecondes: number): number {
  return Math.max(
    DEFAULT_SEQUENCE_SECONDS.video,
    Math.round((auDixiemeSuperieur(paroleSecondes) + TRANSITION_DURATION_SECONDS) * 10) / 10,
  );
}

/**
 * Durées titre / cartes / vidéo / CTA d'un montage où le jumeau tient la
 * séquence « Vidéo » (sans voix off : le jumeau est la seule voix).
 *
 *  - durée cible : titre, cartes et CTA se partagent ce que la parole laisse
 *    (`enveloppeAutourDuJumeau`, minima de lisibilité) ;
 *  - sans durée cible : les défauts 4 / 6 / 4 s.
 */
export function dureesMontageJumeau(input: {
  paroleSecondes: number;
  dureeCible?: number | null;
  avecCartes: boolean;
}): DureesMontage {
  const video = dureeSequenceJumeau(input.paroleSecondes);
  const enveloppe = input.dureeCible
    ? enveloppeAutourDuJumeau(input.dureeCible - video, DEFAULT_SEQUENCE_SECONDS, input.avecCartes)
    : null;
  return {
    intro: enveloppe ? enveloppe.intro : DEFAULT_SEQUENCE_SECONDS.intro,
    cards: enveloppe ? enveloppe.cards : DEFAULT_SEQUENCE_SECONDS.cards,
    video,
    cta: enveloppe ? enveloppe.cta : DEFAULT_SEQUENCE_SECONDS.cta,
  };
}

/**
 * Parole ESTIMÉE du jumeau (s) avant sa génération : longueur du script au
 * débit du rythme (`CARACTERES_PAR_SECONDE`, celui qui dimensionne le script).
 * Arrondie au dixième. Script vide : 0.
 */
export function estimerParoleJumeau(script: string, rythme?: RythmeBrief | null): number {
  const debit = CARACTERES_PAR_SECONDE[rythme ?? 'normal'];
  const n = (script ?? '').trim().length;
  return n > 0 ? Math.round((n / debit) * 10) / 10 : 0;
}

/**
 * Les étapes que l'APERÇU de l'Autopilote joue (`SequencePlayback`).
 *
 *  - Sans jumeau : les durées d'avant, INCHANGÉES — défauts 4 / 6 / 4 s et le
 *    repli du rush (l'aperçu ne décode pas le fichier, `buildAutopilotDesign`
 *    sans durée sondée prend le même repli).
 *  - Avec le jumeau (avatar monté seul) : `dureesMontageJumeau`, LA règle du
 *    rendu, sur la parole connue ou estimée.
 */
export function etapesApercuAutopilote(input: {
  activeOrder: ReadonlyArray<string>;
  /** Parole du jumeau (s) quand l'avatar est monté seul ; `null` sinon. */
  paroleJumeau: number | null;
  dureeCible?: number | null;
  avecCartes: boolean;
}): Array<{ key: string; seconds: number }> {
  const d: DureesMontage = input.paroleJumeau !== null
    ? dureesMontageJumeau({ paroleSecondes: input.paroleJumeau, dureeCible: input.dureeCible, avecCartes: input.avecCartes })
    : { intro: DEFAULT_SEQUENCE_SECONDS.intro, cards: DEFAULT_SEQUENCE_SECONDS.cards, video: RUSH_SEQUENCE_SECONDS.fallback, cta: DEFAULT_SEQUENCE_SECONDS.cta };
  return input.activeOrder.map((key) => ({ key, seconds: d[key as keyof DureesMontage] ?? 0 }));
}
