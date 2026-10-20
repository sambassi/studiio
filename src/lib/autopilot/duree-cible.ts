/**
 * DURÉE CIBLE ET RYTHME DE L'AUTOPILOTE — la source de vérité, PURE.
 *
 * La durée souhaitée (`brief.duree`) et le rythme (`brief.rythme`) pilotent :
 *
 *   1. le CONTENU de chaque vidéo (`contenuPourDuree`) : combien d'idées
 *      (cartes), le sous-titre, le message — choisis par UNITÉS ENTIÈRES dans
 *      un budget de parole. Rien n'est coupé au milieu : une unité qui ne
 *      tient pas n'est pas prise. 15 s → une idée ; 45 s → plusieurs.
 *   2. le SCRIPT de l'avatar (`scriptPourDuree`), avec la même sélection ;
 *   3. le NOMBRE DE SÉQUENCES du plan (`nombreCreneaux`) : durée ÷ longueur
 *      d'un plan au rythme choisi, bornée par l'avatar et les médias ;
 *   4. le MINUTAGE (`minutagePlan`) : le même partage que le moteur
 *      (`planGabarit` : durées égales, dans l'ordre).
 *
 * Quand l'audio RÉEL existe (voix off mesurée, parole de l'avatar), c'est LUI
 * la référence (`dureeDeReference`) : le plan est recalé dessus, la voix n'est
 * jamais accélérée.
 *
 * ⚠️ SANS DURÉE CIBLE : RIEN NE CHANGE. Chaque fonction rend alors le
 * comportement d'avant (contenu entier, nombre de plans d'avant) — c'est ce
 * qui rend l'ajout rétro-compatible pour toutes les configurations existantes.
 */
import {
  CARACTERES_PAR_SECONDE, longueurScriptCible, type RythmeBrief, type VideoBrief,
} from '@/lib/creer/brief';

/**
 * DÉBIT RÉEL DE LA VOIX DE L'AVATAR (voix clonée) : plus lent que le débit
 * générique (`CARACTERES_PAR_SECONDE`, ≈ 14 car./s en « normal »). Mesuré en
 * production : un script de 420 caractères (30 s × 14) a donné 39,5 s de
 * parole, soit ≈ 10,6 car./s — un rapport de 0,76.
 *
 * ⚠️ LA VOIX N'EST JAMAIS ACCÉLÉRÉE pour tenir la durée : c'est le SCRIPT qui
 * est dimensionné AVANT génération, à ce débit-là. La durée cible garde son
 * sens (la parole visée), seul le nombre de caractères change.
 */
export const RATIO_DEBIT_AVATAR = 0.76;

/** Débit de parole de l'avatar (caractères/s) pour un rythme. */
export function debitParoleAvatar(r: RythmeBrief | null | undefined): number {
  return Math.round(CARACTERES_PAR_SECONDE[r ?? 'normal'] * RATIO_DEBIT_AVATAR * 10) / 10;
}

/**
 * Longueur d'un plan selon le rythme (s). `normal` = 3,5 s, au centre de la
 * fenêtre des plans de coupe du moteur (2–4 s, `BROLL_MIN_S`/`BROLL_MAX_S`) ;
 * `dynamique` = 2,5 s (coupes rapprochées, toujours ≥ 2 s) ; `calme` = 5 s
 * (plans plus longs que la fenêtre de coupe, lisibles sans précipitation).
 */
export const DUREE_PLAN_PAR_RYTHME: Record<RythmeBrief, number> = {
  calme: 5,
  normal: 3.5,
  dynamique: 2.5,
};

/** Plafond de créneaux — le même que l'éditeur de plan (`MAX_CRENEAUX`). */
export const CRENEAUX_MAX = 12;

/** Plus court plan monté (s) — `BROLL_MIN_S` du moteur. */
export const PLAN_MIN_S = 2;

/** Durée affichée quand aucune durée cible n'est choisie (≈ la cible du smart montage). */
export const DUREE_ESTIMEE_SANS_CIBLE = 30;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Le rythme effectif : celui du brief, sinon `normal`. */
export function rythmeEffectif(brief: VideoBrief | null | undefined): RythmeBrief {
  return brief?.rythme ?? 'normal';
}

// ─────────────────────────────────────────────────────────────────────────
// Contenu et script conçus pour la durée
// ─────────────────────────────────────────────────────────────────────────

