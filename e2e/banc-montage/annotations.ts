/**
 * Annotations HUMAINES du banc de montage — modèle, validation, mesures de référence.
 *
 * Elles décrivent ce qu'une PERSONNE voit et entend dans un rush. Elles ne servent
 * qu'à JUGER les montages, jamais à les produire : le moteur ne les lit pas
 * (il reçoit, lui, des fiches de scènes — `fiches/`, format `fiche-scenes.ts`).
 * Module pur : aucun accès disque, aucun réseau.
 */
export type QualiteImage = 'nette' | 'moyenne' | 'floue';

export interface PassageAnnote {
  debut: number;
  fin: number;
  /** Ce qui est réellement visible. */
  action: string | null;
  /** 1 = ordinaire … 5 = moment fort. */
  interet: number | null;
  qualiteImage: QualiteImage | null;
  paroleAudible: boolean | null;
  horsSujet: boolean | null;
}

export interface AnnotationRush {
  version: 1;
  rush: string;
  annotateur: string;
  date: string;
  passages: PassageAnnote[];
}

/** Erreurs de forme, lisibles (vide = valide). Les `null` sont permis : « je ne sais pas ». */
export function validerAnnotation(a: unknown, duree: number | null = null): string[] {
  const e: string[] = [];
  if (!a || typeof a !== 'object') return ['le fichier n’est pas un objet JSON'];
  const x = a as Record<string, unknown>;
  if (x.version !== 1) e.push('version doit valoir 1');
  if (typeof x.rush !== 'string' || !x.rush.trim()) e.push('rush : nom du fichier vidéo manquant');
  if (typeof x.annotateur !== 'string' || !x.annotateur.trim() || /initiales ou nom/i.test(x.annotateur)) e.push('annotateur : à renseigner');
  if (typeof x.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) e.push('date : format AAAA-MM-JJ');
  if (!Array.isArray(x.passages) || !x.passages.length) { e.push('passages : au moins un passage'); return e; }
  let fin = 0;
  (x.passages as unknown[]).forEach((p, i) => {
    const n = `passage ${i + 1}`;
    if (!p || typeof p !== 'object') { e.push(`${n} : objet attendu`); return; }
    const q = p as Record<string, unknown>;
    if (typeof q.debut !== 'number' || typeof q.fin !== 'number' || !(q.fin > q.debut) || q.debut < 0) { e.push(`${n} : debut/fin invalides`); return; }
    if (q.debut < fin - 1e-6) e.push(`${n} : chevauche le précédent (ordonner et ne pas recouvrir)`);
    fin = Math.max(fin, q.fin);
    if (duree !== null && q.fin > duree + 0.5) e.push(`${n} : fin ${q.fin} s après la fin du rush (${Math.round(duree * 10) / 10} s)`);
    if (q.interet !== null && !(Number.isInteger(q.interet) && (q.interet as number) >= 1 && (q.interet as number) <= 5)) e.push(`${n} : interet entre 1 et 5 (ou null)`);
    if (q.qualiteImage !== null && !['nette', 'moyenne', 'floue'].includes(q.qualiteImage as string)) e.push(`${n} : qualiteImage = nette | moyenne | floue (ou null)`);
    for (const k of ['paroleAudible', 'horsSujet']) if (q[k] !== null && typeof q[k] !== 'boolean') e.push(`${n} : ${k} = true | false | null`);
    if (q.action !== null && typeof q.action !== 'string') e.push(`${n} : action = texte ou null`);
  });
  return e;
}

/** Le passage qui contient l'instant `t` de ce rush, ou `null`. */
export function passageA(a: AnnotationRush | null | undefined, t: number): PassageAnnote | null {
  return a?.passages.find((p) => t >= p.debut && t < p.fin) ?? null;
}

export interface SegmentPlan { rush: string; depuis: number; jusqua: number }

export interface MesuresReference {
  /** Secondes du montage couvertes par une annotation / total. */
  couvertureAnnotee: number;
  /** Intérêt moyen (1–5) pondéré par la durée, sur les secondes annotées. */
  interetMoyen: number | null;
  /** Secondes dans des passages marqués hors sujet. */
  secondesHorsSujet: number;
  /** Secondes dans des passages marqués flous. */
  secondesFloues: number;
  /** Bornes d'extrait posées au CŒUR d'un passage où la parole est audible (coupe possible dans une phrase). */
  bornesDansParole: number;
  bornes: number;
}

/** Mesures des extraits d'un plan CONTRE les annotations humaines. Pur. */
export function mesuresContreReference(plan: ReadonlyArray<SegmentPlan>, annotations: Readonly<Record<string, AnnotationRush>>): MesuresReference {
  let total = 0; let annotees = 0; let somme = 0; let horsSujet = 0; let floues = 0; let bornesParole = 0;
  const pas = 0.05;
  for (const s of plan) {
    const a = annotations[s.rush];
    for (let t = s.depuis; t < s.jusqua - 1e-9; t += pas) {
      total += pas;
      const p = passageA(a, t);
      if (!p) continue;
      annotees += pas;
      if (p.interet !== null) somme += p.interet * pas;
      if (p.horsSujet === true) horsSujet += pas;
      if (p.qualiteImage === 'floue') floues += pas;
    }
    for (const t of [s.depuis, s.jusqua]) {
      const p = passageA(a, t - 1e-6);
      if (p?.paroleAudible === true && t - p.debut > 0.15 && p.fin - t > 0.15) bornesParole += 1;
    }
  }
  const ar = (n: number) => Math.round(n * 100) / 100;
  return {
    couvertureAnnotee: total ? ar(annotees / total) : 0,
    interetMoyen: annotees ? ar(somme / annotees) : null,
    secondesHorsSujet: ar(horsSujet), secondesFloues: ar(floues), bornesDansParole: bornesParole, bornes: plan.length * 2,
  };
}

/** Une fiche de scènes recopiée sur l'annotation humaine n'est pas indépendante : à signaler. */
export function ficheCopieeDeLAnnotation(
  fiche: { scenes: Array<{ debut: number; fin: number; action: string | null }> },
  annotation: AnnotationRush,
): boolean {
  if (fiche.scenes.length !== annotation.passages.length) return false;
  return fiche.scenes.every((s, i) => {
    const p = annotation.passages[i];
    return Math.abs(s.debut - p.debut) < 0.01 && Math.abs(s.fin - p.fin) < 0.01 && (s.action ?? '') === (p.action ?? '');
  });
}
