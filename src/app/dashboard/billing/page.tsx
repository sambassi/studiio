import { redirect } from 'next/navigation';
import { normaliserPlan, normaliserFacturation } from '@/lib/billing/plan-choisi';
import { PlanPreselectionne } from './PlanPreselectionne';

/**
 * `/dashboard/billing` — ancienne page de facturation, devenue un aiguillage.
 *
 * - Sans plan (ou plan inconnu) : redirection historique vers l'onglet
 *   Abonnement des paramètres, comportement inchangé.
 * - Avec `?plan=starter|pro|enterprise` (arrivée depuis l'inscription) : le
 *   plan choisi sur la landing est présélectionné. AUCUN paiement n'est lancé
 *   automatiquement : l'utilisateur confirme d'un clic.
 */
export default function BillingPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const brut = (k: string) => {
    const v = searchParams?.[k];
    return typeof v === 'string' ? v : null;
  };
  const plan = normaliserPlan(brut('plan'));
  if (!plan) redirect('/dashboard/settings?tab=abonnement');
  return <PlanPreselectionne plan={plan} billing={normaliserFacturation(brut('billing'))} />;
}
