/**
 * « Produire un brouillon maintenant » — les états RÉELS, dérivés de ce que
 * le serveur répond, jamais supposés.
 *
 *   repos → confirmation → en-cours | jumeau → fait | erreur | annule
 *
 *  - `annule` : SEUL un refus de l'utilisateur dans la fenêtre de coût
 *    fournisseur y mène (« Opération annulée : aucun appel fournisseur… »).
 *    Un verrou client déjà pris (`deja_en_cours`) n'est PAS une annulation :
 *    une production tourne, on la suit.
 *  - `erreur` : la raison réelle du serveur (ou du réseau), et une relance.
 *  - `en-cours` sans aucune trace côté serveur pendant plusieurs lectures
 *    (serveur redémarré, résultat expiré) : on ne laisse plus l'écran
 *    bloqué sans bouton — l'état redevient explicable et relançable.
 *
 * Aucune relance ne peut débiter deux fois : le serveur garde un verrou par
 * compte (409 `en-cours`), refuse un créneau déjà produit (409
 * `deja-produit`) et débite sous une référence déterministe
 * (`autopilote:<jobId>`, `deductCredits`).
 */
import { MESSAGE_ANNULE, type IssueConfirmee } from '@/lib/fournisseurs/confirmation-client';

export type EtatProduction =
  | { etat: 'repos' }
  | { etat: 'confirmation' }
  | { etat: 'en-cours' }
  /** Avatar en préparation : le montage attend en file — RIEN n'est encore dans le Calendrier. */
  | { etat: 'jumeau' }
  | { etat: 'fait'; postId: string | null; date: string; time: string; timezone: string; calendrierUrl: string; avertissements?: string[] }
  /** L'utilisateur a refusé le coût fournisseur : aucun appel n'est parti. */
  | { etat: 'annule'; message: string }
  | { etat: 'erreur'; message: string; code?: string };

/** Le bouton « Produire un brouillon maintenant » se montre-t-il ? */
export function boutonProduireVisible(e: EtatProduction): boolean {
  return e.etat === 'repos' || e.etat === 'fait' || e.etat === 'erreur' || e.etat === 'annule';
}

/** Codes d'une production PERDUE côté serveur (redémarrage) : on la relance, on ne la « réessaie » pas. */
export const CODES_PRODUCTION_INTERROMPUE: readonly string[] = ['introuvable', 'interrompue'];

/** Libellé du bouton : après un échec technique, c'est une relance. */
export function libelleBoutonProduire(e: EtatProduction): string {
  if (e.etat === 'erreur' && e.code && CODES_PRODUCTION_INTERROMPUE.includes(e.code)) return 'Relancer la production';
  return e.etat === 'erreur' ? 'Réessayer la production' : 'Produire un brouillon maintenant';
}

/** Ce que fait l'écran de la réponse au POST. */
export type SuiteEnvoi =
  | { suite: 'etat'; etat: EtatProduction }
  /** Le rendu tourne (202, 409 `en-cours`, verrou client déjà pris) : on le suit. */
  | { suite: 'suivre' }
  /** Réponse complète : `appliquerResultat`. */
  | { suite: 'resultat'; data: Record<string, unknown> };

export function suiteEnvoi(issue: IssueConfirmee): SuiteEnvoi {
  if (issue.annule) {
    if (issue.choix === 'deja_en_cours') return { suite: 'suivre' };
    return { suite: 'etat', etat: { etat: 'annule', message: MESSAGE_ANNULE } };
  }
  const data = (issue.json && typeof issue.json === 'object' ? issue.json : {}) as Record<string, unknown>;
  if (issue.status === 202 || data.code === 'en-cours') return { suite: 'suivre' };
  if (issue.status < 200 || issue.status >= 300 || !data.success) {
    const message = typeof data.error === 'string' && data.error
      ? data.error
      : issue.status === 401 ? 'Votre session a expiré : reconnectez-vous puis réessayez.'
        : `Le serveur a refusé la production (erreur ${issue.status}).`;
    return { suite: 'etat', etat: { etat: 'erreur', message, ...(typeof data.code === 'string' ? { code: data.code } : {}) } };
  }
  return { suite: 'resultat', data };
}

/** Message d'une exception (réseau coupé, réponse illisible) : la raison réelle. */
export function messageErreurTechnique(err: unknown): string {
  const brut = err instanceof Error ? err.message : '';
  if (/failed to fetch|networkerror|load failed|network/i.test(brut)) {
    return 'La connexion au serveur a été interrompue. Si la production avait démarré, elle continue : rechargez la page pour la retrouver, ou réessayez.';
  }
  return brut || 'Production impossible.';
}

/** Lectures consécutives sans AUCUNE trace serveur avant de cesser d'attendre (~2 s chacune). */
export const LECTURES_VIDES_MAX = 6;

