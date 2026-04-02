'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { SubscriptionTable } from '@/components/admin/SubscriptionTable';
import { Card } from '@/components/ui/Card';
import { useTranslations } from '@/i18n/client';

export default function SubscriptionsPage() {
  const t = useTranslations('admin');
  const [filterPlan, setFilterPlan] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">{t('subscriptions.title')}</h1>
        <p className="text-gray-400">{t('subscriptions.subtitle')}</p>
      </div>

      <div className="flex gap-4">
        <Select
          options={[
            { value: 'starter', label: 'Starter' },
            { value: 'pro', label: 'Pro' },
            { value: 'enterprise', label: 'Enterprise' },
          ]}
          value={filterPlan}
          onChange={(e) => setFilterPlan(e.target.value)}
        />
        <Select
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
