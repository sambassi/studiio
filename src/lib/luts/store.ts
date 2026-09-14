import { supabaseAdmin } from '@/lib/db/supabase';
import { lutAssetValide, lutAssetsValides, LUTS_MAX } from './bibliotheque';
import type { LutAsset } from './types';

/**
 * Accès à la table `lut_assets` — le SEUL module qui la nomme.
 *
 * Module SERVEUR (rôle de service). Il ne valide rien lui-même : ce qu'il
 * reçoit a été mesuré par `lireLutAsset`, ce qu'il rend est relu par
 * `lutAssetValide` (A1) — la base et le socle disent la même chose, et une
 * ligne qui ne respecterait plus le contrat est écartée à la lecture plutôt
 * que servie.
 *
 * ⚠️ TOUJOURS `.eq('user_id', …)`. Inconnu et « appartenant à autrui » sont la
 * même réponse : `null`. C'est ce qui permet aux routes de rendre 404 sans
 * jamais confirmer l'existence d'une LUT d'un autre compte.
 *
 * ⚠️ L'AJOUT PASSE PAR LA FONCTION SQL `lut_assets_ajouter`. Elle prend un
 * verrou par compte, tranche le doublon, compte, puis insère — dans la même
 * transaction. Un `count → insert` en deux requêtes laisserait passer 41
 * fiches quand deux imports comptent 39 en même temps.
 */

const TABLE = 'lut_assets';
const COLONNES =
  'empreinte, cle, nom, titre, kind, origine, taille, octets, domain_min, domain_max, importee_le';

export type MotifStore = 'socle_absent' | 'ecriture_impossible';

/** 42P01 / PGRST205 / PGRST202 : la migration A2 n'est pas appliquée (ou PostgREST n'a pas relu son schéma). */
export function socleAbsent(erreur: { code?: string; message?: string } | null | undefined): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
    || message.includes('does not exist') || message.includes('schema cache');
}

/** Une ligne de la table, telle que PostgREST la rend. */
interface Ligne {
  empreinte: string;
  cle: string;
  nom: string;
  titre: string | null;
  kind: string;
  origine: string;
  taille: number;
  octets: number;
  domain_min: number[];
  domain_max: number[];
  importee_le: string;
}

/** Mapping colonnes → contrat, en UN seul endroit. La relecture A1 fait le tri. */
function fiche(ligne: Ligne, userId: string): LutAsset | null {
  return lutAssetValide({
    empreinte: ligne.empreinte,
    cle: ligne.cle,
    nom: ligne.nom,
    titre: ligne.titre,
    kind: ligne.kind,
    origine: ligne.origine,
    taille: ligne.taille,
    octets: ligne.octets,
    domainMin: ligne.domain_min,
    domainMax: ligne.domain_max,
    importeeLe: ligne.importee_le,
  }, userId);
}

export type Lecture<T> =
  | { ok: true; valeur: T }
  | { ok: false; motif: MotifStore };

/** La bibliothèque du compte, la plus récente d'abord, plafond tenu. */
export async function listerLuts(userId: string): Promise<Lecture<readonly LutAsset[]>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(COLONNES)
    .eq('user_id', userId)
    .order('importee_le', { ascending: false })
    .limit(LUTS_MAX);
  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    console.error('[luts] Lecture de la bibliothèque :', error.message);
    return { ok: false, motif: 'ecriture_impossible' };
  }
  const lignes = (data ?? []) as unknown as Ligne[];
  return {
    ok: true,
    valeur: lutAssetsValides(lignes.map((l) => fiche(l, userId)).filter(Boolean), userId),
  };
}

/** Une fiche du compte, ou `null` — qu'elle n'existe pas ou qu'elle soit à autrui. */
export async function lutDuCompte(
  userId: string, empreinte: string,
): Promise<Lecture<LutAsset | null>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(COLONNES)
    .eq('user_id', userId)
    .eq('empreinte', empreinte)
    .maybeSingle();
  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    console.error('[luts] Lecture d’une fiche :', error.message);
    return { ok: false, motif: 'ecriture_impossible' };
  }
  return { ok: true, valeur: data ? fiche(data as unknown as Ligne, userId) : null };
}

