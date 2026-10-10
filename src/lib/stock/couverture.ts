/**
 * Couverture des rushes — `analyserCouvertureRushes`.
 *
 * ⚠️ PAS DE SEUIL ARBITRAIRE (« moins de 5 rushes = insuffisant »). On part
 * des PLANS que le montage va réellement remplir (les séquences vidéo de
 * Créer, les phases du smart montage de l'Autopilote) et on y affecte les
 * rushes disponibles, par ordre de priorité :
 *
 *   1. rushes de l'utilisateur (jamais retirés, jamais remplacés) ;
 *   2. médias de sa Médiathèque ;
 *   3. médias stock déjà acceptés.
 *
 * Un rush nourrit UN plan ; un rush long (≥ `DUREE_DEUX_PLANS`) en nourrit
 * deux sans que la répétition se voie. Un plan sans rush devient un MANQUE,
 * avec son brief de recherche (intention, type, requêtes). Le résultat est
 * explicable ligne par ligne (`raison`).
 *
 * Pure : aucun réseau. Couverture suffisante → aucun manque → aucune
 * recherche stock.
 */
import { construireRecherchesStock, type RoleSequence } from './requetes';
import type { FormatStock, TypeStock } from './types';

/**
 * `avatar` : l'avatar personnel (jumeau), quand l'utilisateur le fait
 * apparaître. Il passe AVANT tout rush — c'est le personnage principal — et
 * tient UN plan (l'accroche, le premier) ; les autres plans restent à
 * couvrir par ses rushes, sa Médiathèque, puis le stock. Ce n'est pas un
 * fichier : son `url` est un jeton (`AVATAR_PRINCIPAL`), jamais téléchargé.
 */
export type OrigineRush = 'avatar' | 'utilisateur' | 'mediatheque' | 'stock';

/** Le « rush » qui représente l'avatar personnel dans l'analyse de couverture. */
export const AVATAR_PRINCIPAL = 'avatar:principal';

export interface RushDisponible {
  url: string;
  origine: OrigineRush;
  /** Durée connue (secondes) ; inconnue → le rush ne compte que pour un plan. */
  dureeSecondes?: number | null;
}

export interface PlanAVisuel {
  cle: string;
  role: RoleSequence;
  /** Ce que dit / montre la séquence. */
  texte?: string | null;
  type?: TypeStock;
}

export interface EntreeCouverture {
  plans: ReadonlyArray<PlanAVisuel>;
  rushes: ReadonlyArray<RushDisponible>;
  sujet?: string | null;
  objectif?: string | null;
  format?: FormatStock;
}

export interface ManqueCouverture {
  sequence: string;
  role: RoleSequence;
  type: TypeStock;
  theme: string;
  searchQueries: string[];
  raison: string;
}

export interface CouvertureRushes {
  couvertureSuffisante: boolean;
  affectations: Array<{ sequence: string; rushUrl: string; origine: OrigineRush }>;
  manques: ManqueCouverture[];
  rushesPersonnels: number;
  explication: string[];
}

/** Au-delà, un même rush peut fournir deux plans distincts sans répétition visible. */
export const DUREE_DEUX_PLANS = 16;
/** Plus court, un rush ne fournit pas un plan exploitable. */
export const DUREE_MIN_PLAN = 1.5;

const PRIORITE: Record<OrigineRush, number> = { avatar: -1, utilisateur: 0, mediatheque: 1, stock: 2 };

export function plansParRush(duree?: number | null): number {
  if (duree == null || !Number.isFinite(duree)) return 1;
  if (duree < DUREE_MIN_PLAN) return 0;
  return duree >= DUREE_DEUX_PLANS ? 2 : 1;
}

export function analyserCouvertureRushes(e: EntreeCouverture): CouvertureRushes {
  const format = e.format ?? '9:16';
  const uniques = e.rushes.filter((r, i, t) => r.url && t.findIndex((x) => x.url === r.url) === i);
  const rushes = uniques
    .map((r, i) => ({ r, i, reste: plansParRush(r.dureeSecondes) }))
    .sort((a, b) => PRIORITE[a.r.origine] - PRIORITE[b.r.origine] || a.i - b.i);
  const explication: string[] = [];
  const affectations: CouvertureRushes['affectations'] = [];
  const plansVideo = e.plans.filter((p) => (p.type ?? 'video') === 'video');

  // Deux passes : d'abord un rush DIFFÉRENT par plan, ensuite seulement la
  // seconde capacité des rushes longs.
  const libres = new Set(plansVideo.map((p) => p.cle));
  for (let passe = 0; passe < 2; passe++) {
    for (const p of plansVideo) {
      if (!libres.has(p.cle)) continue;
      // L'avatar ne tient qu'UN plan : jamais de « second plan » pour lui.
      const choix = rushes.find((x) => x.reste > 0
        && (passe === 1 ? x.r.origine !== 'avatar' : !affectations.some((a) => a.rushUrl === x.r.url)));
      if (!choix) continue;
      choix.reste -= 1;
      libres.delete(p.cle);
      affectations.push({ sequence: p.cle, rushUrl: choix.r.url, origine: choix.r.origine });
      explication.push(`${p.cle} : ${choix.r.origine === 'avatar' ? 'votre avatar' : choix.r.origine === 'utilisateur' ? 'votre rush' : choix.r.origine === 'mediatheque' ? 'votre Médiathèque' : 'média stock accepté'}${passe === 1 ? ' (second plan d’un rush long)' : ''}`);
    }
  }

  const manques: ManqueCouverture[] = [];
  const avecAvatar = uniques.some((r) => r.origine === 'avatar');
  const medias = uniques.filter((r) => r.origine !== 'avatar');
  for (const p of plansVideo) {
    if (!libres.has(p.cle)) continue;
    const r = construireRecherchesStock({ sujet: e.sujet, objectif: e.objectif, texte: p.texte, role: p.role, visuel: 'video', format });
    const raison = medias.length === 0
      ? (avecAvatar ? 'votre avatar tient déjà l’accroche — plan complémentaire à illustrer' : 'aucun rush disponible')
      : 'tous vos rushes sont déjà utilisés — les réutiliser répéterait le même plan';
    manques.push({
      sequence: p.cle,
      role: p.role,
      type: 'video',
      theme: r.intentions.slice(0, 3).join(' / ') || 'général',
      searchQueries: r.requetes,
      raison,
    });
    explication.push(`${p.cle} : manque — ${raison}`);
  }

  return {
    couvertureSuffisante: manques.length === 0,
    affectations,
    manques,
    rushesPersonnels: uniques.filter((r) => r.origine === 'utilisateur').length,
    explication,
  };
}

/**
 * Les plans d'un montage Autopilote : autant que de rushes réunis par le
 * smart montage (`RUSHS_MONTAGE_MAX` de `lib/autopilot/produire.ts`, 3), avec
 * l'intention de chaque phase (accroche, développement, temps fort).
 */
export const PLANS_MONTAGE_AUTOPILOTE = 3;

export function plansAutopilote(sujet: string, message?: string | null): PlanAVisuel[] {
  const phases: Array<[RoleSequence, string]> = [
    ['HOOK', sujet],
    ['BUILD', `${message ?? ''} ${sujet}`],
    ['PEAK', `${sujet} avec énergie`],
  ];
  return phases.slice(0, PLANS_MONTAGE_AUTOPILOTE).map(([role, texte], i) => ({ cle: `plan-${i + 1}`, role, texte, type: 'video' }));
}
