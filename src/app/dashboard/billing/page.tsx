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

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="border-b border-gray-800">
            <CardTitle>Abonnement actuel</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-gray-400 mb-1">Plan</p>
                <p className="text-2xl font-bold text-white">Pro</p>
              </div>
              <Badge variant="success">Actif</Badge>
            </div>
            <div className="pt-4 border-t border-gray-800">
              <p className="text-sm text-gray-400 mb-1">Renouvellement</p>
              <p className="text-white font-semibold">2 avril 2024</p>
            </div>
            <Button variant="secondary" className="w-full">
              Gérer l'abonnement
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-gray-800">
            <CardTitle>Acheter des crédits</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-3">
            {Object.entries(CREDIT_PACKAGES).map(([key, pkg]) => (
              <Button key={key} variant="secondary" className="w-full">
                {pkg.name} - {pkg.priceFr}
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>Historique des transactions</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-2 text-gray-400 font-medium">Date</th>
                  <th className="text-left py-2 text-gray-400 font-medium">Description</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Crédits</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Solde</th>
                </tr>
              </thead>
              <tbody>
                {mockTransactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-800 last:border-0">
                    <td className="py-3 text-gray-300">{tx.date}</td>
                    <td className="py-3 text-gray-300">{tx.description}</td>
                    <td className={`text-right py-3 font-semibold ${tx.credits > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.credits > 0 ? '+' : ''}{tx.credits}
                    </td>
                    <td className="text-right py-3 text-white">{tx.balance}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-2xl font-bold text-white mb-6">Modifier votre plan</h2>
        <PricingCards onSelectPlan={(plan) => console.log('Selected plan:', plan)} />
      </div>
    </div>
  );
}
