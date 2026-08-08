'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Instagram, Music2, Facebook, Youtube, Loader2, Check, AlertTriangle, Link2, RefreshCw,
} from 'lucide-react';

/**
 * « Mes réseaux » — les comptes que l'UTILISATEUR connecte lui-même, via Zernio.
 *
 * ⚠️ À NE PAS CONFONDRE AVEC L'ÉCRAN EXISTANT. Celui-ci gère les comptes que
 * Studiio détient en propre (`social_accounts`, OAuth direct) — c'est le
 * chemin historique de l'administrateur, et il reste intact. Cette section-ci
 * gère les comptes de l'utilisateur, publiés en marque blanche.
 *
 * ⚠️ AUCUNE CLÉ ICI. La clé Zernio ne quitte jamais le serveur : le composant
 * demande une URL d'autorisation à notre route, puis redirige le navigateur.
 */

const PLATEFORMES = [
  { id: 'instagram', label: 'Instagram', Icone: Instagram },
  { id: 'tiktok', label: 'TikTok', Icone: Music2 },
  { id: 'facebook', label: 'Facebook', Icone: Facebook },
  { id: 'youtube', label: 'YouTube', Icone: Youtube },
] as const;

interface CompteConnecte {
  accountId: string;
  platform: string;
  username: string | null;
  status: string;
}

export default function MesReseaux() {
  const [chargement, setChargement] = useState(true);
  const [autorise, setAutorise] = useState(false);
  const [raison, setRaison] = useState<string | null>(null);
  const [comptes, setComptes] = useState<CompteConnecte[]>([]);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    fetch('/api/social/zernio/accounts')
      .then((r) => r.json())
      .then((d) => {
        if (!d?.success) return;
        setAutorise(!!d.autorise);
        setRaison(d.raison ?? null);
        setComptes(Array.isArray(d.comptes) ? d.comptes : []);
      })
      // Silencieux : cette section est un ajout. Son indisponibilité ne doit
      // pas casser l'écran des réseaux, qui a sa propre raison d'être.
      .catch(() => {})
      .finally(() => setChargement(false));
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const connecter = useCallback(async (platform: string) => {
    setEnCours(platform);
    setErreur(null);
    try {
      const res = await fetch('/api/social/zernio/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform }),
      });
      const d = await res.json();
      if (!res.ok || !d?.authUrl) {
        // ⚠️ ON SURFACE LE MESSAGE DU SERVEUR. « Activez l'option » et « le
        // service est coupé » n'appellent pas la même action de la part de
        // l'utilisateur : les confondre en « erreur » le laisserait sans
        // recours.
        setErreur(d?.error || 'Connexion impossible.');
        setEnCours(null);
        return;
      }
      window.location.href = d.authUrl;
    } catch {
      setErreur('Connexion impossible.');
      setEnCours(null);
    }
  }, []);

  if (chargement) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-3" data-mes-reseaux>
      <div>
        <h3 className="text-sm font-semibold text-white">Mes réseaux (publication)</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          Connectez vos propres comptes pour publier vos montages dessus.
        </p>
      </div>

      {!autorise && (
        <p className="flex items-start gap-1.5 text-xs text-amber-400" data-mes-reseaux-refus>
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {raison === 'coupe-circuit'
            ? 'La publication sur les réseaux est momentanément désactivée.'
            : raison === 'zernio-absent'
              ? 'La publication sur les réseaux n’est pas configurée sur ce serveur.'
              : 'Activez l’option Publication pour publier sur vos réseaux.'}
        </p>
      )}

      {erreur && (
        <p className="flex items-start gap-1.5 text-xs text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {erreur}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {PLATEFORMES.map(({ id, label, Icone }) => {
          const compte = comptes.find((c) => c.platform === id);
          const deconnecte = compte?.status === 'disconnected';
          return (
            <button
              key={id}
              type="button"
              onClick={() => connecter(id)}
              disabled={!autorise || enCours !== null || (!!compte && !deconnecte)}
              data-zernio-connect={id}
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition disabled:opacity-50 disabled:cursor-not-allowed ${
                compte && !deconnecte
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-gray-800 hover:border-gray-700'
              }`}
            >
              <Icone className="w-4 h-4 mt-0.5 shrink-0 text-gray-300" />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-gray-100">{label}</span>
                {enCours === id ? (
                  <span className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
                    <Loader2 className="w-3 h-3 animate-spin" /> Redirection…
                  </span>
                ) : compte && !deconnecte ? (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 mt-0.5">
                    <Check className="w-3 h-3" />
                    {compte.username ? `@${compte.username}` : 'Connecté'}
                  </span>
                ) : deconnecte ? (
                  // ⚠️ « Reconnecter » ET NON « Connecter » : le compte existe,
                  // c'est son autorisation qui a expiré. Le mot dit quoi faire.
                  <span className="flex items-center gap-1 text-[11px] text-amber-400 mt-0.5">
                    <RefreshCw className="w-3 h-3" /> Reconnecter
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] text-gray-500 mt-0.5">
                    <Link2 className="w-3 h-3" /> Connecter
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
