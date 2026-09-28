'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Loader2, RefreshCw, Smartphone, XCircle,
} from 'lucide-react';

/**
 * Achat de crédits en Mobile Money (PawaPay).
 *
 * Tout ce qui touche à l'argent est décidé CÔTÉ SERVEUR :
 * - les packs (crédits et prix CHF déjà formaté) et les pays arrivent en
 *   props, préparés par le serveur ;
 * - le navigateur n'envoie QUE `{ pack, pays, devise? }` à
 *   `GET /api/pawapay/quote` et `POST /api/pawapay/deposit` — jamais de
 *   montant, de prix ni de crédits. `devise` n'est transmise que si le pays en
 *   propose plusieurs, et seulement une valeur de la liste renvoyée par le
 *   serveur ;
 * - le montant local et sa devise sont AFFICHÉS tels que le devis serveur les
 *   renvoie : aucun calcul ici.
 *
 * Au retour (`/dashboard/billing?pawapay=<depositId>`), le panneau interroge
 * `GET /api/pawapay/status/<id>` à intervalle régulier jusqu'à un état final
 * (`credited` / `failed`), une réponse 503/404, ou l'expiration du délai.
 */

export interface PackMobileMoney {
  id: 'small' | 'medium' | 'large' | 'xlarge';
  credits: number;
  /** Prix CHF déjà formaté par le serveur (ex. « 9.00 »). */
  prixChf: string;
}

export interface PaysMobileMoney {
  /** Code ISO alpha-3, tel que renvoyé par PawaPay. */
  code: string;
  nom: string;
}

export type EtatMobileMoney =
  | 'choix'
  | 'envoi'
  | 'attente'
  | 'expire'
  | 'credite'
  | 'echec'
  | 'introuvable'
  | 'indisponible';

interface DevisServeur {
  prixChf: string;
  montant: string;
  devise: string;
}

type EtatDevis = 'vide' | 'chargement' | 'ok' | 'devise' | 'erreur';

export const INTERVALLE_INTERROGATION_MS = 4000;
export const DUREE_MAX_INTERROGATION_MS = 3 * 60 * 1000;

interface Props {
  disponible: boolean;
  packs: PackMobileMoney[];
  pays: PaysMobileMoney[];
  /** `depositId` lu dans `?pawapay=` au retour de la page de paiement. */
  depositRetour?: string | null;
  /** Redirection vers la page PawaPay (injectable pour les tests). */
  naviguer?: (url: string) => void;
}

const naviguerParDefaut = (url: string) => { window.location.assign(url); };