interface Unite {
  cle: string;
  texte: string;
  /** Toujours gardée (le titre, l'appel à l'action). */
  obligatoire?: boolean;
  /** Plus petit = choisi plus tôt quand le budget est serré. */
  priorite: number;
}

/**
 * Les unités gardées pour un budget (caractères) : les obligatoires, puis
 * par priorité celles qui TIENNENT ENTIÈRES (séparateur compté). L'ordre de
 * lecture d'origine est conservé.
 */
function selectionner(unites: Unite[], budget: number): Set<string> {
  const gardees = new Set<string>();
  let total = 0;
  const cout = (u: Unite) => u.texte.length + (gardees.size > 0 ? 2 : 0);
  for (const u of unites.filter((x) => x.obligatoire)) { total += cout(u); gardees.add(u.cle); }
  for (const u of [...unites].filter((x) => !x.obligatoire).sort((a, b) => a.priorite - b.priorite)) {
    const c = cout(u);
    if (total + c <= budget) { total += c; gardees.add(u.cle); }
  }
  return gardees;
}

type Carte = { title?: string; description?: string; value?: string };

function texteCarte(c: Carte): string {
  return [c.title, c.description, c.value].map((s) => (s ?? '').trim()).filter(Boolean).join('. ');
}

/** Les unités d'une vidéo, dans l'ordre de lecture. */
function unitesDe(input: {
  titre: string;
  sousTitre?: string | null;
  message?: string | null;
  cartes: ReadonlyArray<Carte>;
  cta?: string | null;
  /** A4 v2 — la première idée est gardée comme le titre et le CTA (message complet). */
  ideeObligatoire?: boolean;
}): Unite[] {
  const u: Unite[] = [];
  const message = (input.message ?? '').trim();
  if (message) u.push({ cle: 'message', texte: message, priorite: 1 });
  u.push({ cle: 'titre', texte: input.titre.trim(), obligatoire: true, priorite: 0 });
  const st = (input.sousTitre ?? '').trim();
  if (st) u.push({ cle: 'sousTitre', texte: st, priorite: 3 });
  input.cartes.forEach((c, i) => {
    const t = texteCarte(c);
    // La première idée passe avant le message : une vidéo de 15 s dit au moins UNE chose concrète.
    if (t) u.push({ cle: `carte-${i}`, texte: t, priorite: i === 0 ? 0.5 : 2 + i * 0.01, ...(i === 0 && input.ideeObligatoire ? { obligatoire: true } : null) });
  });
  const cta = (input.cta ?? '').trim();
  if (cta) u.push({ cle: 'cta', texte: cta, obligatoire: true, priorite: 0 });
  return u;
}

/**
 * Le CONTENU d'une vidéo, conçu pour la durée cible : nombre d'idées
 * (cartes), sous-titre et message choisis pour que la narration complète
 * (titre, cartes, CTA) tienne dans le budget de parole. Sans durée cible :
 * le contenu tel quel. Toujours au moins une idée quand il y en a.
 */
export function contenuPourDuree<C extends { subtitle?: string; tagLine?: string; cards: Carte[] }>(
  content: C,
  titre: string,
  brief: VideoBrief | null | undefined,
): C {
  const budget = longueurScriptCible(brief);
  if (budget === null) return content;
  const gardees = selectionner(unitesDe({
    titre,
    sousTitre: content.subtitle,
    message: brief?.message,
    cartes: content.cards,
    cta: brief?.cta || content.tagLine,
  }), budget);
  let cards = content.cards.filter((_, i) => gardees.has(`carte-${i}`));
  if (cards.length === 0 && content.cards.length > 0) cards = content.cards.slice(0, 1);
  return {
    ...content,
    cards,
    ...(content.subtitle && !gardees.has('sousTitre') ? { subtitle: '' } : null),
  };
}

/**
 * Le BUDGET (caractères) du script de l'avatar pour la durée cible — celui de
 * la production (`scriptPourDuree`). Le script est dit par l'avatar : budget
 * au débit RÉEL de sa voix clonée (`debitParoleAvatar`), jamais au débit
 * générique — sinon 30 s visées donnaient ≈ 40 s de parole. `null` sans cible.
 */
export function budgetScriptAvatar(brief: VideoBrief | null | undefined, secondesReservees?: number): number | null {
  if (!brief?.duree) return null;
  const reserve = secondesReservees ?? 0;
  return Math.round((reserve > 0 ? Math.max(PLAN_MIN_S, brief.duree - reserve) : brief.duree) * debitParoleAvatar(brief.rythme));
}

