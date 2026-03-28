'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { UserTable } from '@/components/admin/UserTable';
import { Card } from '@/components/ui/Card';

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState('');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Gestion des utilisateurs</h1>
        <p className="text-gray-400">Gérez tous les utilisateurs de la plateforme</p>
      </div>

      <div className="flex gap-4 items-end">
        <Input
          placeholder="Rechercher par nom ou email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        <Select
          options={[
            { value: 'starter', label: 'Starter' },
            { value: 'pro', label: 'Pro' },
            { value: 'enterprise', label: 'Enterprise' },
          ]}
          value={filterPlan}
          onChange={(e) => setFilterPlan(e.target.value)}
        />
      </div>

      <Card>
        <UserTable />
      </Card>
    </div>
  );
}
