'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { SubscriptionTable } from '@/components/admin/SubscriptionTable';
import { Card } from '@/components/ui/Card';
import { useTranslations } from '@/i18n/client';
import { BandeauDemo } from '@/components/ui/BandeauDemo';

export default function SubscriptionsPage() {
  const t = useTranslations('admin');
  const [filterPlan, setFilterPlan] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  return (
    <div className="space-y-5">
      {/* Ces abonnements viennent VRAIMENT de la base
          (`/api/admin/subscriptions`). Le bandeau n'apparaît donc que si cette
          base est un double de prévisualisation ; en production, il est
          absent. */}
      <BandeauDemo />
      <div>
        <h1 className="text-3xl font-bold text-white mb-1">{t('subscriptions.title')}</h1>
        <p className="text-sm text-gray-400">{t('subscriptions.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        {/* Les deux listes n'avaient aucun intitulé, et les formules aucun
            prix : impossible de savoir ce qu'on filtrait. */}
        <Select
          label="Formule"
          options={[
            { value: 'starter', label: 'Starter — 19 CHF' },
            { value: 'pro', label: 'Pro — 49 CHF' },
            { value: 'enterprise', label: 'Enterprise — 149 CHF' },
          ]}
          value={filterPlan}
          onChange={(e) => setFilterPlan(e.target.value)}
        />
        <Select
          label="État de l’abonnement"
          options={[
            { value: 'active', label: t('subscriptions.filters.active') },
            { value: 'canceled', label: t('subscriptions.filters.canceled') },
          ]}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        />
      </div>

      <Card>
        <SubscriptionTable />
      </Card>
    </div>
  );
}
