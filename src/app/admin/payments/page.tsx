'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { PaymentTable } from '@/components/admin/PaymentTable';
import { Card } from '@/components/ui/Card';
import { Download } from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import { BandeauDemo, BandeauExemples } from '@/components/ui/BandeauDemo';

export default function PaymentsPage() {
  const t = useTranslations('admin');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  return (
    <div className="space-y-5">
      <BandeauDemo />
      {/*
        ⚠️ LES QUATRE VIGNETTES ET LE TABLEAU SONT DES EXEMPLES ÉCRITS DANS
        L'ÉCRAN. Ils affichaient « 18 450 € » de revenus mensuels, en euros,
        sans rien indiquer : le chiffre se lisait comme une mesure. Il n'en est
        pas une, et il ne l'est pas davantage en production. Le bandeau
        ci-dessous est donc INCONDITIONNEL, et les montants sont passés en CHF,
        la devise réelle de Studiio, avec des ordres de grandeur cohérents avec
        les offres (19 / 49 / 149 CHF et les packs de crédits).
      */}
      <BandeauExemples detail="Les quatre indicateurs et le tableau ci-dessous sont des exemples inscrits dans l’écran, en CHF, aux ordres de grandeur des offres Studiio. Ils ne proviennent ni de la base, ni du prestataire de paiement : aucun n’est un revenu mesuré." />
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">{t('payments.title')}</h1>
          <p className="text-sm text-gray-400">{t('payments.subtitle')}</p>
        </div>
        <Button variant="primary">
          <Download size={20} />
          {t('payments.exportCSV')}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="indicateurs-exemple">
        <Card>
          <div className="p-4">
            <p className="text-gray-400 text-xs mb-1">{t('payments.stats.monthlyRevenue')}</p>
            <p className="text-2xl font-bold text-white">901 CHF</p>
            <p className="text-[11px] text-gray-500 mt-1">exemple · 12 Starter + 6 Pro + 1 Enterprise + packs</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-gray-400 text-xs mb-1">{t('payments.stats.transactions')}</p>
            <p className="text-2xl font-bold text-white">38</p>
            <p className="text-[11px] text-gray-500 mt-1">exemple · {t('payments.stats.thisMonth')}</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-gray-400 text-xs mb-1">{t('payments.stats.conversionRate')}</p>
            <p className="text-2xl font-bold text-white">3,2 %</p>
            <p className="text-[11px] text-gray-500 mt-1">exemple</p>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <p className="text-gray-400 text-xs mb-1">{t('payments.stats.failedTransactions')}</p>
            <p className="text-2xl font-bold text-white">2</p>
            <p className="text-[11px] text-gray-500 mt-1">exemple · {t('payments.stats.toExamine')}</p>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Les deux listes n'avaient aucun intitulé : « Sélectionner… » deux
            fois de suite ne dit pas ce qu'on filtre. */}
        <Select
          label="Type de paiement"
          options={[
            { value: 'subscription', label: t('payments.filters.subscription') },
            { value: 'credits', label: t('payments.filters.credits') },
          ]}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        />
        <Select
          label="État du paiement"
          options={[
            { value: 'completed', label: t('payments.filters.completed') },
            { value: 'failed', label: t('payments.filters.failed') },
          ]}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        />
      </div>

      <Card>
        <PaymentTable />
      </Card>
    </div>
  );
}
