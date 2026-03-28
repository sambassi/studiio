'use client';

import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from 'A/components/ui/Button';

const mockUsers = [
  { id: '1', avatar: '👤', name: 'Jean Dupont', email: 'jean@example.com', plan: 'Pro', credits: 450, joined: '2024-01-15', status: 'active' },
  { id: '2', avatar: '👤', name: 'Marie Martin', email: 'marie@example.com', plan: 'Starter', credits: 50, joined: '2024-02-20', status: 'active' },
  { id: '3', avatar: '👤', name: 'Pierre Bernard', email: 'pierre@example.com', plan: 'Pro', credits: 500, joined: '2024-01-10', status: 'active' },
  { id: '4', avatar: '👤', name: 'Sophie Lefevre', email: 'sophie@example.com', plan: 'Starter', credits: 0, joined: '2024-03-01', status: 'inactive' },
  { id: '5', avatar: '👤', name: 'Luc Boulanger', email: 'luc@example.com', plan: 'Enterprise', credits: null, joined: '2023-12-01', status: 'active' },
];

export function UserTable() {
  const columns = [
    {
      key: 'name' as const,
      label: 'Utilisateur',
      render: (value: any, row: any) => (
        <div className="flex items-center gap-2">
          <span className="text-xl">{row.avatar}</span>
          <div>
            <p className="font-semibold text-white">{value}</p>
            <p className="text-xs text-gray-400">{row.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'plan' as const,
      label: 'Plan',
      render: (value: any) => <Badge variant="primary">{value}</Badge>,
    },
    {
      key: 'credits' as const,
      label: 'Crédits',
      render: (value: any) => value === null ? '∞' : value,
    },
    {
      key: 'joined' as const,
      label: 'Inscrit le',
    },
    {
      key: 'status' as const,
      label: 'Statut',
      render: (value: any) => (
        <Badge variant={value === 'active' ? 'success' : 'warning'}>
          {value === 'active' ? 'Actif' : 'Inactif'}
        </Badge>
      ),
    },
    {
      key: 'id' as const,
      label: 'Actions',
      render: () => (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary">Voir</Button>
          <Button size="sm" variant="secondary">Éditer</Button>
        </div>
      ),
    },
  ];

  return <Table data={mockUsers} columns={columns} />;
}
