'use client';

import { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface Generation {
  id: string; user_id: string; provider: string | null; provider_video_id: string | null; status: string;
  intention: string | null; credits_charged: number | null; credits_refunded: boolean | null; duration_seconds: number | null;
  created_at: string; provider_cost_eur?: number | null; studiio_credits?: number | null; studiio_price_eur?: number | null;
  margin_eur?: number | null; admin_usage?: boolean | null; provider_error?: string | null; error_message?: string | null;
}
interface Reponse {
  migrationAppliquee: boolean;
  generations: Generation[];
  totaux: { providerCostEur: number; providerCostAdminEur: number; studiioPriceEur: number; marginEur: number; nonMesurees: number };
}

const eur = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toFixed(4)} €` : '—');

export default function AvatarCoutsPage() {
  const [data, setData] = useState<Reponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/avatar-couts')
      .then((r) => r.json())
      .then((j) => (j.success ? setData(j.data) : setErreur(j.error || 'Lecture impossible')))
      .catch(() => setErreur('Lecture impossible'));
  }, []);

  if (erreur) return <div className="p-6 text-red-400 flex gap-2"><AlertCircle className="w-5 h-5" />{erreur}</div>;
  if (!data) return <div className="p-6"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Coûts avatar (fournisseurs)</h1>
      {!data.migrationAppliquee && (
        <p className="text-amber-300 text-sm">Migration 2026-10-06-avatar-couts.sql non appliquée : coûts non enregistrés en base (journaux serveur uniquement).</p>
      )}
      <Card>
        <CardHeader><CardTitle>Totaux (200 dernières générations)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div>PROVIDER_COST<br /><b>{eur(data.totaux.providerCostEur)}</b></div>
          <div>dont usage admin<br /><b>{eur(data.totaux.providerCostAdminEur)}</b></div>
          <div>STUDIIO_PRICE<br /><b>{eur(data.totaux.studiioPriceEur)}</b></div>
          <div>MARGIN<br /><b>{eur(data.totaux.marginEur)}</b></div>
          <div>Non mesurées<br /><b>{data.totaux.nonMesurees}</b></div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="p-2">Date</th><th className="p-2">PROVIDER</th><th className="p-2">PROVIDER_JOB_ID</th><th className="p-2">Statut</th>
                <th className="p-2">Admin</th><th className="p-2">Durée</th><th className="p-2">PROVIDER_COST</th><th className="p-2">STUDIIO_PRICE</th>
                <th className="p-2">MARGIN</th><th className="p-2">PROVIDER_ERROR</th>
              </tr>
            </thead>
            <tbody>
              {data.generations.map((g) => (
                <tr key={g.id} className="border-t border-gray-800">
                  <td className="p-2 whitespace-nowrap">{new Date(g.created_at).toLocaleString('fr-FR')}</td>
                  <td className="p-2">{g.provider ?? '—'}</td>
                  <td className="p-2 font-mono">{g.provider_video_id ?? '—'}</td>
                  <td className="p-2">{g.status}{g.credits_refunded ? ' (remboursé)' : ''}</td>
                  <td className="p-2">{g.admin_usage ? 'oui' : g.admin_usage === false ? 'non' : '—'}</td>
                  <td className="p-2">{g.duration_seconds ?? '—'}</td>
                  <td className="p-2">{eur(g.provider_cost_eur)}</td>
                  <td className="p-2">{eur(g.studiio_price_eur)}{typeof g.studiio_credits === 'number' ? ` (${g.studiio_credits} cr.)` : ''}</td>
                  <td className="p-2">{eur(g.margin_eur)}</td>
                  <td className="p-2 max-w-xs truncate" title={g.provider_error ?? ''}>{g.provider_error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
