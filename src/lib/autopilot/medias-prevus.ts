/**
 * MÉDIAS PRÉVUS DE L'AUTOPILOTE — règles PURES de l'écran, multi-sources.
 *
 * ⚠️ DES SOURCES, PAS DES PARCOURS. Rushes personnels, avatar et médias stock
 * (vidéos Pexels importées, photos Pexels / Unsplash retenues) sont des
 * sources INDÉPENDANTES et COMBINABLES d'un même Autopilote (contrat :
 * `lib/autopilot/sources`). Le moteur les entrelace dans la séquence Vidéo ;
 * l'écran n'annonce donc plus « avatar seul » ni « rushes en secours ».
 *
 * ⚠️ PLUS DE RUSH OBLIGATOIRE. La vidéo est possible dès qu'il existe UNE
 * source visuelle exploitable (`aUneSourceVisuelle`). Le seul blocage
 * restant côté avatar : demandé mais pas prêt (le lancement échouerait).
 *
 * Aucune nouvelle colonne : l'avatar reste `jumeauAvatar` (colonne de
 * vérité), les sources vivent dans `designStyle.sources`.
 */
import {
  aUneSourceVisuelle,
  compterSources,
  estRushStock,
  sourcesParDefaut,
  type ConfigSources,
  type EtatSourcesVisuelles,
  type TypeCreneau,
  type CreneauGabarit,
} from '@/lib/autopilot/sources';

/**
 * L'avatar est-il prêt pour les montages ? `null` = pas encore vérifié (ou
 * vérification impossible) : l'écran ne conclut rien.
 */
export type AvatarPret = boolean | null;

export type MotifBlocageRushes = 'sans-source' | 'avatar-non-pret' | 'avatar-en-verification';

export interface ValidationEtapeRushes {
  bloque: boolean;
  motif: MotifBlocageRushes | null;
  /** La phrase affichée à côté du bouton « Continuer » (vide si rien ne bloque). */
  message: string;
}

/** Les phrases — une seule source pour l'écran et les tests. */
export const MESSAGES_RUSHES = {
  sansSource: 'Aucune source visuelle : ajoutez un rush, activez votre avatar ou retenez un média Pexels / Unsplash.',
  avatarNonPret: 'Aucun avatar prêt : configurez votre avatar, ou décochez « Mon avatar ».',
  avatarEnVerification: 'Vérification de votre avatar…',
  multiSources: 'Vidéo multi-sources prête.',
  rien: 'Aucune source visuelle : rien ne sera produit.',
} as const;

/** Les sources effectives : la clé enregistrée, ou le comportement d'avant. L'avatar suit TOUJOURS `jumeauAvatar`. */
export function sourcesEffectives(config: { jumeauAvatar: boolean; designStyle?: { sources?: ConfigSources } | null }): ConfigSources {
  const base = config.designStyle?.sources ?? sourcesParDefaut(config.jumeauAvatar);
  return { ...base, actives: { ...base.actives, avatar: !!config.jumeauAvatar } };
}

export type EtatMediasPrevus = EtatSourcesVisuelles & ReturnType<typeof compterSources>;

/** L'état des sources visuelles, tel que la règle `aUneSourceVisuelle` l'attend. */
export function etatSourcesVisuelles(
  rushUrls: readonly string[],
  sources: ConfigSources,
  avatarPret: AvatarPret,
): EtatMediasPrevus {
  const c = compterSources(rushUrls, sources);
  // Médias déjà importés dans la banque (anciens « Conserver » #541) alors que
  // la source stock est éteinte : la banque les monte toujours — ils comptent.
  const bibliotheque = !sources.actives.stock && sources.actives.rushes ? rushUrls.filter(estRushStock).length : 0;
  return {
    ...c,
    avatarActif: sources.actives.avatar,
    avatarPret: avatarPret === true,
    bibliotheque,
    stockRetenus: c.pexelsVideos + c.pexelsPhotos + c.unsplashPhotos,
  };
}

/**
 * L'étape Rushes / Médias peut-elle être franchie ?
 *
 *   - avatar demandé mais pas prêt : bloqué, explicitement (même avec
 *     d'autres sources — le lancement du jumeau échouerait) ;
 *   - au moins une source visuelle exploitable : valide ;
 *   - avatar demandé, vérification en cours, rien d'autre : on attend ;
 *   - aucune source : bloqué, avec la phrase qui dit quoi faire.
 */
export function validerEtapeRushes(input: {
  /** Rushes PERSONNELS exploitables (source « Mes rushes » active). */
  nbRushes: number;
  avatarDemande: boolean;
  avatarPret: AvatarPret;
  stockRetenus?: number;
  bibliotheque?: number;
}): ValidationEtapeRushes {
  const { nbRushes, avatarDemande, avatarPret } = input;
  if (avatarDemande && avatarPret === false) {
    return { bloque: true, motif: 'avatar-non-pret', message: MESSAGES_RUSHES.avatarNonPret };
  }
  const possible = aUneSourceVisuelle({
    rushesPersonnels: nbRushes,
    avatarActif: avatarDemande,
    avatarPret: avatarPret === true,
    bibliotheque: input.bibliotheque ?? 0,
    stockRetenus: input.stockRetenus ?? 0,
  });
  if (possible) return { bloque: false, motif: null, message: '' };
  if (avatarDemande && avatarPret === null) {
    return { bloque: true, motif: 'avatar-en-verification', message: MESSAGES_RUSHES.avatarEnVerification };
  }
  return { bloque: true, motif: 'sans-source', message: MESSAGES_RUSHES.sansSource };
}

/** L'avatar est-il une source exploitable (demandé ET prêt) ? */
export function avatarPorteLaProduction(avatarDemande: boolean, avatarPret: AvatarPret): boolean {
  return avatarDemande && avatarPret === true;
}

export type ContenuRendu = 'rien' | 'multi-sources';

/** Ce que contiendra la séquence « Vidéo » des montages, en une phrase. */
export function contenuRendu(etat: EtatSourcesVisuelles): { cas: ContenuRendu; phrase: string } {
  return aUneSourceVisuelle(etat)
    ? { cas: 'multi-sources', phrase: MESSAGES_RUSHES.multiSources }
    : { cas: 'rien', phrase: MESSAGES_RUSHES.rien };
}

/**
 * Le plan SUGGÉRÉ quand l'utilisateur n'a rien fixé : avatar en premier et en
 * dernier s'il est actif, rushes et stock en alternance au milieu. Il n'est
 * jamais enregistré tel quel — seule une modification le fixe.
 */
export function gabaritSuggere(etat: { avatar: boolean; rushes: number; stock: number }): CreneauGabarit[] {
  const milieu: TypeCreneau[] = [];
  if (etat.rushes > 0) milieu.push('rush');
  if (etat.stock > 0) milieu.push('stock');
  const alt = (n: number): TypeCreneau[] => Array.from({ length: milieu.length ? n : 0 }, (_, i) => milieu[i % milieu.length]);
  let types: TypeCreneau[];
  if (etat.avatar) types = milieu.length ? ['avatar', ...alt(milieu.length > 1 ? 3 : 2), 'avatar'] : ['avatar'];
  else types = alt(milieu.length > 1 ? 4 : 3);
  return types.map((type, i) => ({ id: `s${i + 1}`, type }));
}