/** Ce que dit une lecture de `/api/autopilot/produire-maintenant/progression`. */
export type LectureProgression =
  | { cas: 'progression' }
  | { cas: 'resultat'; resultat: Record<string, unknown> }
  | { cas: 'jumeau' }
  | { cas: 'jumeau-depose'; resultat: Record<string, unknown> }
  | { cas: 'echec'; message: string }
  /**
   * La production suivie par CET écran (créneau mémorisé) n'est plus nulle
   * part : ni en mémoire du serveur, ni en file, ni dans le Calendrier.
   * Le serveur a redémarré pendant le rendu : elle est INTERROMPUE.
   */
  | { cas: 'perdue' }
  | { cas: 'rien' };

export function lireProgressionServeur(d: unknown): LectureProgression {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  if (o.progression && typeof o.progression === 'object') return { cas: 'progression' };
  if (o.resultat && typeof o.resultat === 'object') return { cas: 'resultat', resultat: o.resultat as Record<string, unknown> };
  const j = (o.jumeau && typeof o.jumeau === 'object' ? o.jumeau : null) as
    | { etat?: string; message?: string; post?: { postId: string; scheduledDate: string; scheduledTime: string }; sansAvatar?: boolean }
    | null;
  if (j?.etat === 'en_preparation') return { cas: 'jumeau' };
  if (j?.etat === 'depose' && j.post) {
    return {
      cas: 'jumeau-depose',
      resultat: {
        success: true, postId: j.post.postId, scheduledDate: j.post.scheduledDate, scheduledTime: j.post.scheduledTime,
        avertissements: j.sansAvatar ? ['La vidéo de votre avatar n’a pas pu être préparée : le brouillon a été monté sans elle.'] : [],
      },
    };
  }
  if (j?.etat === 'echec') return { cas: 'echec', message: String(j.message ?? 'La production n’a pas abouti.') };
  // Production SANS avatar suivie par son créneau (`?date=&time=`) : le serveur
  // a relu le Calendrier. Déposée = un résultat PROUVÉ (post relu) ; sinon perdue.
  const m = (o.manuel && typeof o.manuel === 'object' ? o.manuel : null) as
    | { etat?: string; post?: { postId?: unknown; scheduledDate?: unknown; scheduledTime?: unknown } }
    | null;
  if (m?.etat === 'depose' && m.post && typeof m.post.postId === 'string' && m.post.postId) {
    return {
      cas: 'resultat',
      resultat: {
        success: true, postId: m.post.postId,
        scheduledDate: String(m.post.scheduledDate ?? ''), scheduledTime: String(m.post.scheduledTime ?? ''),
        calendrierUrl: '/dashboard/calendar',
      },
    };
  }
  if (m?.etat === 'perdue') return { cas: 'perdue' };
  return { cas: 'rien' };
}

/**
 * Production suivie mais introuvable côté serveur : l'écran le dit et rend la
 * main. ⚠️ HONNÊTE SUR L'ARGENT : sans avatar, le débit n'a lieu qu'APRÈS le
 * dépôt du brouillon (`produireUnMontage`) — une production interrompue avant
 * dépôt n'a rien coûté.
 */
export const MESSAGE_PRODUCTION_PERDUE =
  'Production interrompue : le serveur ne la retrouve plus (il a probablement redémarré pendant le rendu). Aucun crédit n’est débité tant qu’aucun brouillon n’est déposé dans le Calendrier. Relancez la production.';

/** Même situation, constatée au RETOUR sur la page (créneau mémorisé, rien côté serveur). */
export const MESSAGE_PRODUCTION_INTERROMPUE = MESSAGE_PRODUCTION_PERDUE;

// ── La production SUIVIE par ce navigateur ───────────────────────────────
// Sans avatar, l'état serveur vit en MÉMOIRE : un redémarrage l'efface, et
// l'écran rechargé ne pouvait plus distinguer « rien lancé » de « lancé puis
// perdu ». Le navigateur garde donc le créneau lancé (date + heure, rien
// d'autre) ; au retour, le serveur relit le Calendrier pour CE créneau.

/** Clé du stockage local (créneau de la production suivie). */
export const CLE_PRODUCTION_SUIVIE = 'studiio:autopilote:production-suivie';
/** Au-delà, une production suivie n'est plus « en cours » (même fenêtre que le suivi jumeau). */
export const FENETRE_PRODUCTION_SUIVIE_MS = 6 * 60 * 60 * 1000;

export interface ProductionSuivie { date: string; time: string; depuis: number }

