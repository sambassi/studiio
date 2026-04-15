'use client';

import { useEffect, useState } from 'react';
import { PricingCards } from '@/components/billing/PricingCards';
import { BuyCreditsModal } from '@/components/billing/BuyCreditsModal';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Loader2, Zap } from 'lucide-react';
import { useTranslations } from '@/i18n/client';

interface SubscriptionInfo {
  plan: string;
  status: string;
  current_period_end: string | null;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  created_at: string;
}

export default function BillingPage() {
  const t = useTranslations('billing');
  const tc = useTranslations('common');
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [sub, setSub] = useState<SubscriptionInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showBuy, setShowBuy] = useState(false);

  useEffect(() => {
    fetch('/api/credits/balance').then(r => r.json()).then(d => { if (d?.ok) setCredits(d.balance); }).catch(() => {});
    fetch('/api/billing/summary').then(r => r.json()).then(d => {
      if (d?.ok) { setSub(d.subscription); setTransactions(d.transactions || []); }
    }).catch(() => {});
  }, []);

  const handleManageSubscription = async () => {
    setLoadingPortal(true);
    try {
      const res = await fetch('/api/stripe/create-portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Erreur');
    } catch {
      alert('Erreur de connexion');
    } finally {
      setLoadingPortal(false);
    }
  };

  const planName = sub?.plan || 'free';
  const nextDate = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString('fr-FR')
    : '—';

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">{t('title')}</h1>
        <p className="text-gray-400">{t('subtitle')}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader className="border-b border-gray-800">
            <CardTitle>Crédits</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Zap className="text-purple-400" size={32} />
              <div>
                <div className="text-4xl font-bold text-white">{credits ?? '—'}</div>
                <div className="text-xs text-gray-400">crédits restants</div>
              </div>
            </div>
            <Button variant="primary" className="w-full mt-4" onClick={() => setShowBuy(true)}>
              Acheter des crédits
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="border-b border-gray-800">
            <CardTitle>{t('currentPlan')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm text-gray-400 mb-1">{t('plan')}</p>
                <p className="text-2xl font-bold text-white capitalize">{planName}</p>
              </div>
              <Badge variant={sub?.status === 'active' ? 'success' : 'default'}>
                {sub?.status || 'free'}
              </Badge>
            </div>
            <div className="pt-4 border-t border-gray-800">
              <p className="text-sm text-gray-400 mb-1">Prochain renouvellement</p>
              <p className="text-white font-semibold">{nextDate}</p>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleManageSubscription}
              disabled={loadingPortal}
            >
              {loadingPortal ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{tc('loading')}</> : 'Gérer l\'abonnement'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="border-b border-gray-800">
          <CardTitle>Dernières transactions</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-2 text-gray-400 font-medium">Date</th>
                  <th className="text-left py-2 text-gray-400 font-medium">Type</th>
                  <th className="text-right py-2 text-gray-400 font-medium">Crédits</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 && (
                  <tr><td colSpan={3} className="py-6 text-center text-gray-500">Aucune transaction</td></tr>
                )}
                {transactions.map((tx) => (
                  <tr key={tx.id} className="border-b border-gray-800 last:border-0">
                    <td className="py-3 text-gray-300">{new Date(tx.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="py-3 text-gray-300">{tx.type}</td>
                    <td className={`text-right py-3 font-semibold ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-2xl font-bold text-white mb-6">{t('changePlan')}</h2>
        <PricingCards />
      </div>

      <BuyCreditsModal isOpen={showBuy} onClose={() => setShowBuy(false)} />
    </div>
  );
}
