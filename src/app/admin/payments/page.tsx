'use client';

import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { PaymentTable } from '@/components/admin/PaymentTable';
import { Card } from '@/components/ui/Card';
import { Download } from 'lucide-react';
import { useTranslations } from '@/i18n/client';

export default function PaymentsPage() {
  const t = useTranslations('admin');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">{t('payments.title')}</h1>
          <p className="text-gray-400">{t('payments.subtitle')}</p>
        </div>
        <Button variant="primary">
          <Download size={20} />
          {t('payments.exportCSV')}
        </Button>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Card>
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-2">{t('payments.stats.monthlyRevenue')}</p>
            <p className="text-3xl font-bold text-white">€18,450</p>
            <p className="text-xs text-green-400 mt-2">↑ 22% {t('payments.stats.vsLastMonth')}</p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-2">{t('payments.stats.transactions')}</p>
            <p className="text-3xl font-bold text-white">247</p>
            <p className="text-xs text-gray-400 mt-2">{t('payments.stats.thisMonth')}</p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-2">{t('payments.stats.conversionRate')}</p>
            <p className="text-3xl font-bold text-white">3,2%</p>
            <p className="text-xs text-green-400 mt-2">↑ {t('payments.stats.stable')}</p>
          </div>
        </Card>
        <Card>
          <div className="p-6">
            <p className="text-gray-400 text-sm mb-2">{t('payments.stats.failedTransactions')}</p>
            <p className="text-3xl font-bold text-white">8</p>
            <p className="text-xs text-gray-400 mt-2">{t('payments.stats.toExamine')}</p>
          </div>
        </Card>
      </div>

      <div className="flex gap-4">
        <Select
          options={[
            { value: 'subscription', label: t('payments.filters.subscription') },
            { value: 'credits', label: t('payments.filters.credits') },
          ]}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        />
        <Select
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
