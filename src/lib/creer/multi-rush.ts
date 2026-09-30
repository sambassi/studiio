/**
 * MULTI-RUSH — plusieurs rushes enchaînés dans la séquence « Vidéo ».
 *
 * Module PUR, partagé par le wizard Créer, le compositeur navigateur
 * (`video-composer.ts`), la relecture des posts (`to-wizard`,
 * `optionsRenduDepuisMetadata`) et la composition Remotion
 * (`CreerSimpleMontage`). Une seule règle de découpage, donc un seul
 * montage quel que soit le chemin.
 *
 * ── Compatibilité (règle « Default safe ») ─────────────────────────────
 * Le multi-rush n'est activé QUE par `metadata.rushSegments` (≥ 2 entrées),
 * écrit par Créer quand l'utilisateur a monté plusieurs rushes. Il ne se
 * déduit JAMAIS de `metadata.rushUrls.length` : des posts de l'Agent IA
 * portent la banque entière sous `rushUrls` alors que leur montage n'en a
 * utilisé qu'un. Sans `rushSegments`, tout chemin garde `rushUrls[0]` —
 * exactement le rendu d'avant.
 *
 * ── Répartition de la durée ────────────────────────────────────────────
 * La séquence « Vidéo » a une durée (celle réglée à l'écran). Dans le wizard
 * elle vaut la SOMME des durées retenues de chaque rush (durée sondée,
 * bornée comme pour un rush unique). Au rendu, chaque rush reçoit une part
 * PROPORTIONNELLE à sa durée retenue, ramenée à la durée réelle de la
 * séquence : quand la somme égale cette durée (cas normal), chaque rush joue
 * exactement sa durée. Durée inconnue pour l'un d'eux : parts égales.
 */

/** Un rush de la liste, tel que le wizard le porte. */
export interface RushItem {
  url: string;
  name: string;
  /** Extrait produit par « Temps forts » (ne se redécoupe pas). */
  isClip?: boolean;
  /** Durée retenue (s), déjà bornée. `null` = pas encore sondée / illisible. */
  secondes?: number | null;
}

/** Place d'un rush dans la séquence « Vidéo », en secondes depuis son début. */
export interface RushSegment {
  url: string;
  debut: number;
  fin: number;
  /**
   * SMART MONTAGE (`smart-montage.ts`) : point d'entrée DANS le rush (s).
   * Absent = 0, le rush joue depuis son début — l'enchaînement d'avant.
   */
  depuis?: number;
  /** Score de l'extrait (smart montage), informatif. */
  score?: number;
  /** Fin de l'extrait DANS le rush (s) — smart montage V2. */
  jusqua?: number;
  /** Qualité technique 0..1 (netteté, exposition, mouvement). */
  qualite?: number;
  /** Pertinence 0..1 pour le thème / l'objectif ; `null` = aucune information. */
  pertinence?: number | null;
  /** Pourquoi l'extrait a été retenu, lisible. */
  raison?: string;
}

const arrondi = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Découpe la séquence « Vidéo » entre les rushes, dans l'ordre.
 *
 * - 0 rush : `[]`.
 * - 1 rush : `[{ url, debut: 0, fin: duree }]` — le rush unique d'avant.
 * - n rushes : parts proportionnelles aux durées retenues (égales si l'une
 *   manque), contiguës, la dernière finissant exactement à `duree`.
 */
export function planRushs(
  rushs: ReadonlyArray<{ url: string; secondes?: number | null }>,
  duree: number,
): RushSegment[] {
  const liste = rushs.filter((r) => typeof r?.url === 'string' && r.url.length > 0);
  const total = Number.isFinite(duree) && duree > 0 ? duree : 0;
  if (liste.length === 0) return [];
  if (liste.length === 1) return [{ url: liste[0].url, debut: 0, fin: total }];
  const poidsConnus = liste.every((r) => typeof r.secondes === 'number' && Number.isFinite(r.secondes) && r.secondes > 0);
  const poids = poidsConnus ? liste.map((r) => r.secondes as number) : liste.map(() => 1);
  const somme = poids.reduce((a, b) => a + b, 0);
  const segments: RushSegment[] = [];
  let cumul = 0;
  liste.forEach((r, i) => {
    const debut = arrondi((cumul / somme) * total);
    cumul += poids[i];
    const fin = i === liste.length - 1 ? total : arrondi((cumul / somme) * total);
    segments.push({ url: r.url, debut, fin });
  });
  return segments;
}

