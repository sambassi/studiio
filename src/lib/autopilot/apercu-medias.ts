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
import { MOUVEMENTS_PHOTO } from '@/lib/autopilot/plan-multi-sources';
import { planCompletAutopilote, URL_AVATAR_PREVU } from '@/lib/autopilot/plan-complet';
import type { ContexteTextesAutopilote } from '@/lib/autopilot/montage-avatar';
import { DUREE_ESTIMEE_SANS_CIBLE } from '@/lib/autopilot/duree-cible';
import type { RythmeBrief } from '@/lib/creer/brief';
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
  avatar: {
    disponible: boolean;
    vignette: { url: string; type: 'photo' | 'video' } | null;
    /**
     * Avatar DEMANDÉ dont la disponibilité est encore en lecture : l'aperçu
     * attend (état de chargement) au lieu de montrer un plan sans avatar —
     * rempli de stock — qui disparaîtrait une seconde plus tard. Absent : la
     * règle d'avant.
     */
    chargement?: boolean;
    /**
     * Une VRAIE vidéo de cet avatar, déjà produite et payée (aperçu prêt, sinon
     * rendu récent — `GET /api/avatar/apercu`, lecture en base). Jamais
     * générée pour l'aperçu. Absent : la vignette.
     */
    video?: string | null;
  };
  /**
   * Les options EXACTES de « Plan avant génération » (`planCompletAutopilote`) :
   * l'aperçu du montage prévu calcule le MÊME plan. Absent : défauts du moteur.
   */
  plan?: {
    avatarDisponible: boolean;
    cible: number;
    rythme: RythmeBrief | null;
    secondesAvatar?: number | null;
    /** Parole estimée par le budget du script de production (`paroleAvatarDuBudget`). */
    secondesAvatarEstimees?: number | null;
    scriptAvatar?: string | null;
    /** Durées sondées des vidéos (rushes, vidéos suggérées). */
    durees?: Readonly<Record<string, number | null>>;
    /** Durée cible du brief (s) — `null` sans cible : avec avatar, la clôture complète la parole jusqu'à elle. */
    dureeVisee?: number | null;
    /** Ce que la vidéo dit : pertinence des médias et narration calculées comme au rendu. */
    contexte?: ContexteTextesAutopilote | null;
  };
}

export type MediaApercuAutopilote =
  | { type: 'avatar'; sequence: number; etiquette: string; url: string | null; media: 'photo' | 'video'; chargement?: boolean }
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
  const avatar = (): MediaApercuAutopilote | null => {
    if (!r.actives.avatar) return null;
    // En lecture : la place de l'avatar est RÉSERVÉE — jamais un rush ou un stock à sa place.
    if (r.avatar.chargement && !r.avatar.disponible) {
      return { type: 'avatar', sequence: n, etiquette: `Séquence ${n} — Mon avatar (vérification…)`, url: null, media: 'photo', chargement: true };
    }
    if (!r.avatar.disponible) return null;
    if (r.avatar.video) return { type: 'avatar', sequence: n, etiquette: `Séquence ${n} — Mon avatar`, url: r.avatar.video, media: 'video' };
    return { type: 'avatar', sequence: n, etiquette: `Séquence ${n} — Mon avatar`, url: r.avatar.vignette?.url ?? null, media: r.avatar.vignette?.type ?? 'photo' };
  };
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
    r.avatar.chargement ? 1 : 0,
    r.avatar.video ?? '',
    r.plan ?? null,
  ]);
}

/**
 * APERÇU DU MONTAGE PRÉVU — le PLAN COMPLET, celui de « Plan avant génération ».
 *
 * ⚠️ DEUX PLANS À L'ÉCRAN, C'ÉTAIT INACCEPTABLE. La première version listait
 * les seuls créneaux du gabarit (un « Photo suggérée » de 2,5 s) pendant que
 * « Plan avant génération » montrait l'alternance complète avatar ↔ plans de
 * coupe. Les étapes viennent désormais de `planCompletAutopilote` (le même
 * orchestrateur que le moteur, `planMultiSources`), avec les MÊMES options
 * que `PlanAvantGeneration` (`resume.plan`) : chaque segment devient une
 * étape d'`ApercuMontageListe`, puis le CTA.
 *   - avatar → emplacement (`url: null`) tant que sa vidéo n'existe pas :
 *     « Votre avatar parlera ici », jamais un stock à sa place ;
 *   - rush / vidéo suggérée / photo suggérée → le média du plan.
 * Pur, sans réseau.
 */
export type AvatarMontageApercu = 'video-reelle' | 'vignette' | 'emplacement' | 'chargement' | null;

