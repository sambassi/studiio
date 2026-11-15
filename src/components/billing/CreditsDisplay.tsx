'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Zap } from 'lucide-react';
import { useTranslations } from '@/i18n/client';

interface CreditsDisplayProps {
  credits: number;
  isPro?: boolean;
}

export function CreditsDisplay({ credits, isPro }: CreditsDisplayProps) {
  const tUi = useTranslations('ui.componentsBillingCreditsDisplay');
  return (
    <Card className="border-studiio-accent/30">
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-400 text-sm mb-2">{tUi('credits_disponibles')}</p>
            <p className="text-4xl font-bold text-studiio-accent">{credits.toLocaleString()}</p>
            {isPro && <p className="text-xs text-gray-400 mt-2">{tUi('plan_pro_renouvellement_le_2_avril')}</p>}
          </div>
          <Zap className="text-studiio-accent" size={48} />
        </div>
      </CardContent>
    </Card>
  );
}
