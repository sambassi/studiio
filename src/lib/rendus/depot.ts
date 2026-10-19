/**
 * Le DEPOT d'un rendu, et sa promotion a la confirmation (PR-C).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UN DEPOT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Une URL presignee MinIO ne se revoque pas : elle ecrit tant qu'elle n'a pas
 * expire, que la tentative soit confirmee ou non. Quand elle visait la cle du
 * rendu, un envoi lance APRES la confirmation remplacait le montage paye.
 *
 * Elle vise desormais le depot (`cleDepot`). `/confirm`, tant que la tentative
 * est `reserved`, recopie le depot sur la cle du rendu (copie interne MinIO)
 * PUIS fait verifier cette cle par `confirmerAvecPreuve`, inchange. Une fois
 * la tentative confirmee, plus rien ne recopie le depot : ce qu'on y ecrit
 * ensuite n'atteint jamais le rendu.
 *
 * Le relais same-origin (`/api/render/jobs/<id>/upload`) ecrit, lui,
 * directement la cle du rendu : il relit l'etat en base et refuse hors
 * `reserved`. Sans depot, la promotion ne fait rien et la confirmation se
 * deroule exactement comme avant.
 */
import { cleDepot } from '@/lib/rendus/cible-upload';
import { clientMinio } from '@/lib/storage/minio-client';

export type IssuePromotion = 'promu' | 'absent' | 'injoignable';

/** Ce dont la promotion a besoin du stockage — injectable pour les tests. */
export interface CopieurDepot {
  statObject(bucket: string, cle: string): Promise<unknown>;
  copyObject(bucket: string, cle: string, source: string): Promise<unknown>;
  removeObject(bucket: string, cle: string): Promise<unknown>;
}

const ABSENT = /not found|does not exist|NoSuchKey|NotFound/i;

function messageDe(e: unknown): string {
  if (e instanceof Error) return `${(e as { code?: string }).code ?? ''} ${e.message}`;
  return String(e);
}

/** Le client MinIO interne, ou `null` s'il ne sait pas copier. */
function copieurParDefaut(): CopieurDepot | null {
  try {
    const c = clientMinio() as unknown as Partial<CopieurDepot>;
    if (typeof c?.statObject !== 'function' || typeof c?.copyObject !== 'function'
      || typeof c?.removeObject !== 'function') {
      return null;
    }
    return c as CopieurDepot;
  } catch {
    // Configuration absente : la verification de l'objet echouera de toute
    // facon, et dira « stockage injoignable » -- c'est elle qui tranche.
    return null;
  }
}

/**
 * Recopie le depot sur la cle du rendu, s'il existe.
 *
 *   - `absent`      : aucun depot (envoi par le relais) -> rien a faire.
 *   - `promu`       : le depot est desormais a la cle du rendu.
 *   - `injoignable` : panne de NOTRE cote -> l'appelant laisse la tentative
 *                     ouverte (503), comme pour la verification.
 *
 * Ne DOIT etre appelee que sur une tentative `reserved` : c'est ce qui rend
 * tout envoi posterieur a la confirmation sans effet.
 */
export async function promouvoirDepot(
  bucket: string, cle: string, copieur: CopieurDepot | null = copieurParDefaut(),
): Promise<IssuePromotion> {
  if (!copieur) return 'absent';
  const depot = cleDepot(cle);
  try {
    await copieur.statObject(bucket, depot);
  } catch (e) {
    return ABSENT.test(messageDe(e)) ? 'absent' : 'injoignable';
  }
  try {
    await copieur.copyObject(bucket, cle, `/${bucket}/${depot}`);
  } catch {
    return 'injoignable';
  }
  // Best-effort : un depot qui reste n'est lisible que par son proprietaire,
  // et plus rien ne le recopiera.
  try { await copieur.removeObject(bucket, depot); } catch { /* sans effet */ }
  return 'promu';
}