export type Ajout =
  | { ok: true; issue: 'creee' | 'existante'; lut: LutAsset }
  | { ok: false; motif: MotifStore | 'pleine' };

/**
 * Ajoute une fiche — dédoublonnée et plafonnée PAR LA BASE, atomiquement.
 *
 * L'ordre est celui de la fonction SQL : doublon d'abord (« existante »,
 * même bibliothèque pleine), plafond ensuite (« pleine »), insertion enfin.
 * Le plafond n'est PAS transmis : il est écrit dans la base
 * (`lut_assets_plafond()` = 40) et un déclencheur le fait respecter même à
 * une insertion directe. `LUTS_MAX` ne sert ici qu'aux libellés.
 * La fiche rendue est relue depuis la base : ce que le serveur retourne est
 * ce qui est réellement rangé.
 */
export async function ajouterLut(
  userId: string, asset: Omit<LutAsset, 'importeeLe'>,
): Promise<Ajout> {
  if (!userId) return { ok: false, motif: 'ecriture_impossible' };
  const { data, error } = await supabaseAdmin.rpc('lut_assets_ajouter', {
    p_user_id: userId,
    p_empreinte: asset.empreinte,
    p_cle: asset.cle,
    p_nom: asset.nom,
    p_titre: asset.titre,
    p_kind: asset.kind,
    p_origine: asset.origine,
    p_taille: asset.taille,
    p_octets: asset.octets,
    p_domain_min: asset.domainMin,
    p_domain_max: asset.domainMax,
  });
  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    console.error('[luts] Ajout d’une fiche :', error.message);
    return { ok: false, motif: 'ecriture_impossible' };
  }
  const ligne = (Array.isArray(data) ? data[0] : data) as { issue?: string } | null;
  const issue = ligne?.issue;
  if (issue === 'pleine') return { ok: false, motif: 'pleine' };
  if (issue !== 'creee' && issue !== 'existante') {
    console.error('[luts] Ajout d’une fiche : issue inattendue', issue);
    return { ok: false, motif: 'ecriture_impossible' };
  }
  const relue = await lutDuCompte(userId, asset.empreinte);
  if (!relue.ok) return { ok: false, motif: relue.motif };
  if (!relue.valeur) {
    // La base dit « créée » mais la relecture la rejette : la ligne viole le
    // contrat A1. On ne sert pas ce qu'on ne relirait pas.
    console.error('[luts] Fiche ajoutée mais illisible par le contrat :', asset.empreinte);
    return { ok: false, motif: 'ecriture_impossible' };
  }
  return { ok: true, issue, lut: relue.valeur };
}

/** Renomme une fiche du compte. `null` si elle n'est pas au compte. */
export async function renommerLut(
  userId: string, empreinte: string, nom: string,
): Promise<Lecture<LutAsset | null>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ nom })
    .eq('user_id', userId)
    .eq('empreinte', empreinte)
    .select(COLONNES)
    .maybeSingle();
  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    console.error('[luts] Renommage :', error.message);
    return { ok: false, motif: 'ecriture_impossible' };
  }
  return { ok: true, valeur: data ? fiche(data as unknown as Ligne, userId) : null };
}

/**
 * Supprime une fiche du compte. Rend la fiche supprimée (pour effacer son
 * objet ensuite), ou `null` si elle n'était pas au compte.
 */
export async function supprimerLut(
  userId: string, empreinte: string,
): Promise<Lecture<LutAsset | null>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('empreinte', empreinte)
    .select(COLONNES)
    .maybeSingle();
  if (error) {
    if (socleAbsent(error)) return { ok: false, motif: 'socle_absent' };
    console.error('[luts] Suppression :', error.message);
    return { ok: false, motif: 'ecriture_impossible' };
  }
  return { ok: true, valeur: data ? fiche(data as unknown as Ligne, userId) : null };
}
