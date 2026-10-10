/**
 * Tarifs Studiio — lecture et écriture SERVEUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OÙ VIVENT LES PRIX (sans migration)
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   - `public.tarifs_rendu` (reel, tv) : DÉJÀ la vérité des rendus — la
 *     fonction SQL atomique `debiter_credits` y lit le prix. L'admin y écrit
 *     directement : écran, route et débit SQL ne peuvent pas diverger.
 *   - `app_settings['tarifs_credits']` (table admin existante) : tout le
 *     reste — audio, avatar, IA, Autopilote — plus la valeur indicative du
 *     crédit et les coûts fournisseurs estimés.
 *   - `audit_log` (existant) : l'historique « qui a changé quoi ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CACHE, ET FERMÉ PAR DÉFAUT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Lecture mise en cache `TTL_TARIFS_MS` (5 s) ; une écriture admin vide le
 * cache du processus — le nouveau prix s'applique à la requête suivante,
 * sans redéploiement. Base illisible : dernière grille connue, sinon les
 * prix codés (`TARIFS_DEFAUT`). JAMAIS 0 par erreur.
 *
 * Une opération lit son prix UNE fois, au moment où elle débite : un
 * changement de tarif ne touche jamais un débit déjà engagé.
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  CATALOGUE_TARIFS,
  TARIFS_DEFAUT,
  estCleTarif,
  normaliserGrille,
  tarifValide,
  type CleTarif,
  type CoutFournisseur,
  type GrilleTarifs,
} from './catalogue';

export const CLE_REGLAGE_TARIFS = 'tarifs_credits';
export const ACTION_AUDIT_TARIFS = 'update_pricing';
export const TTL_TARIFS_MS = 5_000;
export const VALEUR_CREDIT_MAX_CHF = 100;

export interface ConfigurationTarifs {
  prix: GrilleTarifs;
  /** Valeur commerciale INDICATIVE d'un crédit (CHF) — ne touche pas Stripe. */
  valeurCreditChf: number | null;
  coutsFournisseur: Partial<Record<CleTarif, CoutFournisseur>>;
  /** `defaut` : rien n'a pu être lu, prix codés. */
  source: 'configuration' | 'defaut';
}

interface Etat { valeur: ConfigurationTarifs | null; luA: number; enVol: Promise<ConfigurationTarifs> | null }
const etat: Etat = { valeur: null, luA: 0, enVol: null };
let horloge: () => number = () => Date.now();

/** Tests uniquement. */
export function reinitialiserTarifs(maintenant?: () => number): void {
  etat.valeur = null; etat.luA = 0; etat.enVol = null;
  horloge = maintenant ?? (() => Date.now());
}

export function invaliderTarifs(): void {
  etat.luA = 0;
  etat.enVol = null;
}

function lireJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function normaliserCouts(brut: unknown): Partial<Record<CleTarif, CoutFournisseur>> {
  const out: Partial<Record<CleTarif, CoutFournisseur>> = {};
  if (!brut || typeof brut !== 'object') return out;
  for (const [k, v] of Object.entries(brut as Record<string, unknown>)) {
    const c = v as { chf?: unknown; unite?: unknown } | null;
    if (estCleTarif(k) && c && typeof c.chf === 'number' && Number.isFinite(c.chf) && c.chf >= 0) {
      out[k] = { chf: c.chf, unite: typeof c.unite === 'string' ? c.unite.slice(0, 40) : '' };
    }
  }
  return out;
}

function valeurCreditValide(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= VALEUR_CREDIT_MAX_CHF;
}