/**
 * Le SCRIPT de l'avatar pour la durée cible : accroche (message, titre),
 * idées (cartes), appel à l'action — par unités entières. `null` sans durée
 * cible : l'appelant garde son script d'avant.
 */
export function scriptPourDuree(input: {
  titre: string;
  sousTitre?: string | null;
  cartes: ReadonlyArray<Carte>;
  cta?: string | null;
  brief: VideoBrief | null | undefined;
  /**
   * A4 — secondes de la durée cible DÉJÀ prises par d'autres séquences
   * (titre, cartes, CTA plein écran autour de l'avatar seul). Le budget de
   * parole devient (durée − réservé) × débit. Absent ou 0 : le budget d'avant.
   */
  secondesReservees?: number;
  /** A4 v2 — avatar seul : la première idée est toujours dite (message complet). */
  ideeObligatoire?: boolean;
}): string | null {
  const budget = budgetScriptAvatar(input.brief, input.secondesReservees);
  if (budget === null) return null;
  const unites = unitesDe({ ...input, message: input.brief?.message });
  const gardees = selectionner(unites, budget);
  const vus = new Set<string>();
  return unites
    .filter((u) => gardees.has(u.cle))
    .map((u) => u.texte.replace(/[.\s]+$/, ''))
    .filter((t) => (vus.has(t) ? false : (vus.add(t), true)))
    .join('. ');
}

// ─────────────────────────────────────────────────────────────────────────
// Plan : nombre de séquences et minutage
// ─────────────────────────────────────────────────────────────────────────

/**
 * Nombre de créneaux du plan pour une durée et un rythme — `null` sans durée
 * cible (l'appelant garde ses nombres d'avant).
 *
 * total = arrondi(durée ÷ longueur d'un plan au rythme), puis :
 *   - avec avatar : au moins 2 (ouverture + conclusion), au moins 3 dès qu'un
 *     plan de coupe existe ;
 *   - sans rush personnel, jamais plus de plans de coupe que de médias stock
 *     DISTINCTS (au-delà, le moteur reprendrait un média et l'écran mentirait) ;
 *   - jamais plus de `CRENEAUX_MAX`.
 */
export function nombreCreneaux(input: {
  dureeSecondes: number | null | undefined;
  rythme?: RythmeBrief | null;
  avatar: boolean;
  rushes: number;
  stock: number;
}): { total: number; intercales: number } | null {
  const T = input.dureeSecondes;
  if (!T || !(T > 0)) return null;
  const sources = (input.rushes > 0 ? 1 : 0) + (input.stock > 0 ? 1 : 0);
  const plan = DUREE_PLAN_PAR_RYTHME[input.rythme ?? 'normal'];
  const brut = Math.max(1, Math.round(T / plan));
  if (sources === 0) return { total: input.avatar ? 1 : 0, intercales: 0 };
  let intercales = input.avatar ? Math.max(1, brut - 2) : brut;
  if (input.rushes === 0) intercales = Math.min(intercales, input.stock);
  intercales = Math.min(intercales, CRENEAUX_MAX - (input.avatar ? 2 : 0));
  return { total: intercales + (input.avatar ? 2 : 0), intercales: Math.max(0, intercales) };
}

export interface MinutageCreneau {
  debut: number;
  fin: number;
  duree: number;
}

/**
 * Le minutage d'un plan de `n` créneaux sur `T` secondes : durées ÉGALES,
 * dans l'ordre — le partage du moteur (`planGabarit` : chaque créneau prend
 * le reste ÷ les créneaux restants). Arrondi au dixième, le dernier finit
 * exactement à `T`.
 */
export function minutagePlan(n: number, T: number): MinutageCreneau[] {
  if (n <= 0 || !(T > 0)) return [];
  const out: MinutageCreneau[] = [];
  let t = 0;
  for (let k = 0; k < n; k += 1) {
    const fin = k === n - 1 ? r1(T) : r1(t + (T - t) / (n - k));
    out.push({ debut: r1(t), fin, duree: r1(fin - t) });
    t = fin;
  }
  return out;
}

/**
 * La durée de RÉFÉRENCE d'un plan : l'audio réel quand il existe (la voix ne
 * s'accélère jamais pour tenir une cible), sinon la durée cible.
 */
