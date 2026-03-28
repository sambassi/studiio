'use client';

import { Table } from '@/components/ui/Table';
import { Badge } from 'A/components/ui/Badge';

const mockPayments = [
  { id: '1', date: '2024-03-28', user: 'Jean Dupont', amount: '79,99€', type: 'Abonnement', status: 'completed', stripeId: 'pi_123456' },
  { id: '2', date: '2024-03-27', user: 'Marie Martin', amount: '24,99€', type: 'Achat crédits', status: 'completed', stripeId: 'pi_789012' },
  { id: '3', date: '2024-03-26', user: 'Pierre Bernard', amount: '299,99€', type: 'Abonnement', status: 'completed', stripeId: 'pi_345678' },
  { id: '4', date: '2024-03-25', user: 'Sophie Lefevre', amount: '9,99€', type: 'Achat crédits', status: 'failed', stripeId: 'pi_901234' },
  { id: '5', date: '2024-03-24', user: 'Luc Boulanger', amount: [74,99€', type: 'Achat crédits', status: 'completed', stripeId: 'pi_567890' },
];

export function PaymentTable() {
  const columns = [
    {
      key: 'date' as const,
      label: 'Date',
      sortable: true,
    },
    {
      key: 'user' as const,
      label: 'Utilisateur',
    },
    {
      key: 'amount' as const,
      label: 'Montant',
    },
    {
      key: 'type' as const,
      label: 'Type',
    },
    {
      key: 'status' as const,
      label: 'Statut',
      render: (value: any) => (
        <Badge variant={value === 'completed' ? 'success' : 'error'}>
          {value === 'completed' ? 'Complété' : 'Échoué'}
        </Badge>
      ),
    },
    {
      key: 'stripeId' as const,
      label: 'Stripe ID',
      className: 'font-mono text-xs',
    },
  ];

  return <Table data={mockPayments} columns={columns} />;
}