/** Lit une production suivie (format validé, fenêtre de 6 h). Pure. */
export function productionSuivieDepuis(brut: unknown, now = Date.now()): ProductionSuivie | null {
  let o: unknown = brut;
  if (typeof brut === 'string') { try { o = JSON.parse(brut); } catch { return null; } }
  if (!o || typeof o !== 'object') return null;
  const { date, time, depuis } = o as Record<string, unknown>;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
  if (typeof depuis !== 'number' || !Number.isFinite(depuis) || now - depuis > FENETRE_PRODUCTION_SUIVIE_MS) return null;
  return { date, time, depuis };
}

export function lireProductionSuivie(now = Date.now()): ProductionSuivie | null {
  try { return productionSuivieDepuis(window.localStorage.getItem(CLE_PRODUCTION_SUIVIE), now); } catch { return null; }
}

export function noterProductionSuivie(p: { date: unknown; time: unknown }, now = Date.now()): void {
  const v = productionSuivieDepuis({ date: p.date, time: p.time, depuis: now }, now);
  if (!v) return;
  try { window.localStorage.setItem(CLE_PRODUCTION_SUIVIE, JSON.stringify(v)); } catch { /* stockage indisponible */ }
}

export function oublierProductionSuivie(): void {
  try { window.localStorage.removeItem(CLE_PRODUCTION_SUIVIE); } catch { /* stockage indisponible */ }
}

/**
 * Une production sans avatar EN COURS côté serveur (relue de la base,
 * champ `production` de `/progression`) que ce navigateur ne suivait pas
 * (lancée d'un autre onglet, ou suivi perdu) : on note son créneau, pour
 * retrouver SON issue à la fin. Ne remplace jamais un suivi existant.
 */
export function suivreProductionDuServeur(d: unknown, now = Date.now()): void {
  const prod = d && typeof d === 'object' ? (d as { production?: { date?: unknown; time?: unknown } | null }).production : null;
  if (prod && typeof prod === 'object' && !lireProductionSuivie(now)) noterProductionSuivie({ date: prod.date, time: prod.time }, now);
}

/** Paramètres de `/progression` pour la production suivie (`''` sans suivi). */
export function parametresSuivi(p: ProductionSuivie | null): string {
  return p ? `?date=${encodeURIComponent(p.date)}&time=${encodeURIComponent(p.time)}` : '';
}

// ── Signal « une production Autopilote est en cours » (même page) ────────
// La colonne d'aperçu (`VideosPretes`) ne doit pas présenter une ANCIENNE
// vidéo à côté du montage en cours de production. Le panneau l'annonce ici ;
// l'état courant est gardé pour un composant monté après l'annonce.
export const EVENEMENT_PRODUCTION_AUTOPILOTE = 'studiio:autopilote-production';
let productionEnCoursCourante = false;

export function productionAutopiloteEnCours(): boolean {
  return productionEnCoursCourante;
}

export function annoncerProductionAutopilote(enCours: boolean): void {
  if (productionEnCoursCourante === enCours) return;
  productionEnCoursCourante = enCours;
  try { window.dispatchEvent(new CustomEvent(EVENEMENT_PRODUCTION_AUTOPILOTE, { detail: { enCours } })); } catch { /* hors navigateur */ }
}

export function ecouterProductionAutopilote(cb: (enCours: boolean) => void): () => void {
  const h = (e: Event) => cb(!!(e as CustomEvent<{ enCours?: boolean }>).detail?.enCours);
  try { window.addEventListener(EVENEMENT_PRODUCTION_AUTOPILOTE, h); } catch { return () => {}; }
  return () => { try { window.removeEventListener(EVENEMENT_PRODUCTION_AUTOPILOTE, h); } catch { /* rien */ } };
}

/** L'état de l'écran est-il une production en cours (rendu ou avatar en file) ? */
export function estEnProduction(e: EtatProduction): boolean {
  return e.etat === 'en-cours' || e.etat === 'jumeau';
}

/**
 * Au RETOUR sur la page : reprendre ce que le serveur a en cours, ou montrer
 * le résultat d'une production terminée pendant l'absence (sans nouveau POST,
 * donc sans nouveau débit). `null` : rien à
 * reprendre, l'écran reste au repos.
 */
export function repriseAuRetour(l: LectureProgression): 'en-cours' | 'jumeau' | 'resultat' | 'interrompue' | null {
  if (l.cas === 'progression') return 'en-cours';
  if (l.cas === 'jumeau') return 'jumeau';
  // Le résultat en mémoire du serveur (30 min) : une production finie
  // pendant l'absence. Un dépôt jumeau ancien n'est pas « repris » : il
  // s'afficherait à chaque visite, des jours après.
  if (l.cas === 'resultat') return 'resultat';
  // Le créneau suivi n'existe plus nulle part : interrompue, on le DIT.
  if (l.cas === 'perdue') return 'interrompue';
  return null;
}
