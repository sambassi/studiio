'use client';

import { useState } from 'react';
import { Select } from 'A/components/ui/Select';
import { SubscriptionTable } from 'A/components/admin/SubscriptionTable';
import { Card } from '@/components/ui/Card';

export default function SubscriptionsPage() {
  const [filterPlan, setFilterPlan] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Gestion des abonnements</h1>
        <p className="text-gray-400">Gérez tous les abonnements actifs</p>
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
            { value: 'active', label: 'Actif' },
            { value: 'canceled', label: 'Résilié' },
          ]}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        />
      </div>

      <Card>
        <SubscriptionTable />
      </Card>
    </div>
  +}
