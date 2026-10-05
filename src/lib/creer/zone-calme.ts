/**
 * ZONE CALME DE LA SORTIE (#502) — où poser le CTA.
 *
 * Mesure, pas reconnaissance : Studiio ne détecte ni visages ni corps. Ce
 * module lit l'empreinte 8×8 de chaque échantillon d'analyse (luminosité par
 * bloc, `mesurerImage`) et mesure, sur les plans visibles sous le CTA, de
 * combien chaque BANDE de l'image change d'un échantillon au suivant :
 *   haut = rangées 0–1 (quart haut), centre = 3–4, bas = 6–7.
 * La bande haute ou basse la plus calme reçoit le CTA. Pur.
 */
import type { RushSegment } from '@/lib/creer/multi-rush';
import { cleSource, type AnalyseRush } from '@/lib/creer/smart-montage';
import type { BandeCta } from '@/lib/creer/surimpressions-mise-en-page';

export interface ActiviteBandes { haut: number; centre: number; bas: number }

const RANGEES: Record<keyof ActiviteBandes, number[]> = { haut: [0, 1], centre: [3, 4], bas: [6, 7] };

/** Activité moyenne de chaque bande sur [depuis, jusqua] d'un rush ; `null` sans empreintes. */
export function activiteBandes(analyse: AnalyseRush, depuis: number, jusqua: number): ActiviteBandes | null {
  const ech = analyse.echantillons
    .filter((e) => Array.isArray(e.empreinte) && e.empreinte.length === 64 && e.t >= depuis - 1.5 && e.t <= jusqua + 1.5)
    .sort((a, b) => a.t - b.t);
  if (ech.length < 2) return null;
  const somme: ActiviteBandes = { haut: 0, centre: 0, bas: 0 };
  for (let i = 1; i < ech.length; i++) {
    const a = ech[i - 1].empreinte!; const b = ech[i].empreinte!;
    for (const k of Object.keys(RANGEES) as Array<keyof ActiviteBandes>) {
      let d = 0;
      for (const r of RANGEES[k]) for (let c = 0; c < 8; c++) d += Math.abs(b[r * 8 + c] - a[r * 8 + c]);
      somme[k] += d / (RANGEES[k].length * 8);
    }
  }
  const n = ech.length - 1;
  return { haut: somme.haut / n, centre: somme.centre / n, bas: somme.bas / n };
}

export interface ZoneCalme {
  bande: BandeCta;
  /** 0..1 — à quel point la bande retenue est plus calme que la plus agitée. */
  score: number;
  activite: ActiviteBandes;
}

/**
 * Bande (haut / bas) la plus calme sur les plans visibles à partir de
 * `debutCta`. `null` si rien n'est mesurable : le CTA reste en bas (avant).
 */
export function zoneCalmeSortie(plan: ReadonlyArray<RushSegment>, analyses: ReadonlyArray<AnalyseRush>, debutCta: number): ZoneCalme | null {
  const parCle = new Map(analyses.map((a) => [cleSource(a.url), a]));
  const total: ActiviteBandes = { haut: 0, centre: 0, bas: 0 };
  let poids = 0;
  for (const s of plan) {
    const recouvre = Math.min(s.fin, Infinity) - Math.max(s.debut, debutCta);
    if (recouvre <= 0) continue;
    const a = parCle.get(cleSource(s.url));
    if (!a) continue;
    const depuis = (s.depuis ?? 0) + Math.max(0, debutCta - s.debut);
    const m = activiteBandes(a, depuis, s.jusqua ?? (s.depuis ?? 0) + (s.fin - s.debut));
    if (!m) continue;
    total.haut += m.haut * recouvre; total.centre += m.centre * recouvre; total.bas += m.bas * recouvre;
    poids += recouvre;
  }
  if (!poids) return null;
  const act: ActiviteBandes = { haut: total.haut / poids, centre: total.centre / poids, bas: total.bas / poids };
  // À égalité (± 10 %), le bas — la place d'avant.
  const bande: BandeCta = act.haut < act.bas * 0.9 ? 'haut' : 'bas';
  const max = Math.max(act.haut, act.centre, act.bas, 1e-6);
  return { bande, score: Math.round((1 - act[bande] / max) * 100) / 100, activite: act };
}
