'use client';

import { Table } from '@/components/ui/Table';
import { Badge } from 'A/components/ui/Badge';
import { Button } from '@/components/ui/Button';

const mockSubscriptions = [
  { id: '1', user: 'Jean Dupont', plan: 'Pro', status: 'active', start: '2024-01-15', end: '2024-04-15', auto_renew: true },
  { id: '2', user: 'Marie Martin', plan: 'Starter', status: 'active', start: '2024-02-20', end: '2024-05-20', auto_renew: true },
  { id: '3', user: 'Pierre Bernard', plan: 'Pro', status: 'active', start: '2024-01-10', end: '2024-04-10', auto_renew: true },
  { id: '4', user: 'Sophie Lefevre', plan: 'Starter', status: 'canceled', start: '2024-02-01', end: '2024-03-01', auto_renew: false },
  { id: '5', user: 'Luc Boulanger', plan: 'Enterprise', status: 'active', start: '2023-12-01', end: '2024-12-01', auto_renew: true },
];

export function SubscriptionTable() {
  const columns = [
    {
      key: 'user' as const,
      label: 'Utilisateur',
    },
    {
      key: 'plan' as const,
      label: 'Plan',
      render: (value: any) => <Badge variant="primary">{value}</Badge>,
    },
    {
      key: 'status' as const,
      label: 'Statut',
      render: (value: any) => (
        <Badge variant={value === 'active' ? 'success' : 'error'}>
          {value === 'active' ? 'Actif' : 'Résilié'}
        </Badge>
      ),
    },
    {
      key: 'start' as const,
      label: 'Début',
    },
    {
      key: 'end' as const,
      label: 'Fin',
    },
    {
      key: 'auto_renew' as const,
      label: 'Renouvellement auto',
      render: (value: any) => value ? '✓' : '✗',
    },
    {
      key: 'id' as const,
      label: 'Actions',
      render: () => (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary">Éditer</Button>
          <Button size="sm" variant="secondary">Annuler</Button>
        </div>
      ),
    },
  ];

  return <Table data={mockSubscriptions} columns={columns} />;
}
