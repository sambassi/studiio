import { Card, CardContent } from '@/components/ui/Card';
import { Zap } from 'lucide-react';

interface CreditsDisplayProps {
  /** Solde reel ; `null` = en chargement, indisponible, ou compte sans credits. */
  credits: number | null;
  /** Libelle a montrer quand le compte ne consomme pas de credits Studiio. */
  libelle?: string | null;
}

export function CreditsDisplay({ credits, libelle }: CreditsDisplayProps) {
  return (
    <Card className="border-studiio-accent/30">
      <CardContent>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-gray-400 text-sm mb-2">Crédits disponibles</p>
            <p className="text-4xl font-bold text-studiio-accent">
              {typeof credits === 'number' ? credits.toLocaleString('fr-FR') : '—'}
            </p>
            {credits === null && libelle && (
              <p className="text-xs text-gray-400 mt-2">{libelle}</p>
            )}
          </div>
          <Zap className="text-studiio-accent" size={48} />
        </div>
      </CardContent>
    </Card>
  );
}
