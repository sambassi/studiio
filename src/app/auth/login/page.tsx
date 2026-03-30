'use client';

import { useState } from 'react';
import Link from 'next/link';
import { signIn } from 'next-auth/react';
import { Chrome, Facebook, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleOAuthSignIn = (provider: string) => {
    setLoading(provider);
    setError('');
    signIn(provider, { callbackUrl: '/dashboard' });
  };

  const handleEmailLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading('email');
    setError('');
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    if (!email || !password) {
      setError('Veuillez remplir tous les champs.');
      setLoading(null);
      return;
    }

    try {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        setError('Email ou mot de passe incorrect.');
      } else {
        window.location.href = '/dashboard';
      }
    } catch {
      setError('Erreur de connexion. Veuillez réessayer.');
    }
    setLoading(null);
  };

  return (
    <div className="min-h-screen bg-studiio-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="card-base p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Connexion</h1>
            <p className="text-gray-400">Connectez-vous à votre compte Studiio</p>
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
              Continuer avec Google
            </button>
            <button
              onClick={() => handleOAuthSignIn('facebook')}
              disabled={!!loading}
              className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {loading === 'facebook' ? <Loader2 size={20} className="animate-spin" /> : <Facebook size={20} />}
              Continuer avec Facebook
            </button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-700"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-gray-900 text-gray-500">Ou</span>
            </div>
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
              <input
                type="email"
                name="email"
                className="input-base w-full"
                placeholder="votre@email.com"
                disabled={!!loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Mot de passe</label>
              <input
                type="password"
                name="password"
                className="input-base w-full"
                placeholder="••••••••"
                disabled={!!loading}
              />
            </div>
            <button
              type="submit"
              disabled={!!loading}
              className="w-full button-primary disabled:opacity-50"
            >
              {loading === 'email' ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>

          <div className="text-center">
            <p className="text-gray-400">
              Pas encore de compte ?{' '}
              <Link href="/auth/signup" className="text-studiio-primary hover:text-purple-400 font-semibold">
                S&apos;inscrire
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
