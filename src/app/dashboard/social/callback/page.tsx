'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Check, AlertTriangle } from 'lucide-react';

/**
 * Retour de connexion d'un réseau, via Zernio.
 *
 * ⚠️ CETTE PAGE ENREGISTRE LE COMPTE, elle ne fait pas qu'afficher un message.
 * Le retour porte déjà `accountId`, `platform` et `username` en paramètres
 * d'URL : s'en remettre au seul webhook laisserait l'utilisateur devant une
 * liste vide pendant plusieurs secondes — ou indéfiniment si le webhook n'est
 * pas encore configuré côté Zernio.
 *
 * ⚠️ LE `profileId` DE L'URL EST IGNORÉ. Il est sous le contrôle du
 * navigateur ; le serveur relit le sien. C'est ce qui empêche de rattacher un
 * compte au profil de quelqu'un d'autre.
 */

function Retour() {
  const router = useRouter();
  const params = useSearchParams();
  const [etat, setEtat] = useState<'en-cours' | 'ok' | 'echec'>('en-cours');
  const [message, setMessage] = useState('Connexion en cours…');

  useEffect(() => {
    const platform = params?.get('connected');
    const accountId = params?.get('accountId');
    const username = params?.get('username');

    if (!platform || !accountId) {
      setEtat('echec');
      setMessage(params?.get('error') || 'La connexion n’a pas abouti.');
      return;
    }
    fetch('/api/social/zernio/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, accountId, username }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.success) {
          setEtat('ok');
          setMessage(`Compte ${platform} connecté.`);
          setTimeout(() => router.push('/dashboard/social'), 1200);
        } else {
          setEtat('echec');
          setMessage(d?.error || 'Compte non enregistré.');
        }
      })
      .catch(() => {
        setEtat('echec');
        setMessage('Compte non enregistré.');
      });
  }, [params, router]);

  return (
    <div className="max-w-md mx-auto mt-24 rounded-xl border border-gray-800 bg-gray-900/60 p-6 text-center">
      <div className="flex justify-center mb-3">
        {etat === 'en-cours' && <Loader2 className="w-6 h-6 animate-spin text-purple-300" />}
        {etat === 'ok' && <Check className="w-6 h-6 text-emerald-400" />}
        {etat === 'echec' && <AlertTriangle className="w-6 h-6 text-amber-400" />}
      </div>
      <p className="text-sm text-gray-200">{message}</p>
      {etat === 'echec' && (
        <button
          type="button"
          onClick={() => router.push('/dashboard/social')}
          className="mt-4 rounded-lg border border-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:text-white transition-colors"
        >
          Retour aux réseaux
        </button>
      )}
    </div>
  );
}

export default function CallbackPage() {
  // `useSearchParams` exige une frontiere Suspense au pre-rendu.
  return (
    <Suspense fallback={<div className="mt-24 text-center text-sm text-gray-400">Chargement…</div>}>
      <Retour />
    </Suspense>
  );
}
