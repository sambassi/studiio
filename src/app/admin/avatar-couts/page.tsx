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
interface MoisCredits {
  mois: string; vendus: number; abonnement: number; offerts: number;
  remboursés: number; consommes: number; recetteEstimeeChf: number | null; nonClassees: number;
}
interface MargeMois {
  mois: string; recetteEstimeeChf: number | null; coutFournisseurChf: number | null;
  margeEstimeeChf: number | null; motif: string | null;
}
interface Bilan {
  credits: MoisCredits[]; marges: MargeMois[];
  valeurCreditChf: number | null; chfParEur: number | null; tauxLe: string | null;
}
interface Reponse {
  migrationAppliquee: boolean;
  /** `null` = bilan illisible ; la page de coûts reste utilisable. */
  bilan: Bilan | null;
  generations: Generation[];
  totaux: { providerCostEur: number | null; providerCostAdminEur: number | null; studiioPriceEur: number | null; marginEur: number | null; nonMesurees: number };
}

const eur = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toFixed(4)} €` : 'non mesuré');
const chf = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toFixed(2)} CHF` : 'inconnu');

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
      {/* ── Crédits et recette, mois par mois ────────────────────────── */}
      {data.bilan && data.bilan.credits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Crédits et recette, par mois</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-gray-500">
              La recette est une <b>estimation</b> : <code>credit_transactions</code> enregistre des crédits, pas des
              montants encaissés — l’encaissement réel est chez le prestataire de paiement. Les crédits d’abonnement
              ne comptent pas comme une recharge.
              {data.bilan.valeurCreditChf === null
                ? ' Valeur du crédit non configurée : aucune recette n’est estimée.'
                : ` Valeur du crédit retenue : ${data.bilan.valeurCreditChf} CHF.`}
              {data.bilan.tauxLe && ` Taux EUR → CHF du ${data.bilan.tauxLe}.`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="bilan-credits">
                <thead>
                  <tr className="text-left text-gray-400">
                    <th className="p-2">Mois</th><th className="p-2">Vendus</th><th className="p-2">Abonnement</th>
                    <th className="p-2">Offerts</th><th className="p-2">Remboursés</th><th className="p-2">Consommés</th>
                    <th className="p-2">Recette estimée</th><th className="p-2">Coût fournisseur</th><th className="p-2">Marge estimée</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bilan.credits.map((m) => {
                    const marge = data.bilan?.marges.find((x) => x.mois === m.mois);
                    return (
                      <tr key={m.mois} className="border-t border-gray-800">
                        <td className="p-2 whitespace-nowrap">{m.mois}</td>
                        <td className="p-2">{m.vendus}</td>
                        <td className="p-2">{m.abonnement}</td>
                        <td className="p-2">{m.offerts}</td>
                        <td className="p-2">{m.remboursés}</td>
                        <td className="p-2">{m.consommes}</td>
                        <td className="p-2">{chf(m.recetteEstimeeChf)}</td>
                        <td className="p-2">{chf(marge?.coutFournisseurChf)}</td>
                        <td className="p-2" title={marge?.motif ?? ''}>
                          <span className={typeof marge?.margeEstimeeChf === 'number' && marge.margeEstimeeChf < 0 ? 'text-red-400' : ''}>
                            {chf(marge?.margeEstimeeChf)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
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
