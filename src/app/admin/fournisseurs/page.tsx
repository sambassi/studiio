'use client';

/**
 * Admin › Fournisseurs — le financement de Studiio chez ses fournisseurs.
 *
 * Lecture seule côté argent : Studiio ne déclenche AUCUN paiement. Les
 * recharges se règlent chez le fournisseur (auto-reload) ; on affiche ici ce
 * qui a été constaté, les seuils d'alerte et l'économie mesurée.
 * Aucune clé API n'est lue ni affichée (l'API n'en renvoie pas).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertCircle, AlertTriangle, Info, RefreshCw, Settings, BarChart3, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import type { ConfigFournisseur, EtatFournisseur, StatutFournisseur } from '@/lib/fournisseurs/sante';
import type { MoisEconomie } from '@/lib/fournisseurs/economie';

interface Alerte {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  details?: unknown;
  timestamp: string;
  dismissed?: boolean;
}

interface Fournisseur {
  id: string;
  nom: string;
  capacites: { soldeApi: boolean; unite: string; rechargeOfficielle: string };
  config: ConfigFournisseur;
  etat: EtatFournisseur;
  alertes: Alerte[];
}

interface Donnees {
  fournisseurs: Fournisseur[];
  generationsEnAttente: number;
  economie: MoisEconomie[] | { erreur: string };
}

const STATUTS: Record<StatutFournisseur, { label: string; couleur: string }> = {
  operationnel: { label: 'opérationnel', couleur: '#22c55e' },
  faible: { label: 'faible', couleur: '#f59e0b' },
  critique: { label: 'critique', couleur: '#f97316' },
  bloque: { label: 'bloqué', couleur: '#ef4444' },
  inconnu: { label: 'inconnu', couleur: '#6b7280' },
};

const SEVERITES: Record<Alerte['severity'], { couleur: string; Icone: typeof Info }> = {
  info: { couleur: '#60a5fa', Icone: Info },
  warning: { couleur: '#f59e0b', Icone: AlertTriangle },
  critical: { couleur: '#ef4444', Icone: AlertCircle },
};

/** Fournisseurs dont la consommation détaillée vit dans Admin › Coûts avatar. */
const AVEC_PAGE_COUTS = new Set(['heygen', 'did']);

const eur = (n: number | null | undefined) => (typeof n === 'number' ? `${n.toFixed(2)} €` : 'non mesuré');
const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('fr-FR') : '—');

const CHAMPS: Array<{ cle: keyof ConfigFournisseur; label: string; type: 'nombre' | 'booleen' }> = [
  { cle: 'seuilBas', label: 'Seuil bas', type: 'nombre' },
  { cle: 'seuilCritique', label: 'Seuil critique', type: 'nombre' },
  { cle: 'autoRechargeAttendue', label: 'Recharge auto activée chez le fournisseur', type: 'booleen' },
  { cle: 'montantRecharge', label: 'Montant d’une recharge', type: 'nombre' },
  { cle: 'maxRechargesJour', label: 'Recharges max / jour', type: 'nombre' },
  { cle: 'maxRechargesMois', label: 'Recharges max / mois', type: 'nombre' },
];

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-gray-400 text-xs">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function FormulaireConfig({ f, onFini }: { f: Fournisseur; onFini: () => void }) {
  const [valeurs, setValeurs] = useState<ConfigFournisseur>(f.config);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch('/api/admin/fournisseurs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fournisseur: f.id, config: valeurs }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Enregistrement impossible');
      onFini();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Enregistrement impossible');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <form onSubmit={soumettre} className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-gray-800 pt-4" aria-label={`Configurer ${f.nom}`}>
      {CHAMPS.map(({ cle, label, type }) => (
        <label key={cle} className="text-xs text-gray-300 flex flex-col gap-1">
          {type === 'booleen' ? (
            <span className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={Boolean(valeurs[cle])}
                onChange={(e) => setValeurs((v) => ({ ...v, [cle]: e.target.checked }))}
              />
              {label}
            </span>
          ) : (
            <>
              {label}
              <input
                type="number"
                min={0}
                step="any"
                value={String(valeurs[cle])}
                onChange={(e) => setValeurs((v) => ({ ...v, [cle]: Number(e.target.value) }))}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-white"
              />
            </>
          )}
        </label>
      ))}
      <div className="md:col-span-3 flex items-center gap-3">
        <button type="submit" disabled={envoi} className="px-3 py-1.5 rounded bg-orange-500 text-white text-sm disabled:opacity-50">
          {envoi ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button type="button" onClick={onFini} className="px-3 py-1.5 rounded border border-gray-700 text-sm text-gray-300">
          Annuler
        </button>
        {erreur && <span className="text-red-400 text-xs">{erreur}</span>}
      </div>
    </form>
  );
}

