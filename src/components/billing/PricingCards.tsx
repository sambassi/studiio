'use client';

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Check } from 'lucide-react';

interface PricingCardsProps {
  onSelectPlan?: (plan: 'starter' | 'pro' | 'enterprise') => void;
}

const plans = [
  {
    id: 'starter',
    name: 'Starter',
    price: '29,99€',
    period: '/mois',
    description: 'Pour les créateurs débutants',
    features: ['100 crédits/mois', '3 vidéos/mois', 'Format Reel 9:16', 'Support basique'],
    popular: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '79,99€',
    period: '/mois',
    description: 'Pour les créateurs actifs',
    features: ['500 crédits/mois', 'Vidéos illimitées', 'Tous les formats', 'Publier automatiquement', 'Support prioritaire'],
    popular: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '299,99€',
    period: '/mois',
    description: 'Pour les agences',
    features: ['Crédits illimitées', 'Utilisateurs illimitées', 'API access', 'Support 24/7', 'Personnalisation'],
    popular: false,
  },
];

export function PricingCards({ onSelectPlan }: PricingCardsProps) {
  return (
    <div className="grid md:grid-cols-3 gap-8">
      {plans.map((plan) => (
        <Card key={plan.id} className={plan.popular ? 'border-studiio-accent border-2' : ''}>
          {plan.popular && (
            <div className="px-6 pt-6 pb-0">
              <span className="inline-block bg-studiio-accent text-white px-3 py-1 rounded-full text-sm font-bold mb-4">
                Plus populaire
              </span>
            </div>
          )}
          <CardHeader className="border-b border-gray-800">
            <CardTitle>{plan.name}</CardTitle>
            <p className="text-gray-400 text-sm mt-2">{plan.description}</p>
            <div className="mt-4">
              <span className="text-4xl font-bold text-white">{plan.price}</span>
              <span className="text-gray-400 text-sm">{plan.period}</span>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <ul className="space-y-3">
              {plan.features.map((feature, idx) => (
                <li key={idx} className="flex items-center gap-2 text-gray-300 text-sm">
                  <Check size={16} className="text-studiio-accent" />
                  {feature}
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button
              variant={plan.popular ? 'primary' : 'secondary'}
              className="w-full"
              onClick={() => onSelectPlan?.(plan.id as any)}
            >
              Choisir
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