export function etapesMontageApercuAutopilote(
  resume: ResumeMediasApercu | null | undefined,
  opts: { dureeCta?: number | null } = {},
): {
  etapes: EtapeApercu[]; lignes: LigneChronologie[]; duree: number; avatar: AvatarMontageApercu; ctaEnSurimpression: boolean;
  /** Fenêtre du CTA en surimpression (s) — sur la clôture quand elle existe ; `null` sinon. */
  ctaFenetre?: [number, number] | null;
  /** Début de la séquence de clôture (s) ; `null` sans clôture. */
  debutCloture?: number | null;
} {
  const etapes: EtapeApercu[] = [];
  let ctaFenetre: [number, number] | null = null;
  let debutCloture: number | null = null;
  // Avatar demandé, disponibilité en lecture : AUCUN plan (il serait sans
  // avatar, donc rempli de stock) — l'écran montre un état de chargement.
  if (resume && resume.gabarit.length > 0 && resume.actives.avatar && resume.avatar.chargement && !resume.avatar.disponible) {
    return { etapes, lignes: [], duree: 0, avatar: 'chargement', ctaEnSurimpression: false };
  }
  if (resume && resume.gabarit.length > 0) {
    const plan = resume.plan;
    const avatarDisponible = plan?.avatarDisponible ?? (resume.actives.avatar && resume.avatar.disponible);
    // La MÊME entrée que `PlanAvantGeneration` (sources déjà filtrées par l'écran).
    const complet = planCompletAutopilote({
      gabarit: resume.gabarit,
      actives: { rushes: true, stock: true, avatar: avatarDisponible },
      rushesPerso: resume.rushesPerso,
      stock: resume.stock,
      // La vignette RÉELLE de l'avatar (elle était toujours `null` ici).
      avatar: { disponible: avatarDisponible, vignette: resume.avatar.vignette ?? null },
    }, {
      cible: plan?.cible ?? DUREE_ESTIMEE_SANS_CIBLE,
      rythme: plan?.rythme ?? null,
      secondesAvatar: plan?.secondesAvatar ?? null,
      secondesAvatarEstimees: plan?.secondesAvatarEstimees ?? null,
      scriptAvatar: plan?.scriptAvatar ?? null,
      durees: plan?.durees ?? {},
      // Sa vraie vidéo, si elle existe déjà : les segments avatar la portent.
      urlAvatar: avatarDisponible ? resume.avatar.video ?? null : null,
      // La MÊME décision que le rendu : pertinences, narration, clôture.
      dureeVisee: plan?.dureeVisee ?? null,
      contexte: plan?.contexte ?? null,
    });
    const { segments } = complet;
    ctaFenetre = complet.cta;
    debutCloture = complet.debutCloture;
    const perso = resume.rushesPerso;
    let photos = 0;
    segments.forEach((sg, k) => {
      const id = `plan-${k + 1}`;
      const base = { id, debut: sg.debut, fin: sg.fin, horsNarration: false };
      if (sg.genre === 'avatar') {
        etapes.push({
          ...base, source: 'avatar', type: 'video',
          url: sg.url === URL_AVATAR_PREVU ? null : sg.url,
          depuis: sg.debut,
          libelle: sg.role === 'accroche' ? 'Mon avatar — accroche' : sg.role === 'cta' ? 'Mon avatar — CTA' : sg.role === 'conclusion' ? 'Mon avatar — conclusion' : 'Mon avatar',
        });
      } else {
        // Clôture : plans de coupe APRÈS la parole, CTA à l'écran jusqu'à la fin.
        const cl = sg.role === 'cloture' ? 'Clôture + CTA — ' : '';
        if (sg.genre === 'photo') {
          etapes.push({
            ...base, source: 'stock-photo', type: 'image', url: sg.url, depuis: 0, libelle: `${cl}Photo suggérée`,
            mouvement: MOUVEMENTS_PHOTO[photos++ % MOUVEMENTS_PHOTO.length],
          });
        } else if (sg.genre === 'video') {
          etapes.push({ ...base, source: 'stock-video', type: 'video', url: sg.url, depuis: 0, libelle: `${cl}Vidéo suggérée` });
        } else {
          etapes.push({ ...base, source: 'rush', type: 'video', url: sg.url, depuis: 0, libelle: `${cl}Rush : ${nomRush(sg.url, Math.max(0, perso.indexOf(sg.url)))}` });
        }
      }
    });
  }
  const duree = etapes.length ? etapes[etapes.length - 1].fin : 0;
  const avecAvatar = etapes.some((e) => e.source === 'avatar');
  const avatar: AvatarMontageApercu = !avecAvatar ? null
    : etapes.some((e) => e.source === 'avatar' && e.url) ? 'video-reelle'
      : resume?.avatar.vignette ? 'vignette' : 'emplacement';
  const lignes: LigneChronologie[] = etapes.map((e) => ({ id: e.id, libelle: e.libelle, debut: e.debut, fin: e.fin }));
  const cta = typeof opts.dureeCta === 'number' && Number.isFinite(opts.dureeCta) && opts.dureeCta > 0 ? opts.dureeCta : null;
  // ⚠️ AVATAR + AUTRES SOURCES : AUCUNE SÉQUENCE CTA APRÈS LA VIDÉO. Le moteur
  // monte alors les textes EN SURIMPRESSION et retire la séquence CTA plein
  // écran (`produire.ts`, `ctaDuration: 0`) : le CTA s'affiche sur les
  // dernières secondes de la parole. L'aperçu annonçait « CTA 30–34 s », que
  // le MP4 n'a jamais contenu. Avatar seul (pas de plan de coupe) : séquence gardée.
  const ctaEnSurimpression = etapes.some((e) => e.source === 'avatar') && etapes.some((e) => e.source !== 'avatar');
  if (cta !== null && etapes.length && !ctaEnSurimpression) {
    const fondu = Math.round(Math.min(TRANSITION_DURATION_SECONDS, duree) * 1000) / 1000;
    lignes.push({ id: 'cta', libelle: 'CTA', debut: duree, fin: Math.round((duree + cta) * 1000) / 1000, cta: true, ...(fondu > 0 ? { fondu } : {}) });
  }
  return { etapes, lignes, duree, avatar, ctaEnSurimpression, ctaFenetre: ctaEnSurimpression ? ctaFenetre : null, debutCloture };
}
