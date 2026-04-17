'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Download } from 'lucide-react';

interface Plan {
  key: string; name: string; price_cents: number; yearly_price_cents: number;
  credits: number; features: string[]; popular: boolean; active: boolean; watermark: boolean;
}
interface Pack {
  key: string; name: string; amount: number; price_cents: number;
  popular: boolean; active: boolean;
}

export default function PricingAdminPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [toast, setToast] = useState('');

  const loadPricing = async () => {
    const res = await fetch('/api/pricing', { cache: 'no-store' });
    const { plans: p = [], packs: pk = [] } = await res.json();
    setPlans(p);
    setPacks(pk);
    setLoading(false);
  };

  useEffect(() => {
    loadPricing();
  }, []);

  const runSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch('/api/admin/pricing/seed', { method: 'POST' });
      const data = await res.json();
      setToast(data.success ? 'Tarification initialisée' : `Erreur: ${data.error || 'seed'}`);
      setTimeout(() => setToast(''), 3000);
      await loadPricing();
    } finally {
      setSeeding(false);
    }
  };

  const savePlan = async (plan: Plan) => {
    setSaving(plan.key);
    const res = await fetch('/api/admin/pricing/update-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    });
    const data = await res.json();
    setSaving(null);
    setToast(data.success ? `Plan ${plan.name} sauvegardé` : `Erreur: ${data.error}`);
    setTimeout(() => setToast(''), 3000);
  };

  const savePack = async (pack: Pack) => {
    setSaving(pack.key);
    const res = await fetch('/api/admin/pricing/update-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pack),
    });
    const data = await res.json();
    setSaving(null);
    setToast(data.success ? `Pack ${pack.name} sauvegardé` : `Erreur: ${data.error}`);
    setTimeout(() => setToast(''), 3000);
  };

  if (loading) return <div className="flex items-center justify-center h-[50vh]"><Loader2 className="animate-spin text-purple-400" size={32} /></div>;

  return (
    <div className="space-y-8">
      {toast && (
        <div className="fixed top-6 right-6 z-50 rounded-lg bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-1">
        <p className="text-sm font-semibold text-amber-300">⚠️ Changement de prix = nouveau Stripe Price</p>
        <ul className="text-xs text-amber-400/80 list-disc pl-4 space-y-0.5">
          <li>Les nouveaux clients paieront le nouveau prix</li>
          <li>Les abonnés existants conservent leur tarif jusqu'à résiliation</li>
          <li>Si la sauvegarde Stripe échoue, la DB n'est pas modifiée</li>
        </ul>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-white mb-1">Tarification</h1>
        <p className="text-gray-400 text-sm">Gérez les plans et packs de crédits.</p>
      </div>

      {plans.length === 0 && packs.length === 0 && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-300">Initialisation requise</p>
            <p className="text-xs text-blue-400/80 mt-0.5">Aucun plan ou pack trouvé en base. Importez les valeurs par défaut depuis les constantes du code.</p>
          </div>
          <button
            onClick={runSeed}
            disabled={seeding}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 whitespace-nowrap"
          >
            {seeding ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Initialiser depuis les constantes
          </button>
        </div>
      )}

      {/* Plans */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Plans</h2>
        <div className="grid gap-4">
          {plans.map((plan) => (
            <div key={plan.key} className="rounded-xl border border-gray-700 bg-gray-800 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white text-lg">{plan.name} <span className="text-xs text-gray-500">({plan.key})</span></h3>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    <input type="checkbox" checked={plan.popular} onChange={(e) => setPlans(plans.map(p => p.key === plan.key ? { ...p, popular: e.target.checked } : p))} className="accent-purple-500" />
                    Populaire
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    <input type="checkbox" checked={plan.active} onChange={(e) => setPlans(plans.map(p => p.key === plan.key ? { ...p, active: e.target.checked } : p))} className="accent-purple-500" />
                    Actif
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    <input type="checkbox" checked={plan.watermark} onChange={(e) => setPlans(plans.map(p => p.key === plan.key ? { ...p, watermark: e.target.checked } : p))} className="accent-purple-500" />
                    Watermark
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Nom</label>
                  <input type="text" value={plan.name} onChange={(e) => setPlans(plans.map(p => p.key === plan.key ? { ...p, name: e.target.value } : p))}
                    className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Prix mensuel (centimes CHF)</label>
                  <input type="number" value={plan.price_cents} onChange={(e) => setPlans(plans.map(p => p.key === plan.key ? { ...p, price_cents: Number(e.target.value) } : p))}
                    className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Prix annuel (centimes CHF/mois)</label>
                  <input type="number" value={plan.yearly_price_cents} onChange={(e) => setPlans(plans.map(p => p.key === plan.key ? { ...p, yearly_price_cents: Number(e.target.value) } : p))}
                    className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Crédits/mois</label>
                  <input type="number" value={plan.credits} onChange={(e) => setPlans(plans.map(p => p.key === plan.key ? { ...p, credits: Number(e.target.value) } : p))}
                    className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm text-white" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase">Features (JSON)</label>
                <textarea value={JSON.stringify(plan.features)} onChange={(e) => { try { setPlans(plans.map(p => p.key === plan.key ? { ...p, features: JSON.parse(e.target.value) } : p)); } catch {} }}
                  className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-xs text-white font-mono h-16 resize-none" />
              </div>
              <button onClick={() => savePlan(plan)} disabled={saving === plan.key}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {saving === plan.key ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Sauvegarder
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Packs */}
      <div>
        <h2 className="text-xl font-bold text-white mb-4">Packs de crédits</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {packs.map((pack) => (
            <div key={pack.key} className="rounded-xl border border-gray-700 bg-gray-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-white">{pack.name} <span className="text-xs text-gray-500">({pack.key})</span></h3>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    <input type="checkbox" checked={pack.popular} onChange={(e) => setPacks(packs.map(p => p.key === pack.key ? { ...p, popular: e.target.checked } : p))} className="accent-purple-500" /> Populaire
                  </label>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    <input type="checkbox" checked={pack.active} onChange={(e) => setPacks(packs.map(p => p.key === pack.key ? { ...p, active: e.target.checked } : p))} className="accent-purple-500" /> Actif
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Nom</label>
                  <input type="text" value={pack.name} onChange={(e) => setPacks(packs.map(p => p.key === pack.key ? { ...p, name: e.target.value } : p))}
                    className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Crédits</label>
                  <input type="number" value={pack.amount} onChange={(e) => setPacks(packs.map(p => p.key === pack.key ? { ...p, amount: Number(e.target.value) } : p))}
                    className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase">Prix (centimes CHF)</label>
                  <input type="number" value={pack.price_cents} onChange={(e) => setPacks(packs.map(p => p.key === pack.key ? { ...p, price_cents: Number(e.target.value) } : p))}
                    className="w-full rounded bg-gray-700 border border-gray-600 px-2 py-1.5 text-sm text-white" />
                </div>
              </div>
              <button onClick={() => savePack(pack)} disabled={saving === pack.key}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                {saving === pack.key ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Sauvegarder
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
