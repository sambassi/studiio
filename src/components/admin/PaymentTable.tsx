'use client';

import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';

/**
 * ⚠️ EXEMPLES, PAS DES PAIEMENTS. Ces lignes sont écrites ici : elles ne
 * viennent ni de la base, ni du prestataire de paiement, et c'est vrai en
 * production aussi. L'écran les accompagne d'un bandeau inconditionnel
 * (`BandeauExemples`).
 *
 * Deux corrections par rapport à l'état précédent :
 *
 *   - LA DEVISE. Les montants étaient en euros (79,99 €, 299,99 €) alors que
 *     Studiio facture en CHF. Un montant dans la mauvaise devise, sur un
 *     écran de revenus, est une erreur de lecture garantie.
 *   - LES MONTANTS. Ils ne correspondaient à aucune offre existante. Ils
 *     reprennent maintenant les prix réels : abonnements 19 / 49 / 149 CHF,
 *     packs de crédits 9 / 29 / 59 / 179 CHF.
 *
 * Les noms restent manifestement fictifs et les références de transaction
 * portent le préfixe `exemple_`, pour qu'aucune ne puisse être confondue avec
 * une référence réelle ni recherchée chez le prestataire.
 */
const paiementsExemple = [
  { id: '1', date: '2026-11-10', user: 'Compte d’exemple A', amount: '49,00 CHF', type: 'Abonnement Pro', status: 'completed', stripeId: 'exemple_01' },
  { id: '2', date: '2026-11-09', user: 'Compte d’exemple B', amount: '29,00 CHF', type: 'Pack 200 crédits', status: 'completed', stripeId: 'exemple_02' },
  { id: '3', date: '2026-11-08', user: 'Compte d’exemple C', amount: '149,00 CHF', type: 'Abonnement Enterprise', status: 'completed', stripeId: 'exemple_03' },
  { id: '4', date: '2026-11-07', user: 'Compte d’exemple D', amount: '9,00 CHF', type: 'Pack 50 crédits', status: 'failed', stripeId: 'exemple_04' },
  { id: '5', date: '2026-11-06', user: 'Compte d’exemple E', amount: '19,00 CHF', type: 'Abonnement Starter', status: 'completed', stripeId: 'exemple_05' },
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

  return <Table data={paiementsExemple} columns={columns} />;
}