export function dureeDeReference(cible: number | null | undefined, audioReel: number | null | undefined): number | null {
  if (typeof audioReel === 'number' && audioReel > 0) return audioReel;
  return cible && cible > 0 ? cible : null;
}

/** « 00:05 » — minutes:secondes ; « 00:04,5 » au dixième quand il y en a un. */
export function horodatage(s: number): string {
  const total = Math.max(0, r1(s));
  const m = Math.floor(total / 60);
  const sec = total - m * 60;
  const entier = Math.floor(sec);
  const dixieme = Math.round((sec - entier) * 10);
  return `${String(m).padStart(2, '0')}:${String(entier).padStart(2, '0')}${dixieme ? `,${dixieme}` : ''}`;
}

/** « 4,5 s » */
export function secondesLisibles(s: number): string {
  return `${String(r1(s)).replace('.', ',')} s`;
}

/** Débit retenu (caractères/s) — exposé pour l'explication à l'écran et les tests. */
export function debitDuRythme(r: RythmeBrief | null | undefined): number {
  return CARACTERES_PAR_SECONDE[r ?? 'normal'];
}

/**
 * La durée visée pour la séquence « Vidéo » d'après la durée cible du brief —
 * `null` sans durée cible (la règle d'avant s'applique). En surimpression, la
 * vidéo EST tout le montage ; sinon, titre, cartes et CTA (déjà calés sur
 * leurs voix réelles) en prennent leur part.
 */
export function cibleVideoDuBrief(
  brief: { duree?: number } | null | undefined,
  design: { introDuration?: number; cardsDuration?: number; ctaDuration?: number },
  enSurimpression: boolean,
): number | null {
  if (!brief?.duree) return null;
  if (enSurimpression) return brief.duree;
  const autres = (design.introDuration ?? 0) + (design.cardsDuration ?? 0) + (design.ctaDuration ?? 0);
  return Math.max(PLAN_MIN_S, brief.duree - autres);
}


// ─────────────────────────────────────────────────────────────────────────
// A4 — Avatar SEUL (sans autres sources) : titre, cartes et CTA plein écran
// autour de la séquence « Vidéo » du jumeau. Sans cette répartition, le jumeau
// (script calé sur TOUTE la durée cible) s'ajoutait aux 4/6/4 s fixes :
// ≈ 14 s + la cible, soit ≈ 2× pour 15 s.
// ─────────────────────────────────────────────────────────────────────────

/** Durées de lisibilité MINIMALES (s) des séquences plein écran autour du jumeau. */
export const MINIMA_LISIBILITE_JUMEAU = { intro: 2.5, cards: 3, cta: 2.5 } as const;

/** Au-delà des défauts 4/6/4, l'enveloppe s'allonge au plus de ce facteur (jamais d'écran figé interminable). */
export const ETIREMENT_MAX_ENVELOPPE = 1.5;

/**
 * Secondes de la durée cible RÉSERVÉES à titre, cartes et CTA quand l'avatar
 * est monté seul : 40 % de la cible, bornés entre la somme des minima (8 s)
 * et celle des défauts 4/6/4 (14 s). Le script du jumeau dispose du reste.
 * 15 s → 8 (jumeau ≈ 7 s), 30 s → 12 (≈ 18 s), 45 s → 14 (≈ 31 s).
 */
export function secondesReserveesEnveloppeJumeau(duree: number | null | undefined): number {
  if (!duree || !(duree > 0)) return 0;
  const min = MINIMA_LISIBILITE_JUMEAU.intro + MINIMA_LISIBILITE_JUMEAU.cards + MINIMA_LISIBILITE_JUMEAU.cta;
  return Math.min(14, Math.max(min, Math.round(duree * 0.4)));
}

/** Arrondi au dixième SUPÉRIEUR (epsilon flottant) — au plus 3 images de marge à 30 i/s. */
export function auDixiemeSuperieur(s: number): number {
  return Math.ceil(s * 10 - 1e-9) / 10;
}

/**
 * Répartit `reste` secondes (durée cible − séquence du jumeau) entre titre,
 * cartes et CTA : proportionnellement aux défauts (4/6/4), jamais sous les
 * minima de lisibilité, jamais au-delà de ×1,5 les défauts. Pur.
 *
 *  - reste ≥ 21 s : 6/9/6 — la vidéo reste plus courte que la cible plutôt
 *    que d'afficher un écran figé (contenu trop court pour la cible) ;
 *  - reste < 8 s : les minima 2,5/3/2,5 — la cible est dépassée, le jumeau
 *    entier et la lisibilité passent avant (cible trop courte).
 *
 * Sans carte, la séquence cartes n'est pas montée : sa part va au titre et au
 * CTA, et `cards` garde le défaut (ignoré par le montage).
 */