function CarteFournisseur({ f, onRecharger }: { f: Fournisseur; onRecharger: () => void }) {
  const [configOuverte, setConfigOuverte] = useState(false);
  const [verification, setVerification] = useState(false);
  const [messageVerif, setMessageVerif] = useState<string | null>(null);
  const { etat, config, capacites } = f;
  const statut = STATUTS[etat.statut] ?? STATUTS.inconnu;

  const verifier = async () => {
    setVerification(true);
    setMessageVerif(null);
    try {
      const r = await fetch('/api/admin/fournisseurs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fournisseur: f.id, action: 'verifier' }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.error || 'Vérification impossible');
      if (j.data?.enCours) setMessageVerif('Vérification déjà en cours, réessayez dans une minute.');
      onRecharger();
    } catch (err) {
      setMessageVerif(err instanceof Error ? err.message : 'Vérification impossible');
    } finally {
      setVerification(false);
    }
  };

  const recharge = etat.autoReload
    ? `${etat.autoReload.active ? 'activée' : 'désactivée'} (lu chez le fournisseur${
        etat.autoReload.active && etat.autoReload.seuil !== null ? `, sous ${etat.autoReload.seuil}` : ''
      }${etat.autoReload.active && etat.autoReload.montant !== null ? `, +${etat.autoReload.montant}` : ''})`
    : `${config.autoRechargeAttendue ? 'activée' : 'désactivée'} (déclarée)`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-3">
            {f.nom}
            <span className="flex items-center gap-1.5 text-sm font-normal" data-testid={`statut-${f.id}`}>
              <span style={{ width: 10, height: 10, borderRadius: 9999, background: statut.couleur, display: 'inline-block' }} />
              {statut.label}
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Ligne label="Solde">
            {capacites.soldeApi
              ? etat.solde !== null ? `${etat.solde} ${etat.devise}` : 'non lu'
              : 'Non mesurable (aucune API de solde)'}
          </Ligne>
          <Ligne label="Seuils (bas / critique)">{config.seuilBas} / {config.seuilCritique}</Ligne>
          <Ligne label="Recharge auto">{recharge}</Ligne>
          <Ligne label="Dernière recharge">
            {etat.derniereRecharge
              ? `${date(etat.derniereRecharge)}${etat.derniereRechargeMontant !== null ? ` (+${etat.derniereRechargeMontant} ${etat.devise})` : ''}`
              : '—'}
          </Ligne>
          <Ligne label="Dernière consommation">
            {etat.derniereConsommation ? `${date(etat.derniereConsommation.le)} (−${etat.derniereConsommation.montant} ${etat.devise})` : '—'}
          </Ligne>
          <Ligne label="Dernière vérification">{date(etat.derniereVerification)}</Ligne>
          <Ligne label="Recharges jour / mois">
            {etat.rechargesJour.n} / {config.maxRechargesJour} · {etat.rechargesMois.n} / {config.maxRechargesMois}
          </Ligne>
          <Ligne label="Bloqué depuis">{date(etat.bloqueDepuis)}</Ligne>
        </div>
        {etat.derniereErreur && (
          <div>
            <div className="text-gray-400 text-xs">Dernière erreur (brute)</div>
            <pre className="text-xs text-red-300 bg-gray-950 border border-gray-800 rounded p-2 whitespace-pre-wrap break-all">{etat.derniereErreur}</pre>
          </div>
        )}
        <p className="text-xs text-gray-500">{capacites.rechargeOfficielle}</p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfigOuverte((o) => !o)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-700 text-sm text-gray-200 hover:bg-gray-800"
          >
            <Settings size={16} /> Configurer
          </button>
          <button
            type="button"
            onClick={verifier}
            disabled={verification}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-700 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
          >
            {verification ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Vérifier le solde
          </button>
          {AVEC_PAGE_COUTS.has(f.id) ? (
            <Link href="/admin/avatar-couts" className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-700 text-sm text-gray-200 hover:bg-gray-800">
              <BarChart3 size={16} /> Voir consommation
            </Link>
          ) : (
            <a href="#economie" className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-gray-700 text-sm text-gray-200 hover:bg-gray-800">
              <BarChart3 size={16} /> Voir consommation
            </a>
          )}
        </div>
        {messageVerif && <p className="text-xs text-amber-300">{messageVerif}</p>}

        {configOuverte && (
          <FormulaireConfig
            f={f}
            onFini={() => {
              setConfigOuverte(false);
              onRecharger();
            }}
          />
        )}

        <div>
          <div className="text-gray-400 text-xs mb-1">Journal d’alertes (10 dernières)</div>
          {f.alertes.length === 0 ? (
            <p className="text-xs text-gray-500">Aucune alerte.</p>
          ) : (
            <ul className="space-y-1">
              {f.alertes.slice(0, 10).map((a) => {
                const { couleur, Icone } = SEVERITES[a.severity] ?? SEVERITES.info;
                return (
                  <li key={a.id} className="flex items-start gap-2 text-xs" style={{ opacity: a.dismissed ? 0.5 : 1 }}>
                    <Icone size={14} style={{ color: couleur, flexShrink: 0, marginTop: 1 }} />
                    <span className="text-gray-500 whitespace-nowrap">{date(a.timestamp)}</span>
                    <span>{a.message}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Economie({ economie }: { economie: Donnees['economie'] }) {
  return (
    <Card>
      <CardHeader><CardTitle><span id="economie">Économie</span></CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-gray-400">
          Seules les générations d’avatar sont mesurées aujourd’hui. Un coût non mesuré n’est pas un coût nul.
        </p>
        {!Array.isArray(economie) ? (
          <p className="text-red-400 text-sm">Lecture impossible : {economie.erreur}</p>
        ) : economie.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune génération sur les 6 derniers mois.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-400">
                  <th className="p-2">Mois</th><th className="p-2">Coût fournisseur</th><th className="p-2">Par fournisseur</th>
                  <th className="p-2">Coût moyen / vidéo</th><th className="p-2">Prix Studiio</th><th className="p-2">Marge brute</th>
                  <th className="p-2">Non mesurées</th>
                </tr>
              </thead>
              <tbody>
                {economie.map((m) => (
                  <tr key={m.mois} className="border-t border-gray-800">
                    <td className="p-2 whitespace-nowrap">{m.mois}</td>
                    <td className="p-2">{eur(m.coutFournisseurEur)}</td>
                    <td className="p-2">
                      {Object.entries(m.parFournisseur).map(([id, v]) => (
                        <div key={id}>{id} : {eur(v.coutEur)} ({v.mesurees}/{v.generations})</div>
                      ))}
                    </td>
                    <td className="p-2">{eur(m.coutMoyenVideoEur)}</td>
                    <td className="p-2">{eur(m.prixStudiioEur)}</td>
                    <td className="p-2">{eur(m.margeBruteEur)}</td>
                    <td className="p-2">{m.nonMesurees} / {m.generations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FournisseursPage() {
  const [data, setData] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(() => {
    fetch('/api/admin/fournisseurs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => (j.success ? (setData(j.data), setErreur(null)) : setErreur(j.error || 'Lecture impossible')))
      .catch(() => setErreur('Lecture impossible'));
  }, []);

  useEffect(() => { charger(); }, [charger]);

  if (erreur && !data) return <div className="p-6 text-red-400 flex gap-2"><AlertCircle className="w-5 h-5" />{erreur}</div>;
  if (!data) return <div className="p-6"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Fournisseurs</h1>
      <p className="text-sm text-gray-400 flex items-center gap-2">
        <Info size={16} />
        Studiio ne déclenche aucun paiement : les recharges se règlent chez le fournisseur (auto-reload).
      </p>
      {data.generationsEnAttente > 0 && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <Clock size={16} />
          {data.generationsEnAttente} génération(s) en attente du fournisseur — reprise automatique
        </div>
      )}
      {erreur && <p className="text-red-400 text-sm">{erreur}</p>}
      <div className="space-y-4">
        {data.fournisseurs.map((f) => <CarteFournisseur key={f.id} f={f} onRecharger={charger} />)}
      </div>
      <Economie economie={data.economie} />
    </div>
  );
}
