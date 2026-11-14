'use client';

/**
 * CHOISIR COMMENT PAYER — carte, ou Mobile Money.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE PANNEAU REMPLACE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `alert()` du navigateur. Il disait « Offre pro (mensuelle)
 * indisponible : prix non configuré » — une phrase vraie pour le serveur et
 * incompréhensible pour qui veut acheter, dans une fenêtre grise qui n'est
 * pas Studiio, et sans rien à faire d'autre que cliquer sur OK.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'IL N'INVENTE PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le montant en monnaie locale vient du SERVEUR, jamais d'un calcul ici. Les
 * pays viennent du compte marchand. Et le paiement simulé n'est proposé que
 * si le serveur déclare le mode démonstration : il ne se déguise jamais en
 * carte bancaire, et porte son nom partout où il apparaît.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CreditCard, Loader2, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ISSUES_DEMO, LIBELLE_ISSUE_DEMO, type IssueDemo } from '@/lib/paiements/demonstration';

export interface OffreChoisie {
  type: 'plan' | 'pack';
  cle: string;
  nom: string;
  cycle?: 'monthly' | 'yearly';
  prix: string;
}

interface PaysOuvert { pays: string; devise: string; nom: string }

type Etape = 'choix' | 'mobile' | 'simulation' | 'resultat';

export function ChoixPaiement({
  offre, onFermer, onCredite,
}: {
  offre: OffreChoisie | null;
  onFermer: () => void;
  onCredite?: () => void;
}) {
  const [etape, setEtape] = useState<Etape>('choix');
  const [demo, setDemo] = useState(false);
  const [mobile, setMobile] = useState<{ pays: PaysOuvert[]; simule: boolean } | null>(null);
  const [pays, setPays] = useState('');
  const [devis, setDevis] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [resultat, setResultat] = useState<{ titre: string; detail: string; bon: boolean } | null>(null);

  // Remise à zéro à chaque ouverture : un panneau qui garde l'état du
  // précédent achat ferait lire un résultat qui n'est pas le sien.
  useEffect(() => {
    if (!offre) return;
    setEtape('choix'); setErreur(null); setResultat(null); setDevis(null);
  }, [offre]);

  useEffect(() => {
    if (!offre) return;
    fetch('/api/mode', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setDemo(!!j?.demonstration))
      .catch(() => setDemo(false));
    fetch('/api/paiements/mobile-money/disponible', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.disponible && Array.isArray(j.pays) && j.pays.length > 0) {
          setMobile({ pays: j.pays, simule: !!j.simule });
          setPays(j.pays[0].pays);
        } else setMobile(null);
      })
      .catch(() => setMobile(null));
  }, [offre]);

  const devise = mobile?.pays.find((p) => p.pays === pays)?.devise ?? '';

  useEffect(() => {
    if (etape !== 'mobile' || !offre || !devise) return;
    let vivant = true;
    setDevis(null);
    fetch('/api/paiements/cfa/devis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [offre.type === 'plan' ? 'plan' : 'pack']: offre.cle, devise }),
    })
      .then((r) => r.json())
      .then((j) => { if (vivant) setDevis(j?.devis?.annonce ?? null); })
      .catch(() => { if (vivant) setDevis(null); });
    return () => { vivant = false; };
  }, [etape, offre, devise]);

  if (!offre) return null;

  const payerParCarte = async () => {
    setOccupe(true); setErreur(null);
    try {
      const res = offre.type === 'plan'
        ? await fetch('/api/stripe/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: offre.cle, billingCycle: offre.cycle ?? 'monthly' }),
        })
        : await fetch('/api/credits/purchase-pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId: offre.cle }),
        });
      const data = await res.json();
      const url = data.url || data.data?.sessionUrl;
      if (url) { window.location.href = url; return; }
      setErreur(data.error || 'Le paiement par carte n’a pas pu être ouvert.');
    } catch {
      setErreur('Le paiement par carte n’a pas pu être ouvert.');
    } finally { setOccupe(false); }
  };

  const payerParMobile = async () => {
    setOccupe(true); setErreur(null);
    try {
      const r = await fetch('/api/paiements/mobile-money/depot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offre: offre.type, cle: offre.cle, pays, devise }),
      });
      const j = await r.json();
      if (!r.ok || !j?.urlRedirection) {
        setErreur(j?.error ?? 'Le paiement mobile n’a pas pu être ouvert.');
        return;
      }
      window.location.href = j.urlRedirection as string;
    } catch {
      setErreur('Le paiement mobile n’a pas pu être ouvert.');
    } finally { setOccupe(false); }
  };

  const jouerSimulation = async (issue: IssueDemo) => {
    setOccupe(true); setErreur(null);
    try {
      const r = await fetch('/api/demonstration/paiement', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offre: offre.type, cle: offre.cle, cycle: offre.cycle, issue }),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) {
        setErreur(j?.error ?? 'La simulation a échoué.');
        return;
      }
      setResultat(
        j.credits > 0
          ? {
            titre: LIBELLE_ISSUE_DEMO[issue as IssueDemo],
            detail: `${j.credits} crédits ajoutés${j.solde != null ? ` — nouveau solde : ${j.solde}` : ''}.`,
            bon: true,
          }
          : {
            titre: LIBELLE_ISSUE_DEMO[issue as IssueDemo],
            detail: 'Aucun crédit n’a été ajouté — c’est le comportement attendu pour cette issue.',
            bon: false,
          },
      );
      setEtape('resultat');
      if (j.credits > 0) onCredite?.();
    } catch {
      setErreur('La simulation a échoué.');
    } finally { setOccupe(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titre-paiement"
      onClick={(e) => { if (e.target === e.currentTarget) onFermer(); }}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-white/10 bg-[#12121a] p-5 shadow-2xl sm:rounded-2xl"
        data-testid="choix-paiement"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="titre-paiement" className="text-lg font-bold text-white">{offre.nom}</h2>
            <p className="text-sm text-studiio-primary">{offre.prix}</p>
          </div>
          <button type="button" onClick={onFermer} aria-label="Fermer"
            className="rounded-lg p-1 text-gray-400 transition hover:bg-white/5 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {erreur && (
          <div role="alert" data-testid="erreur-paiement"
            className="mb-4 flex gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <div className="space-y-1 text-xs">
              <p className="text-amber-100">{erreur}</p>
              {demo && (
                <p className="text-amber-200/70">
                  Sur cet environnement de démonstration, aucun identifiant de prix bancaire n’est
                  configuré — c’est volontaire. Utilise le paiement simulé ou Mobile Money pour
                  parcourir l’achat jusqu’au bout.
                </p>
              )}
            </div>
          </div>
        )}

        {etape === 'choix' && (
          <div className="space-y-2">
            <button type="button" onClick={payerParCarte} disabled={occupe}
              data-testid="payer-carte"
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-studiio-primary/60 hover:bg-white/10 disabled:opacity-50">
              <CreditCard size={20} className="shrink-0 text-studiio-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white">Carte bancaire</span>
                <span className="block text-xs text-gray-400">Paiement sécurisé, renouvellement automatique</span>
              </span>
            </button>

            {mobile && (
              <button type="button" onClick={() => setEtape('mobile')} disabled={occupe}
                data-testid="payer-mobile-money"
                className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-studiio-primary/60 hover:bg-white/10 disabled:opacity-50">
                <Smartphone size={20} className="shrink-0 text-studiio-primary" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-white">Mobile Money</span>
                  <span className="block text-xs text-gray-400">
                    {mobile.pays.map((p) => p.nom).join(', ')}
                  </span>
                </span>
              </button>
            )}

            {demo && (
              <button type="button" onClick={() => setEtape('simulation')} disabled={occupe}
                data-testid="payer-simule"
                className="flex w-full items-center gap-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-left transition hover:bg-amber-500/10 disabled:opacity-50">
                <AlertTriangle size={20} className="shrink-0 text-amber-300" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-amber-100">Paiement simulé</span>
                  <span className="block text-xs text-amber-200/70">
                    Démonstration uniquement — ce n’est pas un paiement bancaire, aucun prestataire
                    n’est contacté
                  </span>
                </span>
              </button>
            )}
          </div>
        )}

        {etape === 'mobile' && (
          <div className="space-y-3">
            {mobile?.simule && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Prestataire simulé : aucun paiement réel ne peut partir.
              </p>
            )}
            <div className="space-y-1">
              <label htmlFor="pm-pays" className="block text-xs font-medium text-gray-300">Pays</label>
              <select id="pm-pays" value={pays} onChange={(e) => setPays(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-studiio-primary focus:outline-none">
                {mobile?.pays.map((p) => (
                  <option key={p.pays} value={p.pays}>{p.nom} — {p.devise}</option>
                ))}
              </select>
            </div>
            <p className="min-h-[1.25rem] text-sm text-gray-300" data-testid="devis-mobile">
              {devis ?? 'Calcul du montant…'}
            </p>
            {offre.type === 'plan' && (
              <p className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-400">
                Le Mobile Money ne permet pas le prélèvement automatique : ce paiement couvre une
                période, et le renouvellement se fera à la main.
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEtape('choix')}>Retour</Button>
              <Button variant="primary" className="flex-1" disabled={!devis || occupe} onClick={payerParMobile}>
                {occupe ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
                Payer
              </Button>
            </div>
          </div>
        )}

        {etape === 'simulation' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Choisis l’issue à jouer. Seul un paiement confirmé ajoute des crédits — les autres
              doivent pouvoir être observés, c’est justement ce qu’on vérifie.
            </p>
            <div className="grid gap-2">
              {ISSUES_DEMO.map((i) => (
                <button key={i} type="button" disabled={occupe} onClick={() => jouerSimulation(i)}
                  data-testid={`simuler-${i}`}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-white transition hover:border-studiio-primary/60 hover:bg-white/10 disabled:opacity-50">
                  {LIBELLE_ISSUE_DEMO[i]}
                  {i !== 'reussi' && <span className="ml-2 text-xs text-gray-500">aucun crédit</span>}
                </button>
              ))}
            </div>
            <Button variant="secondary" className="w-full" onClick={() => setEtape('choix')}>Retour</Button>
          </div>
        )}

        {etape === 'resultat' && resultat && (
          <div className="space-y-3" data-testid="resultat-paiement">
            <div className={`rounded-xl border p-3 ${resultat.bon
              ? 'border-green-500/40 bg-green-500/10' : 'border-gray-700 bg-white/5'}`}>
              <p className={`text-sm font-semibold ${resultat.bon ? 'text-green-300' : 'text-gray-200'}`}>
                {resultat.titre}
              </p>
              <p className="mt-1 text-xs text-gray-300">{resultat.detail}</p>
            </div>
            <p className="text-xs text-gray-500">
              Paiement simulé : aucun montant n’a été débité, aucun prestataire n’a été contacté.
            </p>
            <Button variant="primary" className="w-full" onClick={onFermer}>Fermer</Button>
          </div>
        )}
      </div>
    </div>
  );
}
