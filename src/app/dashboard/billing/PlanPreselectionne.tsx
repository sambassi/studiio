'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Zap } from 'lucide-react';
import {
  centimesEnFrancs,
  resumePlan,
  type CycleFacturation,
  type PlanPayant,
} from '@/lib/billing/plan-choisi';

/**
 * Plan choisi sur la landing, présélectionné après l'inscription.
 *
 * Rien n'est déclenché au montage : le paiement ne part que sur le clic
 * « Continuer vers le paiement », avec exactement le même appel que
 * `PricingCards` (`/api/stripe/create-checkout`, `{ plan, billingCycle }`).
 */
export function PlanPreselectionne({ plan, billing }: { plan: PlanPayant; billing: CycleFacturation }) {
  const resume = resumePlan(plan);
  const [cycle, setCycle] = useState<CycleFacturation>(billing);
  const [live, setLive] = useState<{ price_cents?: number; yearly_price_cents?: number; credits?: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Prix vivants (mêmes que la landing) ; les constantes servent de repli.
  useEffect(() => {
    fetch('/api/pricing', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const found = Array.isArray(d?.plans) ? d.plans.find((p: any) => p?.key === plan) : null;
        if (found) setLive(found);
      })
      .catch(() => {});
  }, [plan]);

  const credits = live?.credits ?? resume.credits;
  const prix = cycle === 'yearly'
    ? (live?.yearly_price_cents ?? resume.prixAnnuelMensuelCentimes)
    : (live?.price_cents ?? resume.prixMensuelCentimes);

  const continuer = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, billingCycle: cycle }),
      });
      const data = await res.json();
      const url = data.url || data.data?.sessionUrl;
      if (url) { window.location.href = url; return; }
      setError(data.error || 'Impossible de démarrer le paiement.');
    } catch {
      setError('Erreur de connexion');
    }
    setLoading(false);
  };

  return (
    <div className="max-w-lg mx-auto py-8 space-y-6">
      <div data-plan-preselectionne={plan} className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-violet-400" />
          <span className="text-sm font-bold text-violet-300">Plan choisi</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{resume.nom}</h1>
            <p className="text-xs text-gray-400">{credits.toLocaleString()} crédits / mois</p>
          </div>
          <div className="text-right">
            <span className="text-3xl font-black text-white">{centimesEnFrancs(prix)} CHF</span>
            <span className="text-gray-500 text-xs">/mois</span>
          </div>
        </div>

        <div className="inline-flex bg-gray-800 rounded-full p-1">
          {(['monthly', 'yearly'] as const).map(c => (
            <button
              key={c}
              type="button"
              aria-pressed={cycle === c}
              onClick={() => setCycle(c)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold ${cycle === c ? 'bg-studiio-accent text-white' : 'text-gray-400 hover:text-white'}`}
            >
              {c === 'monthly' ? 'Mensuel' : 'Annuel'}
            </button>
          ))}
        </div>

        <ul className="space-y-1">
          {resume.features.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-gray-300">
              <Check size={14} className="text-violet-400 shrink-0" />
              {f}
            </li>
          ))}
        </ul>

        {error && (
          <p role="alert" className="text-sm text-red-400">{error}</p>
        )}

        <button
          type="button"
          onClick={continuer}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-bold py-3 rounded-xl transition disabled:opacity-50"
        >
          {loading && <Loader2 size={18} className="animate-spin" />}
          Continuer vers le paiement
        </button>
      </div>

      <p className="text-center text-sm text-gray-400">
        <Link href="/dashboard/settings?tab=abonnement" className="text-studiio-primary hover:text-purple-400 font-semibold">
          Voir tous les plans
        </Link>
      </p>
    </div>
  );
}
