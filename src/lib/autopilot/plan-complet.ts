/**
 * LE PLAN COMPLET DE LA SÉQUENCE « VIDÉO » — ce que le rendu jouera, plan par
 * plan, calculé AVANT génération par le MÊME orchestrateur que le moteur
 * (`planMultiSources`). Module PUR (aucun réseau), importable côté client.
 *
 * Le gabarit (« Plan avant génération ») ne dit que l'ordre des créneaux ;
 * avec avatar, le moteur remplit la parole par l'alternance avatar ↔ plans de
 * coupe jusqu'au CTA. Ce module rend la liste ENTIÈRE (créneaux + alternance
 * + CTA, avec leurs horaires), pour que le plan montré = le plan rendu.
 *
 * Entrée = le résumé que l'écran connaît déjà (`ResumeMediasApercu`) : il
 * peut aussi servir à l'aperçu (`etapesMontageApercuAutopilote`, #607).
 * Les durées de médias inconnues suivent les replis du moteur (vidéo stock :
 * `BROLL_VIDEO_S`, rush : une seule fenêtre depuis son début).
 */
import { planMultiSources, type EntreePlanMultiSources } from '@/lib/autopilot/plan-multi-sources';
import { estimerParoleJumeau } from '@/lib/autopilot/durees-sequences';
import { budgetScriptAvatar } from '@/lib/autopilot/duree-cible';
import type { VideoBrief } from '@/lib/creer/brief';
import type { ResumeMediasApercu } from '@/lib/autopilot/apercu-medias';
import { estRushStock } from '@/lib/autopilot/sources';
import type { RushSegment } from '@/lib/creer/multi-rush';
import type { RythmeBrief } from '@/lib/creer/brief';

/** Repère d'URL de l'avatar quand l'écran ne connaît pas encore sa vidéo. */
export const URL_AVATAR_PREVU = 'avatar:prevu';

export type GenreSegmentPlan = 'avatar' | 'rush' | 'video' | 'photo';

export interface SegmentPlanComplet {
  genre: GenreSegmentPlan;
  /** Accroche (premier plan d'avatar), CTA (dernier plan d'avatar), sinon `null`. */
  role: 'accroche' | 'cta' | null;
  /** URL du média (avatar : celle de la vidéo, ou `URL_AVATAR_PREVU`). */
  url: string;
  debut: number;
  fin: number;
  duree: number;
}

export interface OptionsPlanComplet {
  /** Parole de l'avatar (s) — mesurée si connue. Sinon estimée depuis `scriptAvatar`, sinon `cible`. */
  secondesAvatar?: number | null;
  /** Script que l'avatar dira : la parole est ESTIMÉE (`estimerParoleJumeau`). */
  scriptAvatar?: string | null;
  /** Parole ESTIMÉE (s), déjà calculée (`paroleAvatarDuBudget`) — prioritaire sur `scriptAvatar`. */
  secondesAvatarEstimees?: number | null;
  rythme?: RythmeBrief | null;
  /** Durée visée de la séquence (sans avatar, ou repli de la parole). */
  cible: number;
  /** Durées connues des vidéos (rushes, vidéos stock), en secondes. */
  durees?: Readonly<Record<string, number | null | undefined>>;
  /** URL de la vidéo de l'avatar, si connue. */
  urlAvatar?: string | null;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Les segments rendus, dans le vocabulaire de l'écran. Pur. */
export function segmentsDuPlan(plan: ReadonlyArray<RushSegment>): SegmentPlanComplet[] {
  const iAvatars = plan.map((s, i) => (s.kind === 'avatar' ? i : -1)).filter((i) => i >= 0);
  const dernierAvatar = iAvatars.length > 1 && iAvatars[iAvatars.length - 1] === plan.length - 1 ? plan.length - 1 : -1;
  return plan.map((s, i) => {
    const genre: GenreSegmentPlan = s.kind === 'avatar' ? 'avatar'
      : s.kind === 'image' || s.source === 'photo' ? 'photo'
        : s.source === 'stock' ? 'video' : 'rush';
    const role = genre !== 'avatar' ? null : i === 0 && plan.length > 1 ? 'accroche' : i === dernierAvatar ? 'cta' : null;
    return { genre, role, url: s.url, debut: r3(s.debut), fin: r3(s.fin), duree: r3(s.fin - s.debut) };
  });
}

/**
 * La parole que le BUDGET du script de production implique : le script réel
 * est écrit au créneau, dimensionné à `budgetScriptAvatar` — sa parole
 * estimée (`estimerParoleJumeau` sur un script de cette longueur) ≈ la cible
 * par construction. `null` sans durée cible.
 */
export function paroleAvatarDuBudget(brief: VideoBrief | null | undefined, secondesReservees?: number): number | null {
  const budget = budgetScriptAvatar(brief, secondesReservees);
  if (!budget) return null;
  return estimerParoleJumeau('x'.repeat(budget), brief?.rythme);
}

/** La durée de parole retenue pour l'avatar, dans l'ordre : mesurée, estimée, cible. */
export function secondesAvatarPrevues(o: Pick<OptionsPlanComplet, 'secondesAvatar' | 'secondesAvatarEstimees' | 'scriptAvatar' | 'rythme' | 'cible'>): number {
  if (typeof o.secondesAvatar === 'number' && o.secondesAvatar > 0) return o.secondesAvatar;
  if (typeof o.secondesAvatarEstimees === 'number' && o.secondesAvatarEstimees > 0) return o.secondesAvatarEstimees;
  const estimee = o.scriptAvatar ? estimerParoleJumeau(o.scriptAvatar, o.rythme) : 0;
  return estimee > 0 ? estimee : o.cible;
}

/** L'entrée de l'orchestrateur, construite depuis ce que l'écran connaît. Pur. */
export function entreeDepuisResume(resume: ResumeMediasApercu, o: OptionsPlanComplet): EntreePlanMultiSources {
  const duree = (u: string) => {
    const d = o.durees?.[u];
    return typeof d === 'number' && d > 0 ? d : null;
  };
  const avatarOk = resume.actives.avatar && resume.avatar.disponible;
  const rushes = resume.actives.rushes ? resume.rushesPerso.filter((u) => !estRushStock(u)) : [];
  const stock = resume.actives.stock ? resume.stock : [];
  return {
    avatar: avatarOk ? { url: o.urlAvatar || URL_AVATAR_PREVU, secondes: secondesAvatarPrevues(o) } : null,
    rushes: rushes.map((url) => ({ url, secondes: duree(url) })),
    stockVideos: stock.filter((m) => m.type === 'video').map((m) => ({ url: m.url, secondes: duree(m.url) })),
    photos: stock.filter((m) => m.type === 'photo').map((m) => m.url),
    gabarit: resume.gabarit,
    cible: o.cible,
  };
}

/**
 * LE PLAN COMPLET (créneaux + alternance + CTA) pour le résumé de l'écran.
 * Même fonction que le moteur : mêmes entrées → mêmes plans.
 */
export function planCompletAutopilote(resume: ResumeMediasApercu, o: OptionsPlanComplet): { segments: SegmentPlanComplet[]; duree: number } {
  const r = planMultiSources(entreeDepuisResume(resume, o));
  return { segments: segmentsDuPlan(r.plan), duree: r3(r.duree) };
}
