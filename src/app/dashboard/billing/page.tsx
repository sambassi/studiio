'use client';

import { CreditsDisplay } from '@/components/billing/CreditsDisplay';
import { PricingCards } from '@/components/billing/PricingCards';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { CREDIT_PACKAGES, STRIPE_PLANS } from '@/lib/stripe/constants';

const mockTransactions = [
  { id: '1', date: '2024-03-25', description: 'Rendu vidéo - Reel 9:16', credits: -10, balance: 1250 },
  { id: '2', date: '2024-03-24', description: 'Achat 150 crédits', credits: 150, balance: 1260 },
  { id: '3', date: '2024-03-23', description: 'Rendu vidéo - TV 16:9', credits: -15, balance: 1110 },
  { id: '4', date: '2024-03-22', description: 'Abonnement Pro', credits: 500, balance: 1125 },
  { id: '5', date: '2024-03-20', description: 'Crédits bonus', credits: 100, balance: 625 },
];

export default function BillingPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Facturation</h1>
        <p className="text-gray-400">Gérez vos crédits et votre abonnement</p>
      </div>
      <CreditsDisplay credits={1250} isPro={true} />
      <PricingCards onSelectPlan={(plan) => console.log(plan)} />
    </div>
  );
}