/** Durée de la séquence « Vidéo » pour une liste : la somme des durées retenues. */
export function dureeMultiRush(secondes: ReadonlyArray<number | null | undefined>, repli: number): number {
  return secondes.reduce<number>((t, s) => t + (typeof s === 'number' && s > 0 ? s : repli), 0);
}

/** Le segment qui joue à `secondes` depuis le début de la séquence (le dernier au-delà). */
export function segmentA<T extends { debut: number; fin: number }>(plan: ReadonlyArray<T>, secondes: number): T | null {
  if (plan.length === 0) return null;
  for (const s of plan) if (secondes < s.fin) return s;
  return plan[plan.length - 1];
}

/** Déplace l'élément `i` de `delta` places (bornées). Nouvelle liste. */
export function deplacer<T>(liste: ReadonlyArray<T>, i: number, delta: number): T[] {
  const j = i + delta;
  if (i < 0 || i >= liste.length || j < 0 || j >= liste.length) return [...liste];
  const out = [...liste];
  const [x] = out.splice(i, 1);
  out.splice(j, 0, x);
  return out;
}

/** Retire l'élément `i`. Nouvelle liste. */
export function retirer<T>(liste: ReadonlyArray<T>, i: number): T[] {
  return liste.filter((_, k) => k !== i);
}

/**
 * Relit `metadata.rushSegments`. `null` s'il est absent, mal formé ou à moins
 * de 2 entrées — le post est alors un post mono-rush, relu comme avant.
 */
export function rushSegmentsDepuisMetadata(valeur: unknown): RushSegment[] | null {
  if (!Array.isArray(valeur) || valeur.length < 2) return null;
  const out: RushSegment[] = [];
  for (const v of valeur) {
    if (!v || typeof v !== 'object') return null;
    const { url, debut, fin, depuis, score, jusqua, qualite, pertinence, raison } = v as Record<string, unknown>;
    if (typeof url !== 'string' || !url) return null;
    if (typeof debut !== 'number' || typeof fin !== 'number' || !Number.isFinite(debut) || !Number.isFinite(fin) || fin <= debut) return null;
    out.push({
      url, debut, fin,
      ...(typeof depuis === 'number' && Number.isFinite(depuis) && depuis > 0 ? { depuis } : {}),
      ...(typeof score === 'number' && Number.isFinite(score) ? { score } : {}),
      ...(typeof jusqua === 'number' && Number.isFinite(jusqua) ? { jusqua } : {}),
      ...(typeof qualite === 'number' && Number.isFinite(qualite) ? { qualite } : {}),
      ...(typeof pertinence === 'number' && Number.isFinite(pertinence) ? { pertinence } : pertinence === null ? { pertinence: null } : {}),
      ...(typeof raison === 'string' && raison ? { raison: raison.slice(0, 400) } : {}),
    });
  }
  return out;
}

/** Liste « rendu » (url + durée retenue) depuis des segments relus. */
export function rushsDepuisSegments(segments: ReadonlyArray<RushSegment>): { url: string; secondes: number }[] {
  return segments.map((s) => ({ url: s.url, secondes: arrondi(s.fin - s.debut) }));
}

/**
 * Vrai si les segments sont un PLAN DE MONTAGE (smart montage) et non un
 * simple enchaînement : un point d'entrée non nul ou un rush repris.
 */
export function estPlanMontage(segments: ReadonlyArray<RushSegment> | null | undefined): boolean {
  if (!segments || segments.length < 2) return false;
  const urls = new Set(segments.map((s) => s.url));
  return urls.size < segments.length || segments.some((s) => typeof s.depuis === 'number' && s.depuis > 0);
}

/** Les rushes d'un plan, sans doublon, dans l'ordre de première apparition. */
export function rushsDuPlan(segments: ReadonlyArray<RushSegment>): { url: string; secondes: null }[] {
  const vus = new Set<string>();
  const out: { url: string; secondes: null }[] = [];
  for (const s of segments) if (!vus.has(s.url)) { vus.add(s.url); out.push({ url: s.url, secondes: null }); }
  return out;
}
