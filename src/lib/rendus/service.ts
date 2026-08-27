/**
 * Tentatives de rendu — la logique serveur, hors des fichiers de route.
 *
 * Un fichier de route Next ne peut exporter que ses gestionnaires : tout ce
 * qui doit etre teste ou partage vit ici.
 */
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/db/supabase';

/** Les quatre parcours factures, plus le calendrier deja migre. */
export const OPERATIONS = [
  'apercu', 'bureau', 'calendrier', 'avance-brouillon', 'avance-bureau',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export const FORMATS = ['reel', 'tv'] as const;
export type Format = (typeof FORMATS)[number];

/** Le bucket des montages. Jamais choisi par le client. */
export const BUCKET_RENDUS = 'media';

/**
 * Champs qu'un client n'a jamais le droit de proposer a la creation d'une
 * tentative. Enumeres pour que les tests les PARCOURENT : une reouverture
 * accidentelle fait alors tomber un test.
 */
export const CHAMPS_INTERDITS_RENDU = [
  'cost', 'cout', 'amount', 'credits', 'user_id', 'userId',
  'cle_objet', 'cleObjet', 'bucket', 'etat', 'transaction_id', 'id',
] as const;

export interface RenduReserve {
  id: string;
  bucket: string;
  cle: string;
  cout: number;
  format: Format;
  operation: Operation;
}

/** Le socle SQL est-il absent de ce serveur ? */
export function socleAbsent(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  const code = erreur.code ?? '';
  const message = (erreur.message ?? '').toLowerCase();
  return code === '42883' || code === 'PGRST202' || code === '42P01'
    || message.includes('does not exist') || message.includes('schema cache');
}

/**
 * Ouvre une tentative.
 *
 * L'identifiant ET la cle d'objet sont fabriques ICI. Le client n'en propose
 * aucun : c'est ce qui garantit qu'il ne peut pas confirmer une tentative
 * avec un fichier qu'il aurait depose ailleurs.
 *
 * Le cout est lu dans `public.tarifs_rendu` — la source de verite du prix,
 * cote serveur — et fige sur la ligne. Aucun montant ne traverse.
 */
export async function reserverRendu(
  userId: string, operation: Operation, format: Format,
): Promise<{ rendu: RenduReserve | null; motif?: string }> {
  const { data: tarif, error: eTarif } = await supabaseAdmin
    .from('tarifs_rendu').select('credits').eq('format', format).maybeSingle();

  if (eTarif && socleAbsent(eTarif)) return { rendu: null, motif: 'socle_absent' };
  if (!tarif) return { rendu: null, motif: 'format_inconnu' };

  const id = randomUUID();
  const cle = `${userId}/rendus/${id}.webm`;

  const { data, error } = await supabaseAdmin
    .from('rendus')
    .insert({
      id,
      user_id: userId,
      operation,
      format,
      cout: tarif.credits,
      bucket: BUCKET_RENDUS,
      cle_objet: cle,
    })
    .select('id, bucket, cle_objet, cout, format, operation')
    .single();

  if (error) {
    if (socleAbsent(error)) return { rendu: null, motif: 'socle_absent' };
    return { rendu: null, motif: error.message };
  }

  return {
    rendu: {
      id: data.id, bucket: data.bucket, cle: data.cle_objet,
      cout: data.cout, format: data.format, operation: data.operation,
    },
  };
}

/** Relit une tentative, en verifiant la propriete. */
export async function lireRendu(userId: string, renduId: string) {
  const { data, error } = await supabaseAdmin
    .from('rendus')
    .select('id, user_id, operation, format, cout, bucket, cle_objet, etat')
    .eq('id', renduId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error && socleAbsent(error)) return { rendu: null, socleAbsent: true };
  return { rendu: data ?? null, socleAbsent: false };
}

export interface Confirmation {
  ok: boolean;
  etat: string | null;
  solde: number;
  dejaConfirme: boolean;
  motif: string | null;
}

/** Confirme et debite, atomiquement. Toute la decision est dans le SQL. */
export async function confirmerRendu(
  userId: string, renduId: string, taille: number, contentType: string,
): Promise<Confirmation & { socleAbsent?: boolean }> {
  const { data, error } = await supabaseAdmin.rpc('confirmer_rendu', {
    p_user_id: userId,
    p_rendu_id: renduId,
    p_taille: taille,
    p_content_type: contentType,
  });

  if (error) {
    if (socleAbsent(error)) {
      return { ok: false, etat: null, solde: 0, dejaConfirme: false, motif: 'socle_absent', socleAbsent: true };
    }
    throw new Error(error.message || 'confirmation impossible');
  }

  const ligne = (Array.isArray(data) ? data[0] : data) as {
    ok: boolean; etat: string | null; solde: number; deja_confirme: boolean; motif: string | null;
  } | undefined;
  if (!ligne) throw new Error('confirmation sans reponse');

  return {
    ok: !!ligne.ok,
    etat: ligne.etat ?? null,
    solde: Number(ligne.solde ?? 0),
    dejaConfirme: !!ligne.deja_confirme,
    motif: ligne.motif ?? null,
  };
}

/** Ferme une tentative sans jamais debiter. */
export async function cloreRendu(
  userId: string, renduId: string, etat: 'cancelled' | 'failed', motif: string,
): Promise<{ ok: boolean; etat: string | null }> {
  const { data, error } = await supabaseAdmin.rpc('clore_rendu', {
    p_user_id: userId, p_rendu_id: renduId, p_etat: etat, p_motif: motif,
  });
  if (error) {
    if (socleAbsent(error)) return { ok: false, etat: null };
    throw new Error(error.message || 'cloture impossible');
  }
  const ligne = (Array.isArray(data) ? data[0] : data) as { ok: boolean; etat: string | null } | undefined;
  return { ok: !!ligne?.ok, etat: ligne?.etat ?? null };
}
