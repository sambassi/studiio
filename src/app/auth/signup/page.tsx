'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Chrome, Facebook, Loader2, Check, Zap } from 'lucide-react';
import { useTranslations } from '@/i18n/client';
import {
  normaliserPlan,
  normaliserFacturation,
  destinationApresConnexion,
  resumePlan,
  centimesEnFrancs,
} from '@/lib/billing/plan-choisi';

function SignupContent() {
  const searchParams = useSearchParams();
  const planParam = searchParams.get('plan');
  const billingParam = searchParams.get('billing') || 'monthly';
  const guidedParam = searchParams.get('guided');

  // Set guided onboarding flag for the assistant chatbot
  useEffect(() => {
    if (guidedParam === 'true') {
      try { localStorage.setItem('studiio_guided_onboarding', 'true'); } catch {}
    }
  }, [guidedParam]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const t = useTranslations('auth');

  // Plan choisi sur la landing, ramené à une clé connue (liste fermée) : un
  // `?plan=` inconnu est ignoré, jamais recopié dans une URL ni dans la page.
  const planKey = normaliserPlan(planParam);
  const billing = normaliserFacturation(billingParam);

  // Résumé lu dans les constantes publiques, puis aligné sur les prix vivants
  // de `/api/pricing` (route publique, la même que la landing). L'ancien appel
  // à la route admin du CMS landing était bloqué par le middleware pour un
  // visiteur non connecté.
  const [livePlan, setLivePlan] = useState<{ price_cents?: number; yearly_price_cents?: number; credits?: number } | null>(null);
  useEffect(() => {
    if (!planKey) return;
    fetch('/api/pricing', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const found = Array.isArray(d?.plans) ? d.plans.find((p: any) => p?.key === planKey) : null;
        if (found) setLivePlan(found);
      })
      .catch(() => {});
  }, [planKey]);

  const selectedPlan = planKey ? resumePlan(planKey) : null;
  const credits = livePlan?.credits ?? selectedPlan?.credits ?? 0;
  const prixCentimes = !selectedPlan
    ? 0
    : billing === 'yearly'
      ? (livePlan?.yearly_price_cents ?? selectedPlan.prixAnnuelMensuelCentimes)
      : (livePlan?.price_cents ?? selectedPlan.prixMensuelCentimes);

  const handleOAuthSignIn = (provider: string) => {
    setLoading(provider);
    setError('');
    // Plan connu → facturation avec le plan présélectionné (aucun paiement lancé).
    signIn(provider, { callbackUrl: destinationApresConnexion(planKey, billing) });
  };

  return (
    <div className="min-h-screen bg-studiio-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="card-base p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">{t('signup.title')}</h1>
            <p className="text-gray-400">{t('signup.subtitle')}</p>
          </div>

          {/* Show selected plan if any */}
          {selectedPlan && (
            <div data-plan-choisi={selectedPlan.cle} className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={16} className="text-violet-400" />
                <span className="text-sm font-bold text-violet-300">{t('signup.selectedPlan')}</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">{selectedPlan.nom}</h3>
                  <p className="text-xs text-gray-400">{credits.toLocaleString()} {t('signup.creditsPerMonth')}</p>
                </div>
                <div className="text-right">
                  {/* Même devise et même format que la landing et `PricingCards`. */}
                  <span className="text-2xl font-black text-white">
                    {centimesEnFrancs(prixCentimes)} CHF
                  </span>
                  <span className="text-gray-500 text-xs">/{t('signup.month')}</span>
                </div>
              </div>
              {selectedPlan.features && selectedPlan.features.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {selectedPlan.features.slice(0, 4).map((f: string, i: number) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-gray-300">
                      <Check size={12} className="text-violet-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                  {selectedPlan.features.length > 4 && (
                    <li className="text-xs text-gray-500">+ {selectedPlan.features.length - 4} {t('signup.moreFeatures')}</li>
                  )}
                </ul>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm text-center">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={() => handleOAuthSignIn('google')}
              disabled={!!loading}
              className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {loading === 'google' ? <Loader2 size={20} className="animate-spin" /> : <Chrome size={20} />}
              {t('signup.google')}
            </button>
            <button
              onClick={() => handleOAuthSignIn('facebook')}
              disabled={!!loading}
              className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {loading === 'facebook' ? <Loader2 size={20} className="animate-spin" /> : <Facebook size={20} />}
              {t('signup.facebook')}
            </button>
          </div>

          <div className="text-center text-sm text-gray-400">
            <p>
              {t('signup.termsPrefix')}{' '}
              <span className="text-studiio-primary cursor-pointer">{t('signup.termsLink')}</span>{' '}
              {t('signup.termsAnd')}{' '}
              <span className="text-studiio-primary cursor-pointer">{t('signup.privacyLink')}</span>.
            </p>
          </div>

          <div className="text-center">
            <p className="text-gray-400">
              {t('signup.hasAccount')}{' '}
              <Link
                href={planKey ? `/auth/login?plan=${planKey}&billing=${billing}` : '/auth/login'}
                className="text-studiio-primary hover:text-purple-400 font-semibold">
                {t('signup.login')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-studiio-dark flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    }>
      <SignupContent />
    </Suspense>
  );
}
