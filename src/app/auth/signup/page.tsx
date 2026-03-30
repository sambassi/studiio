'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Chrome, Facebook, Loader2 } from 'lucide-react';

export default function SignupPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

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
            <h1 className="text-3xl font-bold text-white mb-2">Inscription</h1>
            <p className="text-gray-400">Cr\u00e9ez votre compte Studiio gratuitement</p>
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
              <span className="text-studiio-primary cursor-pointer">Politique de confidentialit\u00e9</span>.
            </p>
          </div>

          <div className="text-center">
            <p className="text-gray-400">
              Vous avez d\u00e9j\u00e0 un compte ?{' '}
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
