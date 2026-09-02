/**
 * M3-E — LE MOTEUR DE CALAGE. Une fonction pure, et rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA RÈGLE, EN UNE PHRASE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Chaque borne se pose sur le point d'ancrage le PLUS PROCHE dans sa
 * tolérance ; à distance égale seulement, un silence l'emporte sur une
 * frontière de phrase, qui l'emporte sur une frontière de mot ; à défaut, la
 * borne de M3-C ne bouge pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POURQUOI LA PROXIMITÉ PASSE AVANT LA CATÉGORIE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'ordre inverse — silence, puis phrase, puis mot, chacun cherché à son tour
 * — semble plus noble et donne de moins bons résultats. Simulé sur les
 * candidats réels de production : la borne de fin d'un clip se voyait
 * proposer une fin de PHRASE à +0,88 s alors qu'une fin de MOT l'attendait à
 * −0,04 s. La fenêtre sortait de la garde de durée, et le calage entier était
 * abandonné — on perdait une bonne coupe pour avoir préféré une catégorie à
 * une distance.
 *
 * Le but n'est pas de trouver le plus beau point : c'est de DÉFORMER LE MOINS
 * POSSIBLE le choix visuel de M3-C. La catégorie ne départage donc que ce que
 * la distance laisse à égalité.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT NULLE PART
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucune base, aucun réseau, aucun fournisseur, aucun ffmpeg, aucun stockage,
 * aucun crédit, aucune écriture — pas même sur ses entrées, qui sont
 * `readonly` et recopiées avant d'être triées. Un test le vérifie sur le
 * source, et un autre en comparant les entrées avant et après.
 */
import {
  ALGORITHME_COUPES,
  ecarterChevauchements, TOLERANCE_SECONDES, EGALITE_SECONDES,
  gardeDuree, arrondirSeconde, nombreFini, rangSource,
  intervalleUtilisable, candidatUtilisable,
  type Ajustement, type Coupe, type EntreeCoupes, type EtatAudio,
  type EtatParole, type ResultatCoupes, type SourceAncrage,
} from './coupe-contrat';
import type { CandidatMontage } from './candidat-contrat';

/** Un point sur lequel une borne peut se poser. */
interface Ancrage {
  instant: number;
  source: Exclude<SourceAncrage, 'aucun'>;
}

/** Aucun déplacement — la forme neutre, écrite une fois. */
const IMMOBILE: Ajustement = { deltaSecondes: 0, source: 'aucun' };

// ─────────────────────────────────────────────────────────────────────────
// Le choix d'un ancrage, pour UNE borne
// ─────────────────────────────────────────────────────────────────────────

/**
 * Choisit le point le plus proche, à l'intérieur de la tolérance.
 *
 * `admissible` porte les contraintes propres à la borne — rester dans le
 * rush, garder `secondeReference` dans la fenêtre, ne pas croiser l'autre
 * borne. Elles sont appliquées AVANT le choix, et non après : un point
 * inadmissible ne doit pas pouvoir gagner puis être rejeté, ce qui ferait
 * dépendre le résultat de l'ordre des candidats.
 *
 * Déterministe de bout en bout : à distance égale au millième, le rang de
 * catégorie tranche ; à catégorie égale, l'instant le plus petit. Aucun cas
 * ne dépend donc de l'ordre d'itération.
 */
function choisirAncrage(
  borne: number, ancrages: readonly Ancrage[], admissible: (instant: number) => boolean,
): Ajustement {
  let gagnant: { a: Ancrage; distance: number } | null = null;

  for (const a of ancrages) {
    const distance = Math.abs(a.instant - borne);
    if (distance > TOLERANCE_SECONDES + EGALITE_SECONDES) continue;
    if (!admissible(a.instant)) continue;

    if (gagnant === null) { gagnant = { a, distance }; continue; }

    const ecart = distance - gagnant.distance;
    // ⚠️ LA PROXIMITÉ D'ABORD. La catégorie ne tranche que dans l'égalité,
    // et « égalité » veut dire « au millième » — la précision du contrat.
    if (ecart < -EGALITE_SECONDES) { gagnant = { a, distance }; continue; }
    if (ecart > EGALITE_SECONDES) continue;

    const rang = rangSource(a.source) - rangSource(gagnant.a.source);
    if (rang < 0) { gagnant = { a, distance }; continue; }
    if (rang > 0) continue;
    if (a.instant < gagnant.a.instant) gagnant = { a, distance };
  }

  if (gagnant === null) return IMMOBILE;
  const delta = arrondirSeconde(gagnant.a.instant - borne);
  // Un déplacement qui s'annule à l'arrondi n'est pas un déplacement : le
  // dire ferait apparaître un ajustement là où la fenêtre est identique.
  if (delta === 0) return IMMOBILE;
  return { deltaSecondes: delta, source: gagnant.a.source };
}

