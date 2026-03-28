import { Card, CardContent } from '@/components/ui/Card';
import { Zap } from 'lucide-react';

interface CreditsDisplayProps {
  credits: number;
  isPro?: boolean;
}

export function CreditsDisplay({ credits, isPro }: CreditsDisplayProps) {
  return (
    <Card className="border-studiio-accent/30">
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-400 text-sm mb-2">Crédits disponibles</p>
            <p className="text-4xl font-bold text-studiio-accent">{credits.toLocaleString()}</p>
            {isPro && <p className="text-xs text-gray-400 mt-2">Plan Pro - Renouvellement le 2 avril</p>}
          </div>
          <Zap className="text-studiio-accent" size={48} />
        </div>
      </CardContent>
    </Card>
  );
}
