'use client';

/**
 * CINEMA IA — ce que l'abonnement couvre encore, en une ligne discrete.
 *
 * Ne s'affiche que si le serveur dit que le film releve d'un abonnement (ou du cout reel
 * administrateur). Regime `credits` — le comportement actuel — : rien n'est rendu, l'ecran
 * reste exactement celui d'aujourd'hui. Le detail est replie derriere une icone (UX premium),
 * mais une LIMITE ATTEINTE n'est jamais cachee.
 */
import { useEffect, useState } from 'react';
import { Info, AlertTriangle } from 'lucide-react';

type Reponse =
  | { ok: true; regime: 'credits' }
  | { ok: true; regime: 'indisponible'; message: string }
  | { ok: true; regime: 'cout_reel'; devis: { totalUsd: number | null; imagesUsd: number | null; animationsUsd: number | null; dureeProjetS: number } }
  | {
    ok: true; regime: 'abonnement'; filmsUtilises: number; filmsInclus: number; dureeUtilisee: string; dureeIncluse: string;
    dureeProjet: string; dureeMaxFilmS: number; disponible: boolean; message: string | null; projetCouvert: boolean | null;
    partBudgetEngagee: number;
  };

const usd = (n: number | null) => (n === null ? 'tarif inconnu' : `${n.toFixed(2)} $`);

export default function QuotaCinema({ filmId, version }: { filmId: string | null; version: string }) {
  const [q, setQ] = useState<Reponse | null>(null);
  const [detail, setDetail] = useState(false);

  useEffect(() => {
    if (!filmId) { setQ(null); return; }
    let actif = true;
    fetch(`/api/cinema/films/${filmId}/quota`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (actif) setQ(d?.ok ? d : null); })
      .catch(() => { if (actif) setQ(null); });
    return () => { actif = false; };
  }, [filmId, version]);

  if (!q || q.regime === 'credits') return null;

  if (q.regime === 'indisponible') {
    return (
      <p role="status" className="mt-3 flex items-center gap-2 text-xs text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5" /> {q.message}
      </p>
    );
  }

  if (q.regime === 'cout_reel') {
    return (
      <p data-quota="admin" className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        Cout fournisseur reel · projet estime {usd(q.devis.totalUsd)}
        <button type="button" onClick={() => setDetail((v) => !v)} aria-label="Detail du devis" aria-expanded={detail} className="text-slate-500 hover:text-violet-300">
          <Info className="w-3.5 h-3.5" />
        </button>
        {detail && (
          <span className="text-slate-500">
            images manquantes {usd(q.devis.imagesUsd)} · animation de tous les plans {usd(q.devis.animationsUsd)} · aucun credit, aucune marge
          </span>
        )}
      </p>
    );
  }

  return (
    <div data-quota="abonnement" className="mt-3 text-xs">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400">
        <span>{q.filmsUtilises} / {q.filmsInclus} films</span>
        <span>{q.dureeUtilisee} / {q.dureeIncluse}</span>
        <span>projet ≈ {q.dureeProjet}</span>
        <span className={q.disponible ? 'text-emerald-300' : 'text-amber-300'}>{q.disponible ? 'Disponible' : 'Limite atteinte'}</span>
        <button type="button" onClick={() => setDetail((v) => !v)} aria-label="Detail du quota" aria-expanded={detail} className="text-slate-500 hover:text-violet-300">
          <Info className="w-3.5 h-3.5" />
        </button>
      </p>
      {!q.disponible && q.message && (
        <p role="status" className="mt-1 flex items-center gap-2 text-amber-300"><AlertTriangle className="w-3.5 h-3.5" /> {q.message}</p>
      )}
      {detail && (
        <p className="mt-1 text-slate-500">
          Inclus dans votre abonnement · duree max d’un film {Math.round(q.dureeMaxFilmS / 60)} min ·
          budget de generation utilise a {Math.round(q.partBudgetEngagee * 100)} %
          {q.projetCouvert === false ? ' · les images restantes de ce projet depassent le budget inclus' : ''}
          · aucun depassement payant : au-dela, la generation est refusee.
        </p>
      )}
    </div>
  );
}
