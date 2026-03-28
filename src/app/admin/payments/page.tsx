'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { PaymentTable } from '@/components/admin/PaymentTable';
import { Card } from '@/components/ui/Card';
import { Download } from 'lucide-react';

export default function PaymentsPage() {
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Historique des paiements</h1>
          <p className="text-gray-400">Tous les paiements de la plateforme</p>
        </div>
        <Button variant="primary">
          <Download size={20} />
          Exporter CSV
        </Button>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Card>
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-2">Revenus totaux (mois)</p>
            <p className="text-3xl font-bold text-white">€18,450</p>
            <p className="text-xs text-green-400 mt-2">↑ 22% vs mois précédent</p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-2">Transactions</p>
            <p className="text-3xl font-bold text-white">247</p>
            <p className="text-xs text-gray-400 mt-2">Ce mois</p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-2">Taux de conversion</p>
            <p className="text-3xl font-bold text-white">3,2%</p>
            <p className="text-xs text-green-400 mt-2">↑ Stable</p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-2">Transactions échouées</p>
            <p className="text-3xl font-bold text-white">8</p>
            <p className="text-xs text-gray-400 mt-2">À examiner</p>
          </div>
        </Card>
      </div>

      <div className="flex gap-4">
        <Select
          options={[
            { value: 'subscription', label: 'Abonnement' },
            { value: 'credits', label: 'Achat crédits' },
          ]}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        />
        <Select
          options={[
            { value: 'completed', label: 'Complété' },
            { value: 'failed', label: 'Échoué' },
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