export function enveloppeAutourDuJumeau(
  reste: number,
  defauts: { intro: number; cards: number; cta: number },
  avecCartes: boolean,
): { intro: number; cards: number; cta: number } {
  const cles = avecCartes ? (['intro', 'cards', 'cta'] as const) : (['intro', 'cta'] as const);
  const mins = MINIMA_LISIBILITE_JUMEAU;
  const val: Record<string, number> = {};
  // Remplissage par niveaux : les séquences bloquées à leur minimum sortent
  // du partage, le reste est réparti au prorata des défauts.
  let libres: string[] = [...cles];
  let budget = reste;
  for (let passe = 0; passe < 3; passe += 1) {
    const poids = libres.reduce((t, k) => t + defauts[k as 'intro'], 0);
    const k = Math.min(ETIREMENT_MAX_ENVELOPPE, poids > 0 ? budget / poids : 0);
    const bloquees = libres.filter((c) => defauts[c as 'intro'] * k < mins[c as 'intro']);
    if (bloquees.length === 0) {
      for (const c of libres) val[c] = defauts[c as 'intro'] * k;
      break;
    }
    for (const c of bloquees) { val[c] = mins[c as 'intro']; budget -= mins[c as 'intro']; }
    libres = libres.filter((c) => !bloquees.includes(c));
    if (libres.length === 0) break;
  }
  const d = (c: 'intro' | 'cards' | 'cta') => Math.max(mins[c], Math.round((val[c] ?? mins[c]) * 10) / 10);
  return { intro: d('intro'), cards: avecCartes ? d('cards') : defauts.cards, cta: d('cta') };
}

/**
 * A4 v2 — plus courte cible où l'avatar SEUL porte un message complet :
 * enveloppe à l'écran aux minima (2,5 + 3 + 2,5 = 8 s) + une parole complète
 * (accroche + une idée + CTA ≈ 120–170 car., soit 9–12 s à 14 car./s).
 * À 15 s, la parole n'a que 7 s (≈ 98 car.) : une idée seule en fait déjà
 * ~96 — l'avatar ne disait plus que le titre et le CTA.
 */
export const DUREE_MIN_AVATAR_SEUL = 20;

/** Durée RECOMMANDÉE à l'écran quand la cible est sous ce minimum — jamais appliquée sans le clic de l'utilisateur. */
export const DUREE_RECOMMANDEE_AVATAR = 30;

/** Code de refus / de saut quand la durée doit être confirmée (« Produire maintenant », cron, file). */
export const CODE_DUREE_A_CONFIRMER = 'duree_a_confirmer';

/**
 * A4 v3 — avatar SEUL et cible sous `DUREE_MIN_AVATAR_SEUL` : le message
 * complet ne tient pas. Studiio ne génère RIEN (ni jumeau, ni rendu, ni
 * débit, ni post) et ne change JAMAIS la durée de lui-même : l'utilisateur
 * confirme en passant à 30 s (bouton « Passer à 30 s »). Pur.
 */
export function dureeAConfirmerAvecAvatar(duree: number | null | undefined, avatarSeul: boolean): boolean {
  return avatarSeul && !!duree && duree > 0 && duree < DUREE_MIN_AVATAR_SEUL;
}

/** Le message du refus et du conseil. */
export function messageDureeAConfirmer(duree: number): string {
  return `Avec votre avatar, ${duree} s est trop court pour un message complet. Passez à ${DUREE_RECOMMANDEE_AVATAR} s pour lancer la génération.`;
}

/** Le conseil affiché sous la durée de l'Autopilote, ou `null`. */
export function conseilDureeAvatar(duree: number | null | undefined, avatarSeul: boolean): { message: string; recommandee: number } | null {
  if (!dureeAConfirmerAvecAvatar(duree, avatarSeul)) return null;
  return {
    message: `${messageDureeAConfirmer(duree as number)} Aucune vidéo avec avatar n’est produite tant que la durée n’est pas confirmée.`,
    recommandee: DUREE_RECOMMANDEE_AVATAR,
  };
}
