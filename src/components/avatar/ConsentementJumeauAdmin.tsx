'use client';

/**
 * Consentement filmé du jumeau VIDÉO — niveau 1, ADMIN UNIQUEMENT (temporaire).
 *
 * Rendu seulement quand le serveur dit `jumeauVideoActif` (compte admin). Le
 * bouton demande au serveur le lien de la page d'enregistrement externe, l'ouvre
 * dans un nouvel onglet, puis le statut est suivi automatiquement. Un
 * utilisateur normal ne voit jamais ce bloc ni aucun lien externe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';

type Statut = 'pending' | 'accepted' | 'rejected' | null;

const LIBELLES: Record<Exclude<Statut, null> | 'aucun', string> = {
  aucun: 'Votre avatar vidéo doit être accompagné de votre consentement filmé avant de pouvoir parler.',
  pending: 'Consentement en cours de vérification… (quelques minutes après l’enregistrement)',
  accepted: 'Consentement accepté : votre avatar vidéo peut être utilisé.',
  rejected: 'Consentement refusé : enregistrez-le de nouveau (même personne, visage visible, phrase lue clairement).',
};

export default function ConsentementJumeauAdmin({ statutInitial, onAccepte }: { statutInitial: Statut; onAccepte: () => void }) {
  const [statut, setStatut] = useState<Statut>(statutInitial);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const minuteur = useRef<ReturnType<typeof setInterval> | null>(null);

  const verifier = useCallback(async () => {
    try {
      const j = await fetch('/api/avatar/consentement').then((r) => r.json());
      if (j?.success) {
        setStatut(j.data.statut ?? null);
        if (j.data.statut === 'accepted') onAccepte();
      }
    } catch { /* nouvel essai au prochain passage */ }
  }, [onAccepte]);

  // Suivi automatique tant que la vérification est en cours.
  useEffect(() => {
    if (statut !== 'pending') return;
    minuteur.current = setInterval(verifier, 15_000);
    return () => { if (minuteur.current) clearInterval(minuteur.current); };
  }, [statut, verifier]);

  const enregistrer = async () => {
    setEnvoi(true);
    setErreur(null);
    // Onglet ouvert DANS le geste de l'utilisateur (sinon bloqué), adressé ensuite.
    const onglet = window.open('', '_blank');
    try {
      const j = await fetch('/api/avatar/consentement', { method: 'POST' }).then((r) => r.json());
      if (!j?.success) { onglet?.close(); setErreur(j?.error || 'Le consentement n’a pas pu être lancé.'); return; }
      setStatut(j.data.statut ?? 'pending');
      if (j.data.url) {
        if (onglet) onglet.location.href = j.data.url; else window.location.href = j.data.url;
      } else onglet?.close();
    } catch {
      onglet?.close();
      setErreur('Le consentement n’a pas pu être lancé.');
    } finally {
      setEnvoi(false);
    }
  };

  if (statut === 'accepted') {
    return <div data-jumeau-consentement="accepted" className="text-xs text-emerald-300 flex items-center gap-2"><ShieldCheck className="w-4 h-4" />{LIBELLES.accepted}</div>;
  }
  return (
    <div data-jumeau-consentement={statut ?? 'aucun'} className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3 text-sm">
      <p className="text-amber-200">{LIBELLES[statut ?? 'aucun']}</p>
      <p className="text-xs text-gray-400">Accès administrateur — test interne. Une page externe s’ouvre pour enregistrer votre déclaration à la webcam (lien valable 24 h).</p>
      <div className="flex gap-3">
        <button onClick={enregistrer} disabled={envoi} className="rounded-lg bg-amber-500/20 px-3 py-2 text-xs text-amber-100 hover:bg-amber-500/30 disabled:opacity-50 flex items-center gap-2">
          {envoi && <Loader2 className="w-3.5 h-3.5 animate-spin" />}Enregistrer mon consentement
        </button>
        {statut === 'pending' && (
          <button onClick={verifier} className="text-xs text-gray-400 hover:text-white">Vérifier maintenant</button>
        )}
      </div>
      {erreur && <p className="text-xs text-red-300">{erreur}</p>}
    </div>
  );
}