async function charger(): Promise<ConfigurationTarifs> {
  const [reglage, rendus] = await Promise.all([
    supabaseAdmin.from('app_settings').select('value').eq('key', CLE_REGLAGE_TARIFS).maybeSingle(),
    supabaseAdmin.from('tarifs_rendu').select('format, credits'),
  ]);
  // Le réglage porte TOUS les prix hors rendus : illisible, il ne doit jamais
  // être pris pour « vide ». Sinon la lecture servirait les replis comme une
  // configuration valide (5 s de cache), et `ecrireTarifs` réécrirait ces
  // replis par-dessus la configuration de l'admin.
  if (reglage.error) throw new Error('tarifs illisibles');
  const brut = (lireJson(reglage.data?.value) ?? {}) as { prix?: unknown; valeurCreditChf?: unknown; coutsFournisseur?: unknown };
  const prix = normaliserGrille(brut.prix);
  // Les rendus : la table que lit le débit SQL fait foi.
  for (const ligne of (Array.isArray(rendus.data) ? rendus.data : []) as Array<{ format?: unknown; credits?: unknown }>) {
    if ((ligne.format === 'reel' || ligne.format === 'tv') && tarifValide(ligne.credits)) prix[`render.${ligne.format}`] = ligne.credits;
  }
  return {
    prix,
    valeurCreditChf: valeurCreditValide(brut.valeurCreditChf) ? brut.valeurCreditChf : null,
    coutsFournisseur: normaliserCouts(brut.coutsFournisseur),
    source: 'configuration',
  };
}

/** La configuration en vigueur — jamais d'exception, jamais de prix 0 inventé. */
export async function lireTarifs(): Promise<ConfigurationTarifs> {
  if (etat.valeur && horloge() - etat.luA < TTL_TARIFS_MS) return etat.valeur;
  if (etat.enVol) return etat.enVol;
  const promesse = charger()
    .then((v) => { etat.valeur = v; etat.luA = horloge(); return v; })
    .catch((e) => {
      console.error('[tarifs] lecture impossible — repli :', e instanceof Error ? e.message : e);
      return etat.valeur ?? { prix: { ...TARIFS_DEFAUT }, valeurCreditChf: null, coutsFournisseur: {}, source: 'defaut' as const };
    })
    .finally(() => { if (etat.enVol === promesse) etat.enVol = null; });
  etat.enVol = promesse;
  return promesse;
}

export async function prixDe(cle: CleTarif): Promise<number> {
  const v = (await lireTarifs()).prix[cle];
  return tarifValide(v) ? v : TARIFS_DEFAUT[cle];
}

// ─────────────────────────────────────────────────────────────────────────
// Écriture (admin)
// ─────────────────────────────────────────────────────────────────────────

export interface ModificationTarifs {
  prix?: Record<string, unknown>;
  valeurCreditChf?: unknown;
  coutsFournisseur?: Record<string, unknown>;
}

export type ErreurValidation = { champ: string; message: string };

export function validerModification(m: ModificationTarifs): ErreurValidation[] {
  const erreurs: ErreurValidation[] = [];
  for (const [k, v] of Object.entries(m.prix ?? {})) {
    if (!estCleTarif(k)) erreurs.push({ champ: k, message: 'Tarif inconnu.' });
    else if (!tarifValide(v)) erreurs.push({ champ: k, message: 'Entier entre 0 et 10 000 attendu.' });
  }
  if (m.valeurCreditChf !== undefined && m.valeurCreditChf !== null && !valeurCreditValide(m.valeurCreditChf)) {
    erreurs.push({ champ: 'valeurCreditChf', message: `Montant entre 0 et ${VALEUR_CREDIT_MAX_CHF} CHF attendu.` });
  }
  for (const [k, v] of Object.entries(m.coutsFournisseur ?? {})) {
    const c = v as { chf?: unknown } | null;
    if (!estCleTarif(k)) erreurs.push({ champ: `cout:${k}`, message: 'Tarif inconnu.' });
    else if (c !== null && (typeof c?.chf !== 'number' || !Number.isFinite(c.chf) || c.chf < 0 || c.chf > 10_000)) {
      erreurs.push({ champ: `cout:${k}`, message: 'Coût fournisseur invalide.' });
    }
  }
  return erreurs;
}

export interface ChangementTarif { cle: string; ancien: unknown; nouveau: unknown }

/**
 * Applique une modification validée. Rend la liste des changements réels
 * (une valeur identique n'est ni écrite ni journalisée).
 */
