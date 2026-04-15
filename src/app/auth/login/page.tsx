'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Chrome, Facebook, Loader2 } from 'lucide-react';
import { useTranslations } from '@/i18n/client';

export default function LoginPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  const t = useTranslations('auth');

  const handleOAuthSignIn = (provider: string) => {
    setLoading(provider);
    setError('');
    signIn(provider, { callbackUrl: '/dashboard' });
  };

  return (
    <div className="min-h-screen bg-studiio-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="card-base p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">{t('login.title')}</h1>
            <p className="text-gray-400">{t('login.subtitle')}</p>
          </div>

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
              {t('login.google')}
            </button>
            <button
              onClick={() => handleOAuthSignIn('facebook')}
              disabled={!!loading}
              className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {loading === 'facebook' ? <Loader2 size={20} className="animate-spin" /> : <Facebook size={20} />}
              {t('login.facebook')}
            </button>
          </div>

          <div className="text-center">
            <p className="text-gray-400">
              {t('login.noAccount')}{' '}
              <Link href="/auth/signup" className="text-studiio-primary hover:text-purple-400 font-semibold">
                {t('login.signup')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
