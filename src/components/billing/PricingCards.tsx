'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Check, Loader2 } from 'lucide-react';
import { STRIPE_PLANS } from '@/lib/stripe/constants';

interface PricingCardsProps {
  onSelectPlan?: (plan: string) => void;
}

type PlanKey = 'free' | 'starter' | 'pro' | 'enterprise';
const PLAN_ORDER: PlanKey[] = ['free', 'starter', 'pro', 'enterprise'];

export function PricingCards({ onSelectPlan }: PricingCardsProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState<string | null>(null);
  const currentPlan = ((session?.user as any)?.plan as PlanKey) || 'free';

  const handleSubscribe = async (plan: PlanKey) => {
    if (plan === 'free') {
      if (!session) router.push('/auth/signup');
      return;
    }
    if (onSelectPlan) {
      onSelectPlan(plan);
      return;
    }
    setLoading(plan);
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, billingCycle }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Erreur');
    } catch (e) {
      alert('Erreur de connexion');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="inline-flex bg-gray-800 rounded-full p-1">
          <button
            onClick={() => setBillingCycle('monthly')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
              billingCycle === 'monthly' ? 'bg-studiio-accent text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Mensuel
          </button>
          <button
            onClick={() => setBillingCycle('yearly')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition ${
              billingCycle === 'yearly' ? 'bg-studiio-accent text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Annuel <span className="text-xs text-green-400 ml-1">-17%</span>
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {PLAN_ORDER.map((key) => {
          const plan = (STRIPE_PLANS as any)[key];
          const isPopular = !!plan.popular;
          const isCurrent = currentPlan === key;
          const priceLabel =
            billingCycle === 'yearly' ? plan.yearlyPriceFr : plan.priceFr;
          const period = key === 'free' ? '' : '/mois';

          const cta =
            key === 'free'
              ? isCurrent || !!session
                ? 'Plan actuel'
                : 'Commencer gratuitement'
              : isCurrent
              ? 'Plan actuel'
              : "S'abonner";

          return (
            <Card
              key={key}
              className={isPopular ? 'border-studiio-accent border-2 relative' : 'relative'}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-block bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-bold">
                    Plus populaire
                  </span>
                </div>
              )}
              <CardHeader className="border-b border-gray-800">
                <CardTitle>{plan.name}</CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-white">{priceLabel}</span>
                  <span className="text-gray-400 text-sm">{period}</span>
                </div>
                {billingCycle === 'yearly' && key !== 'free' && (
                  <p className="text-xs text-gray-500 mt-1">
                    {plan.yearlyTotalFr} facturé annuellement
                  </p>
                )}
              </CardHeader>
              <CardContent className="pt-6">
                <ul className="space-y-3">
                  {plan.features.map((feature: string, idx: number) => (
                    <li key={idx} className="flex items-start gap-2 text-gray-300 text-sm">
                      <Check size={16} className="text-studiio-accent flex-shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  variant={isPopular ? 'primary' : 'secondary'}
                  className="w-full"
                  disabled={isCurrent || loading === key}
                  onClick={() => handleSubscribe(key)}
                >
                  {loading === key ? <Loader2 className="w-4 h-4 animate-spin" /> : cta}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
