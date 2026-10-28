'use client';

/**
 * CINEMA IA — ce que l'abonnement couvre encore, et le BUDGET DU PROJET a confirmer.
 *
 * Ne s'affiche que si le serveur dit que le film releve d'un abonnement (ou du cout reel
 * administrateur). Regime `credits` — le comportement actuel — : rien n'est rendu. Aucune
 * generation payante n'est possible tant que le budget du projet n'est pas confirme ici :
 * le serveur le refuse. Le detail est replie derriere une icone ; une LIMITE ATTEINTE ou un
 * budget a confirmer ne sont jamais caches.
 */
import { useEffect, useState } from 'react';
import { Info, AlertTriangle, Check } from 'lucide-react';

type Perimetre = 'images' | 'complet';
interface DevisAdmin {
  scenes: number; plans: number; dureeProjetS: number; imagesManquantes: number; animationsPossibles: number;
  perimetres: Record<Perimetre, number | null>; dejaEngageUsd: number;
}
type Reponse =
  | { ok: true; regime: 'credits' }
  | { ok: true; regime: 'indisponible'; message: string }
  | { ok: true; regime: 'cout_reel'; devis: DevisAdmin; plafondFilmUsd: number; budgetApprouve: { usd: number; perimetre: Perimetre } | null }
  | {
    ok: true; regime: 'abonnement'; filmsUtilises: number; filmsInclus: number; dureeUtilisee: string; dureeIncluse: string;
    scenes: number; plans: number; dureeProjet: string; dureeMaxFilmS: number; disponible: boolean; message: string | null;
    partBudgetProjet: Record<Perimetre, number | null>; partBudgetEngagee: number;
    budgetApprouve: { perimetre: Perimetre } | null;
  };

const usd = (n: number | null) => (n === null ? 'tarif inconnu' : `${n.toFixed(2)} $`);
const pct = (n: number | null) => (n === null ? 'inconnu' : n >= 99 ? 'au-dela' : `${Math.round(n * 100)} %`);
const LIBELLE: Record<Perimetre, string> = { images: 'Images', complet: 'Images + animations' };

export default function QuotaCinema({ filmId, version }: { filmId: string | null; version: string }) {
  const [q, setQ] = useState<Reponse | null>(null);
  const [detail, setDetail] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [relire, setRelire] = useState(0);

  useEffect(() => {
    if (!filmId) { setQ(null); return; }
    let actif = true;
    fetch(`/api/cinema/films/${filmId}/quota`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (actif) setQ(d?.ok ? d : null); })
      .catch(() => { if (actif) setQ(null); });
    return () => { actif = false; };
  }, [filmId, version, relire]);

  const approuver = async (perimetre: Perimetre) => {
    if (!filmId) return;
    setEnvoi(true); setErreur(null);
    const r = await fetch(`/api/cinema/films/${filmId}/quota`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ perimetre }),
    }).then((x) => x.json()).catch(() => ({ ok: false, erreur: 'Confirmation impossible' }));
    setEnvoi(false);
    if (r.ok) setRelire((n) => n + 1); else setErreur(r.erreur ?? 'Confirmation impossible');
  };

  if (!q || q.regime === 'credits') return null;

  if (q.regime === 'indisponible') {
    return (
      <p role="status" className="mt-3 flex items-center gap-2 text-xs text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5" /> {q.message}
      </p>
    );
  }

  const approuve = q.budgetApprouve;
  const choix = (Object.keys(LIBELLE) as Perimetre[]).map((p) => {
    const montant = q.regime === 'cout_reel' ? usd(q.devis.perimetres[p]) : `${pct(q.partBudgetProjet[p])} du budget restant`;
    const impossible = q.regime === 'cout_reel' ? q.devis.perimetres[p] === null : q.partBudgetProjet[p] === null;
    return (
      <button key={p} type="button" disabled={envoi || impossible} onClick={() => approuver(p)}
        className="inline-flex items-center gap-1 rounded-md border border-violet-500/50 px-2 py-0.5 text-violet-200 hover:bg-violet-500/15 disabled:opacity-40">
        <Check className="w-3 h-3" /> {LIBELLE[p]} · {montant}
      </button>
    );
  });
  const budget = (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {approuve
        ? <span className="text-emerald-300">Budget du projet confirme ({LIBELLE[approuve.perimetre].toLowerCase()})</span>
        : <span className="text-amber-300">Confirmez le budget du projet avant toute generation :</span>}
      {!approuve && choix}
      {approuve && <span className="text-slate-500">· modifier :</span>}
      {approuve && choix}
    </div>
  );
  const message = erreur && <p role="alert" className="mt-1 text-amber-300">{erreur}</p>;

  if (q.regime === 'cout_reel') {
    return (
      <div data-quota="admin" className="mt-3 text-xs text-slate-400">
        <p className="flex flex-wrap items-center gap-2">
          Cout fournisseur reel · {q.devis.scenes} scenes · {q.devis.plans} plans · deja engage {usd(q.devis.dejaEngageUsd)}
          <button type="button" onClick={() => setDetail((v) => !v)} aria-label="Detail du devis" aria-expanded={detail} className="text-slate-500 hover:text-violet-300">
            <Info className="w-3.5 h-3.5" />
          </button>
        </p>
        {detail && (
          <p className="mt-1 text-slate-500">
            {q.devis.imagesManquantes} image(s) a generer · {q.devis.animationsPossibles} animation(s) possible(s) ·
            plafond par film {usd(q.plafondFilmUsd)} · aucun credit, aucune marge
          </p>
        )}
        {budget}
        {message}
      </div>
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
          {q.scenes} scenes · {q.plans} plans · duree max d’un film {Math.round(q.dureeMaxFilmS / 60)} min ·
          budget de generation utilise a {Math.round(q.partBudgetEngagee * 100)} % ·
          aucun depassement payant : au-dela, la generation est refusee.
        </p>
      )}
      {q.disponible && budget}
      {message}
    </div>
  );
}
