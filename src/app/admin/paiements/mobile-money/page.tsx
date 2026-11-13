'use client';

/**
 * ADMINISTRATION — PAIEMENT MOBILE MONEY.
 *
 * ⚠️ AUCUNE CLÉ N'ARRIVE ICI. La route d'administration ne dit que la
 * PRÉSENCE d'un jeton, jamais sa valeur ni ses derniers caractères : rien à
 * afficher, donc rien à laisser fuir dans une capture d'écran.
 *
 * Les pays affichés viennent du compte marchand, pas d'une liste codée.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import { BandeauDemo } from '@/components/ui/BandeauDemo';

interface Depot {
  deposit_id: string; user_id: string; offre_type: string; offre_cle: string;
  credits: number; montant_local: number; devise: string; pays: string;
  prix_chf_cents: number; statut: string; motif_echec: string | null;
  credite_le: string | null; sandbox: boolean; created_at: string;
}
interface Etat {
  actif: boolean; motif: string | null; message: string | null;
  sandbox: boolean; simule: boolean; jetonPresent: boolean; rappelConfigure: boolean;
  variablesAttendues: string[];
  paysDisponibles: Array<{ pays: string; devise: string }>;
  paysMotif: string | null;
  socleApplique: boolean;
  depots: Depot[];
  change: { eurParChf: number; le: string } | null;
}

const STYLE_STATUT: Record<string, string> = {
  reussi: 'border-green-500/40 bg-green-500/10 text-green-300',
  en_attente: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  echoue: 'border-red-500/40 bg-red-500/10 text-red-300',
  expire: 'border-red-500/40 bg-red-500/10 text-red-300',
  annule: 'border-gray-600 bg-gray-700/30 text-gray-300',
};

const LIBELLE_STATUT: Record<string, string> = {
  reussi: 'Crédité', en_attente: 'En attente', echoue: 'Échoué', expire: 'Expiré', annule: 'Annulé',
};

export default function MobileMoneyAdminPage() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState(false);
  const [bilan, setBilan] = useState<string | null>(null);

  const charger = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/paiements/mobile-money', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j?.success) { setErreur(j?.error ?? 'Lecture impossible.'); return; }
      setEtat(j as Etat);
      setErreur(null);
    } catch { setErreur('Lecture impossible.'); }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const lancerReconciliation = async () => {
    setReconciliation(true);
    setBilan(null);
    try {
      const r = await fetch('/api/admin/paiements/mobile-money/reconciliation', { method: 'POST' });
      const j = await r.json();
      if (!r.ok || !j?.success) { setBilan(j?.error ?? 'Réconciliation impossible.'); return; }
      const b = j.bilan as Record<string, number> & { rattrapage?: Record<string, number> };
      const seconde = b.rattrapage;
      setBilan(
        `${b.examines} dépôt(s) relu(s) · ${b.credites} crédité(s) · ${b.echoues} échoué(s) · `
        + `${b.refuses} refusé(s) · ${b.abandonnes} fermé(s) sans réponse · `
        + `${b.encoreEnAttente} encore en attente · ${b.erreurs} erreur(s)`
        + (seconde ? ` — seconde chance : ${seconde.examines} relu(s), ${seconde.credites} crédité(s)` : ''),
      );
      await charger();
    } finally { setReconciliation(false); }
  };

  if (erreur && !etat) return <div className="flex items-center gap-2 p-6 text-red-400"><AlertTriangle size={20} /> {erreur}</div>;
  if (!etat) return <div className="p-6"><Loader2 className="animate-spin text-studiio-primary" size={28} /></div>;

  const enAttente = etat.depots.filter((d) => d.statut === 'en_attente').length;
  const echoues = etat.depots.filter((d) => ['echoue', 'expire'].includes(d.statut)).length;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 pb-6">
      <BandeauDemo />

      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white md:text-3xl">
          <Smartphone className="text-studiio-primary" size={26} /> Paiement Mobile Money
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Moyen de paiement complémentaire à la carte. Les crédits ne sont ajoutés qu’après
          confirmation vérifiée auprès du prestataire, une seule fois par paiement.
        </p>
      </div>

      {/* ── État du service ─────────────────────────────────────────────── */}
      <section className="card-base space-y-3" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full border px-2 py-0.5 ${etat.actif ? STYLE_STATUT.reussi : STYLE_STATUT.echoue}`}>
            {etat.actif ? 'Service ouvert' : 'Service fermé'}
          </span>
          <span className={`rounded-full border px-2 py-0.5 ${etat.sandbox ? STYLE_STATUT.en_attente : STYLE_STATUT.reussi}`}>
            {etat.sandbox ? 'Bac à sable' : 'Production'}
          </span>
          {etat.simule && (
            <span className={`rounded-full border px-2 py-0.5 ${STYLE_STATUT.en_attente}`}>Prestataire simulé</span>
          )}
          <span className={`rounded-full border px-2 py-0.5 ${etat.jetonPresent ? STYLE_STATUT.reussi : STYLE_STATUT.echoue}`}>
            Jeton {etat.jetonPresent ? 'présent' : 'absent'}
          </span>
          <span className={`rounded-full border px-2 py-0.5 ${etat.rappelConfigure ? STYLE_STATUT.reussi : STYLE_STATUT.echoue}`}>
            Adresse de notification {etat.rappelConfigure ? 'configurée' : 'absente'}
          </span>
        </div>

        {!etat.actif && etat.message && <p className="text-xs text-amber-400">{etat.message}</p>}

        {!etat.socleApplique && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300" data-testid="socle-absent">
            Migration <code>2026-11-13-mobile-money.sql</code> non appliquée : aucun paiement mobile
            ne peut être ouvert ni crédité sur ce serveur.
          </p>
        )}

        <p className="text-xs text-gray-500">
          {etat.change
            ? `Taux de conversion : 1 CHF = ${etat.change.eurParChf} EUR (${etat.change.le}), × 655,957 pour le franc CFA.`
            : 'Aucun taux CHF → EUR enregistré : aucun montant en franc CFA n’est affichable.'}
        </p>

        <div className="text-xs text-gray-400">
          <span className="text-gray-500">Pays ouverts sur le compte marchand : </span>
          {etat.paysDisponibles.length > 0
            ? etat.paysDisponibles.map((p) => `${p.pays} (${p.devise})`).join(' · ')
            : (etat.paysMotif ?? 'aucun')}
        </div>

        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer select-none">Variables attendues côté serveur</summary>
          <p className="mt-1">
            {etat.variablesAttendues.join(' · ')} — leurs VALEURS ne sont jamais affichées ici.
          </p>
        </details>
      </section>

      {/* ── Réconciliation ──────────────────────────────────────────────── */}
      <section className="card-base space-y-2" style={{ padding: 16 }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-white">Réconciliation</p>
            <p className="text-xs text-gray-400">
              Relit chaque paiement en attente auprès du prestataire et crédite ceux qui sont
              confirmés. C’est ce filet qui rend le crédit indépendant de la notification.
              Les paiements relus passent en fin de file ; ceux dont le prestataire confirme
              qu’ils sont encore en attente au-delà de 24 h sont fermés, sans jamais être
              fermés sur leur seul âge. Une seconde passe rouvre les paiements fermés mais
              non crédités, au cas où la confirmation arriverait plus tard.
            </p>
          </div>
          <button
            type="button"
            onClick={lancerReconciliation}
            disabled={reconciliation}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-white/5 disabled:opacity-50"
          >
            {reconciliation ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Lancer
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full border px-2 py-0.5 ${STYLE_STATUT.en_attente}`}>{enAttente} en attente</span>
          <span className={`rounded-full border px-2 py-0.5 ${STYLE_STATUT.echoue}`}>{echoues} échoué(s)</span>
        </div>
        {bilan && <p className="text-xs text-gray-300" data-testid="bilan-reconciliation">{bilan}</p>}
      </section>

      {/* ── Transactions ────────────────────────────────────────────────── */}
      <section className="card-base" style={{ padding: 16 }}>
        <p className="mb-2 text-sm font-semibold text-white">
          Transactions Mobile Money <span className="text-xs font-normal text-gray-500">(carte : écran Paiements)</span>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-400">
                <th className="p-2">Date</th><th className="p-2">Offre</th><th className="p-2">Pays</th>
                <th className="p-2">Montant</th><th className="p-2">Prix CHF</th>
                <th className="p-2">Crédits</th><th className="p-2">État</th>
              </tr>
            </thead>
            <tbody>
              {etat.depots.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-center text-gray-500">Aucun paiement mobile enregistré.</td></tr>
              )}
              {etat.depots.map((d) => (
                <tr key={d.deposit_id} className="border-t border-gray-800" data-testid={`depot-${d.deposit_id}`}>
                  <td className="p-2 whitespace-nowrap">{new Date(d.created_at).toLocaleString('fr-CH')}</td>
                  <td className="p-2">{d.offre_type === 'plan' ? 'Abonnement' : 'Recharge'} {d.offre_cle}</td>
                  <td className="p-2">{d.pays}</td>
                  <td className="p-2 whitespace-nowrap">{Number(d.montant_local).toLocaleString('fr-CH')} {d.devise}</td>
                  <td className="p-2 whitespace-nowrap">{(d.prix_chf_cents / 100).toFixed(2)} CHF</td>
                  <td className="p-2">{d.credits}</td>
                  <td className="p-2">
                    <span className={`rounded-full border px-2 py-0.5 ${STYLE_STATUT[d.statut] ?? ''}`}>
                      {LIBELLE_STATUT[d.statut] ?? d.statut}
                    </span>
                    {d.motif_echec && <span className="ml-1 text-gray-500">{d.motif_echec}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Les frais du prestataire sont prélevés sur l’encaissement marchand : ils ne sont pas
          ajoutés au montant payé, et ne sont pas encore importés dans le calcul des marges.
        </p>
      </section>
    </div>
  );
}
