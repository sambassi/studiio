/**
 * APERÇU DE L'AUTOPILOTE — quel média montrer dans la séquence « Vidéo ».
 *
 * ⚠️ L'APERÇU MONTRAIT `config.rushUrls[0]`, quoi qu'il arrive. Or
 * `retenirStock` ajoute les vidéos suggérées retenues à `rushUrls` : le
 * premier « rush » pouvait donc être une vidéo stock, montrée même source
 * stock décochée, même quand le plan commençait par l'avatar, même quand le
 * rush était expiré. L'utilisateur croyait voir SA vidéo.
 *
 * La règle est désormais celle du PLAN (`PlanAvantGeneration`) : le gabarit
 * enregistré, sinon le gabarit suggéré (`gabaritSuggere`). Le premier
 * créneau qui se résout sur un média RÉEL l'emporte :
 *   - avatar → l'avatar prêt (sa source existante, jamais une génération) ;
 *   - rush   → un rush personnel utilisable (jamais un stock, jamais expiré) ;
 *   - stock  → un média réellement retenu (jamais si la source est décochée) ;
 *   - auto   → avatar, sinon rush, sinon stock (l'ordre de `gabaritSuggere`).
 * Rien de réel → un emplacement ÉTIQUETÉ, jamais une vidéo générique.
 *
 * Module PUR, sans import serveur : il est lu par le wizard (client).
 */
import type { CreneauGabarit, MediaStockRetenu, SourcesActives } from '@/lib/autopilot/sources';
import { estRushStock } from '@/lib/autopilot/sources';

/** Ce que le panneau sait des médias du plan — remonté au wizard. */
export interface ResumeMediasApercu {
  /** Le gabarit EFFECTIF : enregistré, sinon suggéré. */
  gabarit: CreneauGabarit[];
  actives: SourcesActives;
  /** Rushes personnels UTILISABLES (ni stock, ni expirés) — vide si la source est décochée. */
  rushesPerso: string[];
  /** Médias stock retenus — vide si la source est décochée. */
  stock: MediaStockRetenu[];
  /** L'avatar porte-t-il la production (demandé ET prêt) ? Sa vignette, si connue. */
  avatar: { disponible: boolean; vignette: { url: string; type: 'photo' | 'video' } | null };
}

export type MediaApercuAutopilote =
  | { type: 'avatar'; sequence: number; etiquette: string; url: string | null; media: 'photo' | 'video' }
  | { type: 'rush'; sequence: number; etiquette: string; url: string }
  | { type: 'stock'; sequence: number; etiquette: string; url: string; media: 'video' | 'photo'; vignetteUrl: string | null }
  | { type: 'aucun'; etiquette: string };

export const ETIQUETTE_AUCUN_MEDIA = 'Aucun média réel choisi — la séquence vidéo sera remplie à la production';

/** Le nom lisible d'un rush : son fichier, sinon « Rush N ». Jamais un nom de fournisseur. */
export function nomRush(url: string, rang: number): string {
  let nom = '';
  try { nom = decodeURIComponent(new URL(url, 'http://local.invalid').pathname.split('/').pop() || ''); } catch { nom = ''; }
  if (!nom || /pexels|unsplash/i.test(nom)) return `Rush ${rang + 1}`;
  return nom;
}

function resoudreCreneau(c: CreneauGabarit, n: number, r: ResumeMediasApercu): MediaApercuAutopilote | null {
  const avatar = (): MediaApercuAutopilote | null => (r.actives.avatar && r.avatar.disponible
    ? { type: 'avatar', sequence: n, etiquette: `Séquence ${n} — Mon avatar`, url: r.avatar.vignette?.url ?? null, media: r.avatar.vignette?.type ?? 'photo' }
    : null);
  const rush = (force?: string): MediaApercuAutopilote | null => {
    if (!r.actives.rushes) return null;
    const perso = r.rushesPerso.filter((u) => !estRushStock(u));
    const url = force && perso.includes(force) ? force : perso[0];
    if (!url) return null;
    return { type: 'rush', sequence: n, etiquette: `Séquence ${n} — Rush : ${nomRush(url, perso.indexOf(url))}`, url };
  };
  const stock = (force?: string): MediaApercuAutopilote | null => {
    if (!r.actives.stock) return null;
    const m = (force ? r.stock.find((s) => s.url === force) : undefined) ?? r.stock[0];
    if (!m) return null;
    return { type: 'stock', sequence: n, etiquette: `Séquence ${n} — Média suggéré`, url: m.url, media: m.type, vignetteUrl: m.vignetteUrl || null };
  };
  if (c.type === 'avatar') return avatar();
  if (c.type === 'rush') return rush(c.media);
  if (c.type === 'stock') return stock(c.media);
  return avatar() ?? rush() ?? stock();
}

/**
 * Le média de la séquence « Vidéo » de l'aperçu.
 *
 * Sans résumé (panneau absent, ou pas encore remonté) : le comportement
 * d'avant — le premier rush de la banque — SAUF qu'un média stock n'est plus
 * jamais pris pour un rush, ni montré quand la source rushes est décochée.
 */
export function mediaApercuAutopilote(
  resume: ResumeMediasApercu | null | undefined,
  repli: { rushUrls: readonly string[]; actives?: Partial<SourcesActives> | null },
): MediaApercuAutopilote {
  if (!resume) {
    if (repli.actives?.rushes === false) return { type: 'aucun', etiquette: ETIQUETTE_AUCUN_MEDIA };
    const perso = repli.rushUrls.filter((u) => !estRushStock(u));
    const url = perso[0];
    return url
      ? { type: 'rush', sequence: 1, etiquette: `Séquence 1 — Rush : ${nomRush(url, 0)}`, url }
      : { type: 'aucun', etiquette: ETIQUETTE_AUCUN_MEDIA };
  }
  for (let i = 0; i < resume.gabarit.length; i += 1) {
    const m = resoudreCreneau(resume.gabarit[i], i + 1, resume);
    if (m) return m;
  }
  return { type: 'aucun', etiquette: ETIQUETTE_AUCUN_MEDIA };
}

/** La séquence « Vidéo » existe-t-elle dans le montage ? (même règle que le moteur : un plan non vide). */
export function aUneSequenceVideo(
  resume: ResumeMediasApercu | null | undefined,
  repli: { rushUrls: readonly string[] },
): boolean {
  return resume ? resume.gabarit.length > 0 : repli.rushUrls.length > 0;
}

/** Signature stable d'un résumé — pour ne remonter qu'un changement réel. */
export function signatureResume(r: ResumeMediasApercu): string {
  return JSON.stringify([
    r.gabarit.map((c) => [c.type, c.media ?? '']),
    r.actives,
    r.rushesPerso,
    r.stock.map((m) => [m.url, m.type, m.vignetteUrl]),
    r.avatar.disponible,
    r.avatar.vignette?.url ?? '',
    r.avatar.vignette?.type ?? '',
  ]);
}
