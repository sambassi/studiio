'use client';

/**
 * PAGE DE PAIEMENT SIMULÉE — prévisualisation uniquement.
 *
 * Elle tient la place de la page hébergée du prestataire et permet de
 * choisir l'issue. Hors simulation, `/api/paiements/mobile-money/simulation`
 * répond 404 : les boutons ci-dessous n'ont alors aucun effet, et aucun
 * crédit ne peut être forcé.
 *
 * ⚠️ MÊME ICI, RIEN N'EST CRÉDITÉ PAR CETTE PAGE. Choisir « réussi » ne fait
 * que poser, en mémoire du serveur, ce que le double répondra à la prochaine
 * relecture. Le crédit passe par la même vérification que la production.
 */
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FlaskConical, Loader2 } from 'lucide-react';

type Issue = 'reussi' | 'echoue' | 'expire' | 'annule';

const CHOIX: Array<{ issue: Issue; libelle: string; detail: string; classe: string; montant?: number; retard?: number }> = [
  { issue: 'reussi', libelle: 'Paiement réussi', detail: 'Montant exact — les crédits seront ajoutés une seule fois.', classe: 'border-green-500/40 text-green-300 hover:bg-green-500/10' },
  { issue: 'reussi', libelle: 'Réussi, mais confirmé en retard', detail: 'Deux relectures répondront « en attente » avant la confirmation.', classe: 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10', retard: 2 },
  { issue: 'reussi', libelle: 'Réussi, montant insuffisant', detail: 'Le prestataire annonce moins que le montant attendu : aucun crédit.', classe: 'border-amber-500/40 text-amber-300 hover:bg-amber-500/10', montant: 1 },
  { issue: 'echoue', libelle: 'Paiement échoué', detail: 'Fonds insuffisants côté payeur.', classe: 'border-red-500/40 text-red-300 hover:bg-red-500/10' },
  { issue: 'expire', libelle: 'Paiement expiré', detail: 'Le payeur n’a pas validé à temps.', classe: 'border-red-500/40 text-red-300 hover:bg-red-500/10' },
  { issue: 'annule', libelle: 'Paiement annulé', detail: 'Le payeur a renoncé.', classe: 'border-red-500/40 text-red-300 hover:bg-red-500/10' },
];

function Contenu() {
  const depot = useSearchParams().get('depot') ?? '';
  const router = useRouter();
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const choisir = async (c: (typeof CHOIX)[number], index: number) => {
    setEnvoi(String(index));
    setErreur(null);
    try {
      const r = await fetch('/api/paiements/mobile-money/simulation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ depot, issue: c.issue, montant: c.montant, retard: c.retard }),
      });
      if (!r.ok) {
        setErreur(r.status === 404
          ? 'La simulation est désactivée sur ce serveur.'
          : 'L’issue n’a pas pu être posée.');
        return;
      }
      router.push(`/paiement/mobile-money/retour?depot=${encodeURIComponent(depot)}`);
    } catch {
      setErreur('L’issue n’a pas pu être posée.');
    } finally {
      setEnvoi(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <div className="card-base space-y-4" style={{ padding: 20 }}>
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
          <FlaskConical size={18} className="mt-0.5 shrink-0 text-amber-300" />
          <div>
            <p className="text-sm font-semibold text-amber-200">Page de paiement simulée</p>
            <p className="mt-0.5 text-xs text-amber-200/80">
              Aucun paiement réel. Cette page remplace celle du prestataire pour éprouver chaque issue.
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-300">Que doit répondre le prestataire pour ce paiement ?</p>

        <div className="space-y-2">
          {CHOIX.map((c, i) => (
            <button
              key={`${c.issue}-${i}`}
              type="button"
              onClick={() => choisir(c, i)}
              disabled={envoi !== null}
              className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left disabled:opacity-50 ${c.classe}`}
            >
              {envoi === String(i) && <Loader2 size={14} className="mt-0.5 animate-spin" />}
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{c.libelle}</span>
                <span className="block text-xs text-gray-400">{c.detail}</span>
              </span>
            </button>
          ))}
        </div>

        {erreur && <p className="text-sm text-red-300" role="alert">{erreur}</p>}
        <p className="text-xs text-gray-500">Référence du dépôt : {depot || '—'}</p>
      </div>
    </div>
  );
}

export default function SimulationMobileMoney() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-400">Chargement…</div>}>
      <Contenu />
    </Suspense>
  );
}
