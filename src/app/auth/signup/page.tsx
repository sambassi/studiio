'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Chrome, Facebook, Loader2, Check, Zap } from 'lucide-react';

function SignupContent() {
  const searchParams = useSearchParams();
  const planParam = searchParams.get('plan');
  const billingParam = searchParams.get('billing') || 'monthly';
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<any>(null);

  // Fetch CMS plans to display the selected plan info
  useEffect(() => {
    if (!planParam) return;
    fetch('/api/admin/landing')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.content?.plans) {
          const found = data.content.plans.find((p: any) =>
            p.name.toLowerCase().replace(/\s+/g, '-') === planParam
          );
          if (found) setSelectedPlan(found);
        }
      })
      .catch(() => {});
  }, [planParam]);

  const handleOAuthSignIn = (provider: string) => {
    setLoading(provider);
    setError('');
    // Pass plan info to callback so it can be stored after signup
    const callbackUrl = planParam
      ? `/dashboard?plan=${planParam}&billing=${billingParam}`
      : '/dashboard';
    signIn(provider, { callbackUrl });
  };

  return (
    <div className="min-h-screen bg-studiio-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="card-base p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Inscription</h1>
            <p className="text-gray-400">Créez votre compte Studiio gratuitement</p>
          </div>

          {/* Show selected plan if any */}
          {selectedPlan && (
            <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={16} className="text-violet-400" />
                <span className="text-sm font-bold text-violet-300">Plan sélectionné</span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">{selectedPlan.name}</h3>
                  <p className="text-xs text-gray-400">{selectedPlan.credits?.toLocaleString()} crédits/mois</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-white">
                    {billingParam === 'yearly' ? selectedPlan.yearlyPrice : selectedPlan.price}€
                  </span>
                  <span className="text-gray-500 text-xs">/mois</span>
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
                    <li className="text-xs text-gray-500">+ {selectedPlan.features.length - 4} autres avantages</li>
                  )}
                </ul>
              )}
            </div>
          )}

          {!selectedPlan && planParam && (
            <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-4 text-center">
              <Zap size={16} className="text-violet-400 mx-auto mb-1" />
              <p className="text-sm text-violet-300 font-medium">Plan {planParam} sélectionné</p>
              <p className="text-xs text-gray-400 mt-1">Vous pourrez finaliser votre abonnement après inscription</p>
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
              S&apos;inscrire avec Google
            </button>
            <button
              onClick={() => handleOAuthSignIn('facebook')}
              disabled={!!loading}
              className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {loading === 'facebook' ? <Loader2 size={20} className="animate-spin" /> : <Facebook size={20} />}
              S&apos;inscrire avec Facebook
            </button>
          </div>

          <div className="text-center text-sm text-gray-400">
            <p>
              En vous inscrivant, vous acceptez nos{' '}
              <span className="text-studiio-primary cursor-pointer">Conditions d&apos;utilisation</span>{' '}
              et notre{' '}
              <span className="text-studiio-primary cursor-pointer">Politique de confidentialité</span>.
            </p>
          </div>

          <div className="text-center">
            <p className="text-gray-400">
              Vous avez déjà un compte ?{' '}
              <Link href="/auth/login" className="text-studiio-primary hover:text-purple-400 font-semibold">
                Se connecter
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
