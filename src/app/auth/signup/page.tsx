'use client';

import Link from 'next/link';
import { Chrome, Facebook } from 'lucide-react';

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-studiio-dark flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="card-base p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-white mb-2">Inscription</h1>
            <p className="text-gray-400">Créez votre compte Studiio gratuitement</p>
          </div>

          <div className="space-y-3">
            <button className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition">
              <Chrome size={20} />
              S&apos;inscrire avec Google
            </button>
            <button className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition">
              <Facebook size={20} />
              S&apos;inscrire avec Facebook
            </button>
            <button className="w-full flex items-center justify-center gap-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 rounded-lg transition">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.002 12.002 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              S&apos;inscrire avec GitHub
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

          <form className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Prénom</label>
              <input type="text" className="input-base w-full" placeholder="Jean" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Nom</label>
              <input type="text" className="input-base w-full" placeholder="Dupont" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Email</label>
              <input type="email" className="input-base w-full" placeholder="votre@email.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Mot de passe</label>
              <input type="password" className="input-base w-full" placeholder="••••••••" />
            </div>
            <button type="submit" className="w-full button-primary">
              S&apos;inscrire
            </button>
          </form>

          <div className="text-center text-sm text-gray-400">
            <p>En vous inscrivant, vous acceptez nos <span className="text-studiio-primary cursor-pointer">Conditions d&apos;utilisation</span> et notre <span className="text-studiio-primary cursor-pointer">Politique de confidentialité</span>.</p>
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