export function MobileMoneyPanel({
  disponible, packs, pays, depositRetour = null, naviguer = naviguerParDefaut,
}: Props) {
  const [etat, setEtat] = useState<EtatMobileMoney>(
    depositRetour ? 'attente' : disponible ? 'choix' : 'indisponible',
  );
  const [pack, setPack] = useState<PackMobileMoney['id'] | ''>('');
  const [paysChoisi, setPaysChoisi] = useState('');
  const [devise, setDevise] = useState('');
  const [devisesProposees, setDevisesProposees] = useState<string[]>([]);
  const [devis, setDevis] = useState<DevisServeur | null>(null);
  const [etatDevis, setEtatDevis] = useState<EtatDevis>('vide');
  const [erreurDevis, setErreurDevis] = useState('');
  const requeteDevis = useRef(0);
  const [erreur, setErreur] = useState('');
  const [avertissement, setAvertissement] = useState('');
  const [solde, setSolde] = useState<number | null>(null);

  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debut = useRef(0);
  const actif = useRef(true);

  const arreter = useCallback(() => {
    if (minuterie.current) { clearTimeout(minuterie.current); minuterie.current = null; }
  }, []);

  useEffect(() => () => { actif.current = false; arreter(); }, [arreter]);

  const rafraichirSolde = useCallback(async () => {
    try {
      const r = await fetch('/api/credits/balance', { cache: 'no-store' });
      const d = await r.json();
      if (actif.current && typeof d?.balance === 'number') setSolde(d.balance);
    } catch { /* le solde reste visible ailleurs, rien de bloquant */ }
  }, []);

  const verifier = useCallback(async () => {
    if (!depositRetour || !actif.current) return;
    let prochain = true;
    try {
      const r = await fetch(`/api/pawapay/status/${encodeURIComponent(depositRetour)}`, { cache: 'no-store' });
      if (!actif.current) return;
      if (r.status === 503) { setEtat('indisponible'); prochain = false; }
      else if (r.status === 404) { setEtat('introuvable'); prochain = false; }
      else if (r.ok) {
        const d = await r.json();
        if (d?.status === 'credited') {
          setEtat('credite'); prochain = false; void rafraichirSolde();
        } else if (d?.status === 'failed') {
          setEtat('echec'); prochain = false;
        } else {
          setAvertissement('');
        }
      } else {
        setAvertissement('Vérification momentanément impossible, nouvel essai automatique.');
      }
    } catch {
      if (!actif.current) return;
      setAvertissement('Connexion interrompue, nouvel essai automatique.');
    }
    if (!prochain || !actif.current) return;
    if (Date.now() - debut.current >= DUREE_MAX_INTERROGATION_MS) { setEtat('expire'); return; }
    minuterie.current = setTimeout(() => { void verifier(); }, INTERVALLE_INTERROGATION_MS);
  }, [depositRetour, rafraichirSolde]);

  const demarrerInterrogation = useCallback(() => {
    arreter();
    setEtat('attente');
    setAvertissement('');
    debut.current = Date.now();
    void verifier();
  }, [arreter, verifier]);

  useEffect(() => {
    if (depositRetour) demarrerInterrogation();
    return arreter;
  }, [depositRetour, demarrerInterrogation, arreter]);

  // Devis serveur à chaque changement de pack, de pays ou de devise.
  const indisponible = etat === 'indisponible';
  useEffect(() => {
    if (!pack || !paysChoisi || indisponible) {
      setDevis(null); setEtatDevis('vide'); return;
    }
    const numero = ++requeteDevis.current;
    setDevis(null);
    setEtatDevis('chargement');
    setErreurDevis('');
    const params = new URLSearchParams({ pack, pays: paysChoisi });
    if (devise) params.set('devise', devise);
    (async () => {
      try {
        const r = await fetch(`/api/pawapay/quote?${params.toString()}`, { cache: 'no-store' });
        if (!actif.current || numero !== requeteDevis.current) return;
        if (r.status === 503) { setEtat('indisponible'); return; }
        const d = await r.json().catch(() => ({}));
        if (!actif.current || numero !== requeteDevis.current) return;
        if (r.ok && typeof d?.montant === 'string' && typeof d?.devise === 'string' && typeof d?.prixChf === 'string') {
          setDevis({ prixChf: d.prixChf, montant: d.montant, devise: d.devise });
          setEtatDevis('ok');
          return;
        }
        if (r.status === 400 && Array.isArray(d?.devises) && d.devises.length > 0) {
          setDevisesProposees(d.devises.filter((x: unknown): x is string => typeof x === 'string'));
          if (!devise) { setEtatDevis('devise'); return; }
        }
        setErreurDevis(typeof d?.error === 'string' && d.error ? d.error : 'Devis indisponible.');
        setEtatDevis('erreur');
      } catch {
        if (!actif.current || numero !== requeteDevis.current) return;
        setErreurDevis('Erreur de connexion');
        setEtatDevis('erreur');
      }
    })();
  }, [pack, paysChoisi, devise, indisponible]);

  const changerPays = (valeur: string) => {
    setPaysChoisi(valeur);
    setDevise('');
    setDevisesProposees([]);
  };

  const payer = async () => {
    if (!pack || !paysChoisi || etatDevis !== 'ok') return;
    setEtat('envoi');
    setErreur('');
    try {
      const r = await fetch('/api/pawapay/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(devise ? { pack, pays: paysChoisi, devise } : { pack, pays: paysChoisi }),
      });
      if (r.status === 503) { setEtat('indisponible'); return; }
      const d = await r.json().catch(() => ({}));
      const url = typeof d?.redirectUrl === 'string' ? d.redirectUrl : '';
      if (r.ok && url.startsWith('https://')) { naviguer(url); return; }
      if (Array.isArray(d?.devises) && d.devises.length > 0) {
        setDevisesProposees(d.devises.filter((x: unknown): x is string => typeof x === 'string'));
        setErreur('Choisissez la devise de paiement.');
      } else {
        setErreur(typeof d?.error === 'string' && d.error ? d.error : 'Impossible de démarrer le paiement.');
      }
    } catch {
      setErreur('Erreur de connexion');
    }
    setEtat('choix');
  };

  const packChoisi = packs.find((p) => p.id === pack);

  return (
    <section
      data-mobile-money={etat}
      aria-labelledby="mobile-money-titre"
      className="bg-gray-900/60 border border-gray-800 rounded-xl p-6 space-y-5"
    >
      <div className="flex items-center gap-2">
        <Smartphone size={18} className="text-emerald-400" />
        <h2 id="mobile-money-titre" className="text-lg font-bold text-white">Mobile Money</h2>
      </div>

      {(etat === 'choix' || etat === 'envoi') && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-gray-300 mb-2">Pack de crédits</legend>
            <div className="grid grid-cols-2 gap-3">
              {packs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  data-pack={p.id}
                  aria-pressed={pack === p.id}
                  onClick={() => setPack(p.id)}
                  className={`rounded-lg border p-3 text-left transition ${pack === p.id ? 'border-emerald-400 bg-emerald-500/10' : 'border-gray-700 hover:border-gray-500'}`}
                >
                  <span className="block text-white font-bold">{p.credits.toLocaleString('fr-CH')} crédits</span>
                  <span className="block text-sm text-gray-400">{p.prixChf} CHF</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <label htmlFor="mobile-money-pays" className="block text-sm font-semibold text-gray-300">Pays</label>
            <select
              id="mobile-money-pays"
              value={paysChoisi}
              onChange={(e) => changerPays(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            >
              <option value="">Choisir un pays</option>
              {pays.map((p) => (
                <option key={p.code} value={p.code}>{p.nom}</option>
              ))}
            </select>
          </div>

          {devisesProposees.length > 1 && (
            <div className="space-y-2">
              <label htmlFor="mobile-money-devise" className="block text-sm font-semibold text-gray-300">Devise</label>
              <select
                id="mobile-money-devise"
                value={devise}
                onChange={(e) => setDevise(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              >
                <option value="">Choisir une devise</option>
                {devisesProposees.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {packChoisi && paysChoisi && (
            <div data-recap={etatDevis} className="rounded-lg bg-gray-800/60 p-3 text-sm text-gray-300 space-y-1">
              <p>
                Prix : <strong className="text-white">{devis ? devis.prixChf : packChoisi.prixChf} CHF</strong>
              </p>
              {etatDevis === 'chargement' && (
                <p className="flex items-center gap-2 text-gray-400">
                  <Loader2 size={14} className="animate-spin" />
                  Calcul du montant local...
                </p>
              )}
              {etatDevis === 'ok' && devis && (
                <p data-montant-local>
                  Montant à payer : <strong className="text-white">{devis.montant} {devis.devise}</strong>
                </p>
              )}
              {etatDevis === 'devise' && (
                <p className="text-amber-400">Ce pays propose plusieurs devises : choisissez-en une.</p>
              )}
              {etatDevis === 'erreur' && (
                <p role="alert" className="text-red-400">{erreurDevis}</p>
              )}
            </div>
          )}

          {erreur && <p role="alert" className="text-sm text-red-400">{erreur}</p>}

          <button
            type="button"
            onClick={payer}
            disabled={!pack || !paysChoisi || etatDevis !== 'ok' || etat === 'envoi'}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 rounded-xl transition disabled:opacity-50"
          >
            {etat === 'envoi' && <Loader2 size={18} className="animate-spin" />}
            Payer avec Mobile Money
          </button>
        </>
      )}

      {etat === 'attente' && (
        <div role="status" className="flex items-start gap-3 text-gray-300">
          <Loader2 size={20} className="animate-spin text-emerald-400 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-white">Paiement en attente de confirmation</p>
            <p className="text-sm text-gray-400">Validez le paiement sur votre téléphone. Cette page se met à jour toute seule.</p>
            {avertissement && <p className="text-sm text-amber-400">{avertissement}</p>}
          </div>
        </div>
      )}

      {etat === 'expire' && (
        <div role="status" className="space-y-3">
          <div className="flex items-start gap-3 text-gray-300">
            <AlertTriangle size={20} className="text-amber-400 shrink-0" />
            <p className="text-sm">
              Le paiement n&apos;est pas encore confirmé. S&apos;il a été validé, les crédits seront ajoutés automatiquement.
            </p>
          </div>
          <button
            type="button"
            onClick={demarrerInterrogation}
            className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-semibold px-4 py-2 rounded-lg"
          >
            <RefreshCw size={16} />
            Vérifier à nouveau
          </button>
        </div>
      )}

      {etat === 'credite' && (
        <div role="status" className="flex items-start gap-3">
          <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-white">Paiement confirmé : vos crédits ont été ajoutés.</p>
            {solde !== null && (
              <p data-solde className="text-sm text-gray-300">
                Nouveau solde : <strong className="text-white">{solde.toLocaleString('fr-CH')} crédits</strong>
              </p>
            )}
          </div>
        </div>
      )}

      {etat === 'echec' && (
        <div role="alert" className="flex items-start gap-3">
          <XCircle size={20} className="text-red-400 shrink-0" />
          <p className="text-sm text-gray-300">Le paiement a échoué ou a été annulé : aucun crédit n&apos;a été ajouté.</p>
        </div>
      )}

      {etat === 'introuvable' && (
        <div role="alert" className="flex items-start gap-3">
          <XCircle size={20} className="text-red-400 shrink-0" />
          <p className="text-sm text-gray-300">Ce paiement est introuvable sur votre compte.</p>
        </div>
      )}

      {etat === 'indisponible' && (
        <div role="alert" className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-400 shrink-0" />
          <p className="text-sm text-gray-300">Le paiement Mobile Money est momentanément indisponible.</p>
        </div>
      )}
    </section>
  );
}
