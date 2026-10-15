/**
 * Confirmation d'une tentative de rendu — la preuve, puis la politique.
 *
 * Extrait TEL QUEL de `POST /api/render/jobs/[id]/confirm` (A2.3) pour que
 * le rendu serveur (`/api/render/jobs/[id]/serveur`) passe par la MÊME porte
 * que le navigateur : une seule logique de preuve et de facturation, jamais
 * deux qui divergeraient. Comportement verrouillé par
 * `src/__tests__/contracts/rendu-confirm-caracterisation.contract.test.ts`.
 *
 * L'appelant a déjà authentifié et relu la ligne avec `lireRendu` (contrôle
 * de propriété). Rien ici ne vient du client : la politique est relue en
 * base, la clé et le bucket viennent de la ligne.
 *
 * Les exceptions remontent telles quelles : c'est l'appelant qui décide de
 * leur traduction (500 pour la route, aucun réessai pour le rendu serveur).
 */
import {
  confirmerRendu, confirmerRenduSansDebit, cloreRendu,
} from '@/lib/rendus/service';
import { politiqueDeLUtilisateur, consommeDesCredits } from '@/lib/facturation/politique';
import { verifierObjet } from '@/lib/storage/verifier-objet';

/** La ligne `rendus` telle que `lireRendu` la rend. */
export interface LigneRendu {
  id: string;
  bucket: string;
  cle_objet: string;
  etat: string;
  politique?: string | null;
  [cle: string]: unknown;
}

/** Résultat prêt à être rendu en HTTP. */
export interface IssueConfirmation {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Vérifie l'objet à la clé attribuée par le serveur, puis confirme selon la
 * politique — et c'est la SEULE porte par laquelle un crédit peut partir.
 *
 * Un objet absent ou invalide clôt la tentative en `failed` : aucun débit, et
 * elle ne pourra plus être confirmée. Un stockage injoignable la laisse
 * ouverte — la panne est de notre côté, pas la faute de l'utilisateur.
 */
export async function confirmerAvecPreuve(userId: string, rendu: LigneRendu): Promise<IssueConfirmation> {
  // La politique est RELUE en base, jamais reçue du client, et croisée avec
  // celle figée à la réservation. Le plus restrictif l'emporte : une
  // tentative ouverte en `credits` reste facturée en crédits même si le
  // rôle a changé entre-temps.
  const { politique: politiqueActuelle } = await politiqueDeLUtilisateur(userId);
  const surCredits = consommeDesCredits(politiqueActuelle)
    || rendu.politique !== 'partner_cost_only';

  // Déjà confirmée : on rend le même résultat, sans rien re-vérifier ni
  // re-débiter. Un double clic ou une reprise réseau aboutit ici.
  if (rendu.etat === 'confirmed') {
    if (!surCredits) {
      return {
        status: 200,
        body: {
          ok: true, etat: 'confirmed', dejaConfirme: true,
          politique: 'partner_cost_only', balance: null,
        },
      };
    }
    const r = await confirmerRendu(userId, rendu.id, 0, '');
    return {
      status: 200,
      body: {
        ok: true, etat: 'confirmed', dejaConfirme: true,
        politique: 'credits', balance: r.solde,
      },
    };
  }

  const preuve = await verifierObjet(rendu.bucket, rendu.cle_objet, userId);

  if (!preuve.ok) {
    if (preuve.motif === 'stockage_injoignable') {
      return { status: 503, body: { ok: false, error: 'Stockage injoignable', motif: preuve.motif } };
    }
    await cloreRendu(userId, rendu.id, 'failed', preuve.motif || 'objet invalide');
    return { status: 422, body: { ok: false, error: 'Aucun montage valide a cette cle', motif: preuve.motif } };
  }

  // ── Frais partenaires : confirmation SANS débit ──────────────────
  // La preuve serveur est identique -- l'objet a été vu, la transition
  // d'état est la même. Seul le paiement diffère : aucun crédit n'est
  // prélevé, et AUCUNE transaction fictive à zéro n'est créée.
  if (!surCredits) {
    const r = await confirmerRenduSansDebit(
      userId, rendu.id, preuve.taille, preuve.contentType,
      // Aucun partenaire externe n'intervient sur ce montage : rien à
      // enregistrer, et surtout pas un coût inventé.
      { partenaire: null, operationPartenaire: null, cout: null },
    );
    if (r.motif === 'socle_absent') {
      return {
        status: 503,
        body: { ok: false, error: 'Rendu indisponible : migration de facturation non appliquee.' },
      };
    }
    return {
      status: r.ok ? 200 : 422,
      body: {
        ok: r.ok, etat: r.etat, dejaConfirme: r.dejaConfirme, motif: r.motif,
        politique: 'partner_cost_only', balance: null, taille: preuve.taille,
      },
    };
  }

  const r = await confirmerRendu(userId, rendu.id, preuve.taille, preuve.contentType);

  if (r.motif === 'socle_absent') {
    return {
      status: 503,
      body: { ok: false, error: 'Rendu indisponible : migration des rendus non appliquee.' },
    };
  }

  return {
    status: r.ok ? 200 : 402,
    body: {
      ok: r.ok, etat: r.etat, balance: r.solde,
      dejaConfirme: r.dejaConfirme, motif: r.motif,
      politique: 'credits', taille: preuve.taille,
    },
  };
}
