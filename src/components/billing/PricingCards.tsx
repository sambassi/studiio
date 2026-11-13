'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Check } from 'lucide-react';
import { ETAT_INTERACTIF_SANS_FOND, classesSegment } from '@/lib/ui/etats';
import { totalAnnuelCentimes } from '@/lib/stripe/constants';
import { ChoixPaiement, type OffreChoisie } from '@/components/billing/ChoixPaiement';

function centsToFr(cents: number): string {
  if (cents === 0) return '0 CHF';
  const francs = cents / 100;
  return francs % 1 === 0 ? `${francs} CHF` : `${francs.toFixed(2).replace('.', ',')} CHF`;
}

interface Plan {
  key: string; name: string; price_cents: number; yearly_price_cents: number;
  credits: number; features: string[] | string; popular?: boolean;
  watermark?: boolean; yearly_total?: number;
}

interface PricingCardsProps {
  onSelectPlan?: (plan: string) => void;
  /**
   * L'abonnement en vigueur, lu par l'appelant dans la table de facturation.
   *
   * ⚠️ SOURCE UNIQUE. Sans cette entrée, la carte lisait le plan du JETON DE
   * SESSION pendant que l'écran de facturation lisait l'abonnement en base :
   * un compte pouvait voir « Abonnement actuel : Free » et, deux blocs plus
   * bas, « Plan actuel » sur Pro. Un jeton peut être périmé — la table de
   * facturation, non. L'appelant qui connaît l'abonnement doit donc le
   * passer ; à défaut, on retombe sur la session, comportement d'avant.
   */
  planActuel?: string;
}

const PLAN_ORDER = ['free', 'starter', 'pro', 'enterprise'];

export function PricingCards({ onSelectPlan, planActuel }: PricingCardsProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [offre, setOffre] = useState<OffreChoisie | null>(null);
  const currentPlan = (planActuel || ((session?.user as any)?.plan as string) || 'free').toLowerCase();

  useEffect(() => {
    fetch('/api/pricing', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d.plans) setPlans(d.plans);
    }).catch(() => {});
  }, []);

  /*
    ⚠️ ON N'OUVRE PLUS LE PAIEMENT PAR CARTE DIRECTEMENT. Le clic ouvrait
    `create-checkout` et, quand aucun identifiant de prix bancaire n'était
    configuré, se terminait par un `alert()` du navigateur disant « prix non
    configuré » — une phrase vraie pour le serveur, incompréhensible pour qui
    veut acheter, et sans rien à faire ensuite.

    Le clic ouvre désormais le choix du moyen de paiement, qui porte aussi
    bien la carte que le Mobile Money, et affiche ses erreurs DANS Studiio.
  */
  const handleSubscribe = (planKey: string) => {
    if (planKey === 'free') {
      if (!session) router.push('/auth/signup');
      return;
    }
    if (onSelectPlan) { onSelectPlan(planKey); return; }
    const p = plans.find((x) => x.key === planKey);
    if (!p) return;
    const cents = billingCycle === 'yearly' ? (p.yearly_price_cents || 0) : p.price_cents;
    setOffre({
      type: 'plan',
      cle: planKey,
      nom: p.name,
      cycle: billingCycle,
      prix: `${centsToFr(cents)}${billingCycle === 'yearly' ? '/mois, facturé annuellement' : '/mois'}`,
    });
  };

  const ordered = PLAN_ORDER.map(k => plans.find(p => p.key === k)).filter(Boolean) as Plan[];

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="inline-flex bg-gray-800 rounded-full p-1">
          {/* Bascule persistante : `aria-pressed` + coche, l'accent rose est
              volontaire (mise en avant tarifaire), les retours d'interaction
              viennent du module partagé. */}
          <button type="button" onClick={() => setBillingCycle('monthly')} aria-pressed={billingCycle === 'monthly'}
            className={`inline-flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold ${ETAT_INTERACTIF_SANS_FOND} ${classesSegment(billingCycle === 'monthly')}`}>
            {billingCycle === 'monthly' && <Check size={14} aria-hidden />}
            Mensuel
          </button>
          <button type="button" onClick={() => setBillingCycle('yearly')} aria-pressed={billingCycle === 'yearly'}
            className={`inline-flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold ${ETAT_INTERACTIF_SANS_FOND} ${classesSegment(billingCycle === 'yearly')}`}>
            {billingCycle === 'yearly' && <Check size={14} aria-hidden />}
            Annuel <span className="text-xs text-green-400 ml-1">-17%</span>
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {ordered.map((plan) => {
          const isPopular = !!plan.popular;
          const isCurrent = currentPlan === plan.key;
          const priceLabel = billingCycle === 'yearly' ? centsToFr(plan.yearly_price_cents || 0) : centsToFr(plan.price_cents);
          const period = plan.key === 'free' ? '' : '/mois';
          const features = typeof plan.features === 'string' ? JSON.parse(plan.features) : (plan.features || []);
          /*
            ⚠️ DEUX CARTES POUVAIENT PORTER « PLAN ACTUEL ». La carte Gratuit
            l'affichait dès qu'une session existait (`isCurrent || !!session`),
            quel que soit l'abonnement réel : un abonné Pro voyait donc la
            mention sur Gratuit ET sur Pro. Une seule formule est l'actuelle,
            et c'est `isCurrent` qui le dit — lui seul.
          */
          const cta = isCurrent
            ? 'Plan actuel'
            : plan.key === 'free'
              ? (session ? 'Revenir au gratuit' : 'Commencer gratuitement')
              : "S'abonner";

          return (
            <Card key={plan.key} className={isPopular ? 'border-studiio-accent border-2 relative' : 'relative'}>
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-block bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-bold">Plus populaire</span>
                </div>
              )}
              <CardHeader className="border-b border-gray-800">
                <CardTitle>{plan.name}</CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-white">{priceLabel}</span>
                  <span className="text-gray-400 text-sm">{period}</span>
                </div>
                {billingCycle === 'yearly' && plan.key !== 'free' && plan.yearly_price_cents > 0 && (
                  <p className="text-xs text-gray-500 mt-1">{centsToFr(totalAnnuelCentimes(plan.yearly_price_cents || 0))} facturé annuellement</p>
                )}
              </CardHeader>
              <CardContent className="pt-6">
                <ul className="space-y-3">
                  {features.map((feature: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-gray-300 text-sm">
                      <Check size={16} className="text-studiio-accent flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button variant={isPopular ? 'primary' : 'secondary'} className="w-full"
                  disabled={isCurrent} onClick={() => handleSubscribe(plan.key)}>
                  {cta}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <ChoixPaiement
        offre={offre}
        onFermer={() => setOffre(null)}
        onCredite={() => router.refresh()}
      />
    </div>
  );
}