/**
 * Le mot que cette borne COUPE, s'il existe.
 *
 * ⚠️ STRICTEMENT À L'INTÉRIEUR. Une borne posée exactement sur une frontière
 * ne coupe rien, et entre deux mots il n'y a rien à réparer : n'offrir des
 * frontières de mot que dans ce cas est ce qui empêche M3-E de déplacer des
 * bornes qui allaient très bien.
 */
function motCoupe(borne: number, mots: readonly { debutSecondes: number; finSecondes: number }[]) {
  for (const m of mots) {
    if (m.debutSecondes < borne && borne < m.finSecondes) return m;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Le calage d'un candidat
// ─────────────────────────────────────────────────────────────────────────

interface Materiel {
  dureeRush: number;
  silences: readonly { debutSecondes: number; finSecondes: number }[];
  segments: readonly { debutSecondes: number; finSecondes: number }[];
  mots: readonly { debutSecondes: number; finSecondes: number }[];
}

/** La fenêtre finale respecte-t-elle TOUT ce que le contrat promet ? */
function fenetreValide(
  debut: number, fin: number, c: CandidatMontage, dureeRush: number,
): boolean {
  if (!Number.isFinite(debut) || !Number.isFinite(fin)) return false;
  if (debut < 0 || !(debut < fin) || fin > dureeRush + EGALITE_SECONDES) return false;
  if (c.secondeReference < debut - EGALITE_SECONDES) return false;
  if (c.secondeReference > fin + EGALITE_SECONDES) return false;
  if (Math.abs(debut - c.debutSecondes) > TOLERANCE_SECONDES + EGALITE_SECONDES) return false;
  if (Math.abs(fin - c.finSecondes) > TOLERANCE_SECONDES + EGALITE_SECONDES) return false;
  const dureeOriginale = c.finSecondes - c.debutSecondes;
  const variation = Math.abs((fin - debut) - dureeOriginale);
  return variation <= gardeDuree(c.dureeCibleSecondes) + EGALITE_SECONDES;
}

/**
 * Cale une fenêtre, ou la rend intacte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LES DEUX BORNES SONT INDÉPENDANTES — MAIS LA DURÉE LES LIE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le début peut s'améliorer alors que la fin reste celle de M3-C, et
 * réciproquement : abandonner les deux parce que l'une ne convient pas
 * gâcherait une moitié de travail parfaitement bonne.
 *
 * Mais leur SOMME est bornée : deux déplacements chacun admissibles peuvent
 * ensemble étirer le clip au-delà de la garde. Quand cela arrive, on ne
 * rejette pas tout — on réessaie chaque ajustement SEUL, et on garde le plus
 * petit déplacement admissible. Le tout dernier recours, et lui seul, est la
 * fenêtre de M3-C.
 */
function calerCandidat(c: CandidatMontage, m: Materiel): Coupe {
  const { dureeRush } = m;

  // ── Les points offerts à chaque borne ────────────────────────────────
  const ancragesDebut: Ancrage[] = [];
  const ancragesFin: Ancrage[] = [];

  for (const s of m.silences) {
    // La FIN d'un silence ouvre la parole : c'est là qu'un plan commence.
    ancragesDebut.push({ instant: s.finSecondes, source: 'silence' });
    // Le DÉBUT d'un silence ferme ce qui vient d'être dit.
    ancragesFin.push({ instant: s.debutSecondes, source: 'silence' });
  }
  for (const s of m.segments) {
    ancragesDebut.push({ instant: s.debutSecondes, source: 'segment' });
    ancragesFin.push({ instant: s.finSecondes, source: 'segment' });
  }

  // ⚠️ Les mots ne sont offerts QUE si la borne en coupe un. Les offrir tous
  // ferait sauter chaque borne sur le mot le plus proche, partout, tout le
  // temps — c'est-à-dire déplacer sans réparer.
  const motDebut = motCoupe(c.debutSecondes, m.mots);
  if (motDebut) {
    ancragesDebut.push({ instant: motDebut.debutSecondes, source: 'mot' });
    ancragesDebut.push({ instant: motDebut.finSecondes, source: 'mot' });
  }
  const motFin = motCoupe(c.finSecondes, m.mots);
  if (motFin) {
    ancragesFin.push({ instant: motFin.debutSecondes, source: 'mot' });
    ancragesFin.push({ instant: motFin.finSecondes, source: 'mot' });
  }

  // ── Chaque borne choisit, sans savoir ce que l'autre a choisi ─────────
  const propDebut = choisirAncrage(c.debutSecondes, ancragesDebut, (i) => (
    i >= 0 && i <= dureeRush + EGALITE_SECONDES
      && i <= c.secondeReference + EGALITE_SECONDES
      && i < c.finSecondes
  ));
  const propFin = choisirAncrage(c.finSecondes, ancragesFin, (i) => (
    i >= 0 && i <= dureeRush + EGALITE_SECONDES
      && i >= c.secondeReference - EGALITE_SECONDES
      && i > c.debutSecondes
  ));

  // ── Les combinaisons, de la plus complète à la plus prudente ─────────
  const essais: Array<{ debut: Ajustement; fin: Ajustement }> = [
    { debut: propDebut, fin: propFin },
  ];
  // Chaque ajustement seul, le plus petit déplacement d'abord ; à égalité,
  // la catégorie tranche. L'ordre est FIXE, donc le résultat aussi.
  const seuls = [
    { debut: propDebut, fin: IMMOBILE },
    { debut: IMMOBILE, fin: propFin },
  ].filter((e) => e.debut.source !== 'aucun' || e.fin.source !== 'aucun');
  seuls.sort((x, y) => {
    const dx = Math.abs(x.debut.deltaSecondes + x.fin.deltaSecondes);
    const dy = Math.abs(y.debut.deltaSecondes + y.fin.deltaSecondes);
    if (Math.abs(dx - dy) > EGALITE_SECONDES) return dx - dy;
    const sx = x.debut.source !== 'aucun' ? x.debut.source : x.fin.source;
    const sy = y.debut.source !== 'aucun' ? y.debut.source : y.fin.source;
    const rang = rangSource(sx) - rangSource(sy);
    if (rang !== 0) return rang;
    // ⚠️ LE DERNIER DÉPARTAGE, ÉCRIT PLUTÔT QUE SUBI. Deux ajustements de
    // même ampleur et de même nature restent possibles ; s'en remettre à
    // l'ordre du tableau marcherait, mais personne ne saurait pourquoi. On
    // tranche donc, et on le dit : le DÉBUT l'emporte — un plan qui s'ouvre
    // au milieu d'un mot s'entend avant un plan qui s'y ferme.
    return (x.debut.source !== 'aucun' ? 0 : 1) - (y.debut.source !== 'aucun' ? 0 : 1);
  });
  essais.push(...seuls);
  essais.push({ debut: IMMOBILE, fin: IMMOBILE });

  for (const essai of essais) {
    const debut = borneArrondie(c.debutSecondes, essai.debut);
    const fin = borneArrondie(c.finSecondes, essai.fin);
    // ⚠️ LA VALIDATION EST FAITE APRÈS L'ARRONDI, jamais avant : arrondir
    // peut pousser une borne d'un millième au-delà du rush, et vérifier
    // avant ne prouverait rien sur ce qui est réellement rendu.
    if (!fenetreValide(debut, fin, c, dureeRush)) continue;
    return {
      rang: c.rang,
      secondeReference: c.secondeReference,
      dureeCibleSecondes: c.dureeCibleSecondes,
      scoreMontage: c.scoreMontage,
      raison: c.raison,
      debutOriginalSecondes: arrondirSeconde(c.debutSecondes),
      finOriginalSecondes: arrondirSeconde(c.finSecondes),
      debutSecondes: debut,
      finSecondes: fin,
      dureeSecondes: arrondirSeconde(fin - debut),
      ajustementDebut: essai.debut,
      ajustementFin: essai.fin,
    };
  }

  // Inatteignable en pratique — la dernière combinaison EST la fenêtre de
  // M3-C, que son propre contrat garantit valide. La ceinture reste : une
  // fenêtre invalide ne doit jamais sortir d'ici, même si l'impossible arrive.
  return coupeIntacte(c);
}

/** `borne + delta`, arrondi UNE seule fois — jamais deux, qui dériveraient. */
function borneArrondie(borne: number, aj: Ajustement): number {
  return arrondirSeconde(borne + aj.deltaSecondes);
}

/** La fenêtre de M3-C, recopiée sans un chiffre de différence. */
function coupeIntacte(c: CandidatMontage): Coupe {
  const debut = arrondirSeconde(c.debutSecondes);
  const fin = arrondirSeconde(c.finSecondes);
  return {
    rang: c.rang,
    secondeReference: c.secondeReference,
    dureeCibleSecondes: c.dureeCibleSecondes,
    scoreMontage: c.scoreMontage,
    raison: c.raison,
    debutOriginalSecondes: debut,
    finOriginalSecondes: fin,
    debutSecondes: debut,
    finSecondes: fin,
    dureeSecondes: arrondirSeconde(fin - debut),
    ajustementDebut: IMMOBILE,
    ajustementFin: IMMOBILE,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// L'état des sources
// ─────────────────────────────────────────────────────────────────────────

function etatAudio(entree: EntreeCoupes, silences: readonly unknown[]): EtatAudio {
  if (entree.audioEtatMesure === 'absente') return 'absente';
  if (entree.audioEtatMesure === 'indisponible') return 'indisponible';
  // Zéro silence N'EST PAS une erreur : une musique continue n'en a aucun,
  // et notre rush de référence est exactement dans ce cas.
  return silences.length > 0 ? 'exploitee' : 'sans_silence';
}

function etatParole(
  entree: EntreeCoupes, segments: readonly unknown[], mots: readonly unknown[],
): EtatParole {
  if (!entree.transcriptionRetenue) return 'absente';
  if (!entree.parolePresente) return 'sans_parole';
  // Retenue, de la parole annoncée, mais aucun instant sur quoi se poser :
  // un texte seul n'autorise à inventer aucun timecode.
  return segments.length > 0 || mots.length > 0 ? 'exploitee' : 'ecartee';
}

// ─────────────────────────────────────────────────────────────────────────
// Point d'entrée
// ─────────────────────────────────────────────────────────────────────────

/**
 * Cale toutes les fenêtres d'un jeu de candidats.
 *
 * Ne lève jamais, ne mute rien, ne lit rien d'autre que son argument. Deux
 * appels sur les mêmes données rendent des objets égaux — c'est la propriété
 * qui permettra à un rendu de retrouver sa décision sans l'avoir stockée.
 */
export function calerCoupes(entree: EntreeCoupes): ResultatCoupes {
  const dureeRush = nombreFini(entree.dureeRushSecondes) ?? 0;

  // ── Les entrées sont RECOPIÉES avant d'être triées ───────────────────
  //
  // Trier sur place muterait les tableaux de l'appelant — donc les candidats
  // de M3-C, la mesure de M3-D1 ou la transcription de M3-D2. Ces trois-là
  // sont des faits historiques ; M3-E les lit, il ne les touche pas.
  const utilisable = (v: unknown) => intervalleUtilisable(v, dureeRush);
  const trier = <T extends { debutSecondes: number }>(l: readonly T[]) => (
    [...l].sort((a, b) => a.debutSecondes - b.debutSecondes)
  );

  const silences = dureeRush > 0 ? trier((entree.silences ?? []).filter(utilisable)) : [];
  const segments = dureeRush > 0 ? trier((entree.segments ?? []).filter(utilisable)) : [];
  const mots = dureeRush > 0 ? trier((entree.mots ?? []).filter(utilisable)) : [];

  const sources = {
    parole: etatParole(entree, segments, mots),
    audio: etatAudio(entree, silences),
  };

  // Une durée de rush inconnue ne borne plus rien : on ne cale pas, et on ne
  // rend surtout pas des fenêtres qu'on ne saurait pas vérifier.
  const materiel: Materiel = dureeRush > 0
    ? { dureeRush, silences, segments, mots }
    : { dureeRush: 0, silences: [], segments: [], mots: [] };

  const coupes: Coupe[] = [];
  for (const brut of entree.candidats ?? []) {
    if (!candidatUtilisable(brut, dureeRush)) continue;
    coupes.push(dureeRush > 0 ? calerCandidat(brut, materiel) : coupeIntacte(brut));
  }
  // L'ordre de M3-C est celui de l'écran : il se conserve, il ne se recalcule
  // pas. Aucun score nouveau n'existe qui pourrait le remettre en cause.
  coupes.sort((a, b) => a.rang - b.rang);

  // ⚠️ APRÈS LE TRI, ET APRÈS LE CALAGE. Le tri donne l'ordre de qualité dont
  // dépend « le mieux classé gagne » ; le calage donne les fenêtres FINALES,
  // les seules qu'il soit juste de comparer — deux fenêtres disjointes à
  // l'origine peuvent se recouvrir une fois leurs bornes recalées.
  const retenues = ecarterChevauchements(coupes);

  return { algorithme: ALGORITHME_COUPES, sources, coupes: retenues };
}
