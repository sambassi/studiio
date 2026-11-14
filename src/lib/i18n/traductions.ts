// Corrections de traductions par l'administration — cœur PUR (sans base ni React), testable seul.
//
// Principe : les catalogues `messages/<langue>.json` sont la base livrée avec le code ; l'équipe
// les CORRIGE ensuite depuis l'administration, sans toucher au code. Les corrections vivent dans
// `app_settings` (clé `i18n_overrides_<langue>`) et PRIMENT sur le catalogue. Le français reste
// le repli de tout texte manquant.
import type { Messages } from '@/i18n/messages';

export const LIMITE_TEXTE = 2000;
export const PREFIXE_CLE_STOCKAGE = 'i18n_overrides_';
export const cleStockage = (locale: string): string => `${PREFIXE_CLE_STOCKAGE}${locale}`;

/** Une correction. `t` vide = « retirer la traduction » (retour au français). `v` = validée par un humain. */
export interface EntreeCorrection {
  t: string;
  v?: boolean;
  par?: string;
  le?: string;
}
export type Corrections = Record<string, EntreeCorrection>;

export type Statut = 'validee' | 'non_validee_attestee' | 'non_validee_a_verifier' | 'non_validee' | 'manquante';

export const LIBELLES_STATUT: Record<Statut, string> = {
  validee: 'Validée',
  non_validee_attestee: 'Non validée · attestée',
  non_validee_a_verifier: 'Non validée · à vérifier en priorité',
  non_validee: 'Non validée',
  manquante: 'Manquante (français affiché)',
};

export interface MetaEntree { c: 'h' | 'm'; s: string }
export type Meta = Record<string, MetaEntree>;

export interface Ligne {
  cle: string;
  ns: string;
  fr: string;
  texte: string;
  statut: Statut;
  confiance: 'h' | 'm' | 'admin' | '';
  source: string;
  par?: string;
  le?: string;
}

export interface Compteurs {
  total: number;
  traduites: number;
  validees: number;
  attestees: number;
  aVerifier: number;
  nonValidees: number;
  manquantes: number;
  pourcentTraduit: number;
}

const VAR = /\{[A-Za-z_]\w*\}/g;
/** Variables `{x}` d'un texte, triées et jointes : deux textes doivent avoir les MÊMES. */
export const variables = (t: string): string => (t.match(VAR) || []).sort().join(',');

/**
 * Texte de correction acceptable ? `null` = oui, sinon le motif du refus.
 * (Un texte vide n'est pas jugé ici : c'est un retrait, décidé par l'appelant.)
 */
export function validerTexte(fr: string, texte: string): string | null {
  const t = texte.trim();
  if (!t) return null;
  if (t.length > LIMITE_TEXTE) return `Texte trop long (${LIMITE_TEXTE} caractères maximum)`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(t)) return 'Caractères de contrôle interdits';
  if (/[<>]/.test(t) && !/[<>]/.test(fr)) return 'Balises HTML interdites';
  const attendu = variables(fr);
  if (variables(t) !== attendu) return attendu ? `Variables à conserver exactement : ${attendu.replace(/,/g, ' ')}` : 'Ce texte ne contient aucune variable {…}';
  return null;
}

/** Namespace d'affichage : `ui.<fichier>` pour la conversion du texte en dur, sinon le premier segment. */
export function namespaceDe(cle: string): string {
  const p = cle.split('.');
  return p[0] === 'ui' && p.length > 2 ? `ui.${p[1]}` : p[0];
}

function poser(o: Messages, cle: string, valeur: string | null) {
  const p = cle.split('.');
  let n: Messages = o;
  for (let i = 0; i < p.length - 1; i += 1) {
    const s = n[p[i]];
    if (valeur === null && (typeof s !== 'object' || s === null)) return;
    if (typeof s !== 'object' || s === null) n[p[i]] = {};
    n = n[p[i]] as Messages;
  }
  if (valeur === null) delete n[p[p.length - 1]]; else n[p[p.length - 1]] = valeur;
}

/**
 * Applique les corrections à la SURCOUCHE d'une langue (avant la fusion avec le français) :
 * texte non vide → remplace ; texte vide → retire (le français s'affichera). Ne mute pas l'entrée.
 */
export function appliquerCorrections(surcouche: Messages, corrections: Record<string, string>): Messages {
  const copie = JSON.parse(JSON.stringify(surcouche || {})) as Messages;
  for (const [cle, t] of Object.entries(corrections)) poser(copie, cle, typeof t === 'string' && t.trim() ? t : null);
  return copie;
}

/** Extrait `{ clé: texte }` des corrections (ce que le visiteur reçoit : ni auteur, ni statut). */
export function textesDesCorrections(c: Corrections): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, e] of Object.entries(c)) if (e && typeof e.t === 'string') out[k] = e.t;
  return out;
}

export function statutDe(
  texte: string,
  correction: EntreeCorrection | undefined,
  meta: MetaEntree | undefined,
): { statut: Statut; confiance: Ligne['confiance']; source: string } {
  if (!texte.trim()) return { statut: 'manquante', confiance: '', source: '' };
  if (correction) {
    if (correction.v) return { statut: 'validee', confiance: 'admin', source: 'validée par l’administration' };
    return { statut: 'non_validee', confiance: 'admin', source: 'corrigée par l’administration' };
  }
  if (meta?.c === 'h') return { statut: 'non_validee_attestee', confiance: 'h', source: meta.s || '' };
  if (meta?.c === 'm') return { statut: 'non_validee_a_verifier', confiance: 'm', source: meta.s || '' };
  return { statut: 'non_validee', confiance: '', source: '' };
}

export function construireLignes(p: {
  fr: Record<string, string>;
  statique: Record<string, string>;
  meta?: Meta;
  corrections: Corrections;
}): Ligne[] {
  const lignes: Ligne[] = [];
  for (const cle of Object.keys(p.fr)) {
    const c = p.corrections[cle];
    const texte = c ? c.t : (p.statique[cle] || '');
    const s = statutDe(texte, c, p.meta?.[cle]);
    lignes.push({ cle, ns: namespaceDe(cle), fr: p.fr[cle], texte, statut: s.statut, confiance: s.confiance, source: s.source, par: c?.par, le: c?.le });
  }
  return lignes;
}

export function compter(lignes: Ligne[]): Compteurs {
  const c: Compteurs = { total: lignes.length, traduites: 0, validees: 0, attestees: 0, aVerifier: 0, nonValidees: 0, manquantes: 0, pourcentTraduit: 0 };
  for (const l of lignes) {
    if (l.statut === 'manquante') { c.manquantes += 1; continue; }
    c.traduites += 1;
    if (l.statut === 'validee') c.validees += 1;
    else { c.nonValidees += 1; if (l.statut === 'non_validee_attestee') c.attestees += 1; if (l.statut === 'non_validee_a_verifier') c.aVerifier += 1; }
  }
  c.pourcentTraduit = c.total ? Math.round((100 * c.traduites) / c.total) : 0;
  return c;
}
