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
import { AVATAR_FENETRE_S, BROLL_PHOTO_S, BROLL_VIDEO_S, MOUVEMENTS_PHOTO } from '@/lib/autopilot/plan-multi-sources';
import { TRANSITION_DURATION_SECONDS } from '@/lib/creer/transitionPreview';
import type { EtapeApercu, LigneChronologie } from '@/lib/creer/medias-video';

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

/**
 * APERÇU DU MONTAGE PRÉVU — TOUS les créneaux du plan, dans l'ordre.
 *
 * ⚠️ `mediaApercuAutopilote` ne rend que le PREMIER créneau résoluble : le
 * bloc « Aperçu du style » montrait donc un seul média (souvent un stock, ou
 * toujours le même rush) et jamais l'enchaînement réel. Ici, chaque créneau
 * du gabarit devient une étape d'`ApercuMontageListe` :
 *   - avatar → TOUJOURS un emplacement (`url: null`) : la vidéo de l'avatar
 *     n'existe qu'à la production (« Votre avatar parlera ici »). Jamais un
 *     stock à sa place. Source avatar décochée : le créneau est omis ;
 *   - rush   → ROTATION sur les rushes personnels (1er créneau rush → rush 1,
 *     2e → rush 2…), sauf média imposé par le gabarit ;
 *   - stock  → ROTATION sur les médias retenus, sauf média imposé ;
 *   - auto   → avatar prêt, sinon rush suivant, sinon stock suivant.
 * Un créneau sans média réel est omis (jamais une vidéo générique).
 *
 * Durées INDICATIVES (celles des plans de coupe du moteur) : la vidéo finale
 * prend la durée réelle de la parole / des extraits. Pur, sans réseau.
 */
export function etapesMontageApercuAutopilote(
  resume: ResumeMediasApercu | null | undefined,
  opts: { dureeCta?: number | null } = {},
): { etapes: EtapeApercu[]; lignes: LigneChronologie[]; duree: number } {
  const etapes: EtapeApercu[] = [];
  if (resume) {
    const perso = resume.actives.rushes ? resume.rushesPerso.filter((u) => !estRushStock(u)) : [];
    const stock = resume.actives.stock ? resume.stock : [];
    let rangRush = 0;
    let rangStock = 0;
    let photos = 0;
    let t = 0;
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const pousser = (e: Omit<EtapeApercu, 'debut' | 'fin' | 'depuis' | 'horsNarration' | 'id'>, secondes: number) => {
      const debut = r3(t);
      t += secondes;
      etapes.push({ ...e, id: `creneau-${etapes.length + 1}`, debut, fin: r3(t), depuis: 0, horsNarration: false });
    };
    const avatar = (): boolean => {
      if (!resume.actives.avatar) return false;
      pousser({ source: 'avatar', type: 'video', url: null, libelle: 'Mon avatar' }, AVATAR_FENETRE_S);
      return true;
    };
    const rush = (force?: string): boolean => {
      if (!perso.length) return false;
      const url = force && perso.includes(force) ? force : perso[rangRush++ % perso.length];
      pousser({ source: 'rush', type: 'video', url, libelle: `Rush : ${nomRush(url, perso.indexOf(url))}` }, BROLL_VIDEO_S);
      return true;
    };
    const media = (force?: string): boolean => {
      if (!stock.length) return false;
      const m = (force ? stock.find((s) => s.url === force) : undefined) ?? stock[rangStock++ % stock.length];
      if (m.type === 'photo') {
        pousser({
          source: 'stock-photo', type: 'image', url: m.url, libelle: 'Photo suggérée',
          mouvement: MOUVEMENTS_PHOTO[photos++ % MOUVEMENTS_PHOTO.length],
        }, BROLL_PHOTO_S);
      } else {
        pousser({ source: 'stock-video', type: 'video', url: m.url, libelle: 'Vidéo suggérée' }, BROLL_VIDEO_S);
      }
      return true;
    };
    for (const c of resume.gabarit) {
      if (c.type === 'avatar') avatar();
      else if (c.type === 'rush') rush(c.media);
      else if (c.type === 'stock') media(c.media);
      else if (!(resume.avatar.disponible && avatar())) { if (!rush()) media(); }
    }
  }
  const duree = etapes.length ? etapes[etapes.length - 1].fin : 0;
  const lignes: LigneChronologie[] = etapes.map((e) => ({ id: e.id, libelle: e.libelle, debut: e.debut, fin: e.fin }));
  const cta = typeof opts.dureeCta === 'number' && Number.isFinite(opts.dureeCta) && opts.dureeCta > 0 ? opts.dureeCta : null;
  if (cta !== null && etapes.length) {
    const fondu = Math.round(Math.min(TRANSITION_DURATION_SECONDS, duree) * 1000) / 1000;
    lignes.push({ id: 'cta', libelle: 'CTA', debut: duree, fin: Math.round((duree + cta) * 1000) / 1000, cta: true, ...(fondu > 0 ? { fondu } : {}) });
  }
  return { etapes, lignes, duree };
}