export async function ecrireTarifs(m: ModificationTarifs, adminEmail: string): Promise<ChangementTarif[]> {
  const erreurs = validerModification(m);
  if (erreurs.length) throw Object.assign(new Error('validation'), { erreurs });

  invaliderTarifs();
  const actuelle = await charger(); // lecture fraîche : jamais un cache pour écrire
  const changements: ChangementTarif[] = [];

  const prix = { ...actuelle.prix };
  for (const [k, v] of Object.entries(m.prix ?? {})) {
    const cle = k as CleTarif;
    if (prix[cle] !== v) { changements.push({ cle, ancien: prix[cle], nouveau: v }); prix[cle] = v as number; }
  }
  let valeurCreditChf = actuelle.valeurCreditChf;
  if (m.valeurCreditChf !== undefined && m.valeurCreditChf !== valeurCreditChf) {
    changements.push({ cle: 'credit.value_chf', ancien: valeurCreditChf, nouveau: m.valeurCreditChf });
    valeurCreditChf = (m.valeurCreditChf as number | null) ?? null;
  }
  const coutsFournisseur = { ...actuelle.coutsFournisseur };
  for (const [k, v] of Object.entries(m.coutsFournisseur ?? {})) {
    const cle = k as CleTarif;
    const avant = coutsFournisseur[cle] ?? null;
    const apres = v === null ? null : { chf: (v as CoutFournisseur).chf, unite: String((v as CoutFournisseur).unite ?? '').slice(0, 40) };
    if (JSON.stringify(avant) !== JSON.stringify(apres)) {
      changements.push({ cle: `cost.${cle}`, ancien: avant, nouveau: apres });
      if (apres) coutsFournisseur[cle] = apres; else delete coutsFournisseur[cle];
    }
  }
  if (changements.length === 0) return [];

  // 1. Rendus : la table du débit SQL.
  for (const f of ['reel', 'tv'] as const) {
    const cle = `render.${f}` as const;
    if (changements.some((c) => c.cle === cle)) {
      const { error } = await supabaseAdmin.from('tarifs_rendu').update({ credits: prix[cle], updated_at: new Date().toISOString() }).eq('format', f);
      if (error) throw new Error(`tarifs_rendu : ${error.message}`);
    }
  }
  // 2. Le reste : le réglage admin (les rendus y sont recopiés, pour l'historique seulement).
  const { error } = await supabaseAdmin.from('app_settings').upsert({
    key: CLE_REGLAGE_TARIFS,
    value: { prix, valeurCreditChf, coutsFournisseur },
    updated_at: new Date().toISOString(),
    updated_by: adminEmail,
  });
  if (error) throw new Error(`app_settings : ${error.message}`);

  invaliderTarifs();

  // 3. Historique : une ligne par changement, best-effort (le prix est déjà en vigueur).
  try {
    await supabaseAdmin.from('audit_log').insert(changements.map((c) => ({
      admin_email: adminEmail,
      action: ACTION_AUDIT_TARIFS,
      target_type: 'pricing',
      target_id: c.cle,
      details: { cle: c.cle, ancien: c.ancien, nouveau: c.nouveau },
    })));
  } catch (e) {
    console.error('[tarifs] historique non écrit :', e instanceof Error ? e.message : e);
  }
  return changements;
}

export interface LigneHistorique { cle: string; ancien: unknown; nouveau: unknown; admin: string; le: string }

export async function lireHistoriqueTarifs(limite = 50): Promise<LigneHistorique[]> {
  try {
    const { data } = await supabaseAdmin
      .from('audit_log')
      .select('admin_email, target_id, details, created_at')
      .eq('action', ACTION_AUDIT_TARIFS)
      .order('created_at', { ascending: false })
      .limit(limite);
    return ((data ?? []) as Array<{ admin_email: string; target_id: string; details: { ancien?: unknown; nouveau?: unknown } | null; created_at: string }>)
      .map((l) => ({ cle: l.target_id, ancien: l.details?.ancien ?? null, nouveau: l.details?.nouveau ?? null, admin: l.admin_email, le: l.created_at }));
  } catch {
    return [];
  }
}

/** Libellé du catalogue d'une clé (historique). */
export function libelleTarif(cle: string): string {
  return CATALOGUE_TARIFS.find((e) => e.cle === cle)?.libelle ?? cle;
}
