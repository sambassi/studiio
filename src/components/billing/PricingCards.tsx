'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Check, Loader2 } from 'lucide-react';

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

interface PricingCardsProps { onSelectPlan?: (plan: string) => void; }

const PLAN_ORDER = ['free', 'starter', 'pro', 'enterprise'];

export function PricingCards({ onSelectPlan }: PricingCardsProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const currentPlan = ((session?.user as any)?.plan as string) || 'free';

  useEffect(() => {
    fetch('/api/pricing', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d.plans) setPlans(d.plans);
    }).catch(() => {});
  }, []);

  const handleSubscribe = async (planKey: string) => {
    if (planKey === 'free') {
      if (!session) router.push('/auth/signup');
      return;
    }
    if (onSelectPlan) { onSelectPlan(planKey); return; }
    setLoading(planKey);
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey, billingCycle }),
      });
      const data = await res.json();
      const url = data.url || data.data?.sessionUrl;
      if (url) window.location.href = url;
      else alert(data.error || 'Erreur');
    } catch { alert('Erreur de connexion'); } finally { setLoading(null); }
  };

  const ordered = PLAN_ORDER.map(k => plans.find(p => p.key === k)).filter(Boolean) as Plan[];

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="inline-flex bg-gray-800 rounded-full p-1">
          <button onClick={() => setBillingCycle('monthly')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${billingCycle === 'monthly' ? 'bg-studiio-accent text-white' : 'text-gray-400 hover:text-white'}`}>
            Mensuel
          </button>
          <button onClick={() => setBillingCycle('yearly')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${billingCycle === 'yearly' ? 'bg-studiio-accent text-white' : 'text-gray-400 hover:text-white'}`}>
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
          const cta = plan.key === 'free'
            ? (isCurrent || !!session ? 'Plan actuel' : 'Commencer gratuitement')
            : (isCurrent ? 'Plan actuel' : "S'abonner");

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
                  <p className="text-xs text-gray-500 mt-1">{centsToFr((plan.yearly_price_cents || 0) * 12)} facturé annuellement</p>
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
                  disabled={isCurrent || loading === plan.key} onClick={() => handleSubscribe(plan.key)}>
                  {loading === plan.key ? <Loader2 className="w-4 h-4 animate-spin" /> : cta}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
