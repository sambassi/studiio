'use client';

import Link from 'next/link';
import { ArrowRight, Music } from 'lucide-react';

export default function AudioStudioLegacyRedirect() {
  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-gradient-to-br from-purple-600 to-pink-500 flex items-center justify-center">
          <Music className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold mb-3">Le Studio Son a été intégré</h1>
        <p className="text-gray-400 mb-6 leading-relaxed">
          Pour ajouter de la musique et une voix à vos vidéos, rendez-vous
          sur la page <span className="text-white font-semibold">Créer</span>,
          onglet <span className="text-white font-semibold">Audio</span>.
        </p>
        <Link
          href="/dashboard/creer"
          className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 font-bold transition"
        >
          Aller sur Créer
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
