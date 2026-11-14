'use client';

/**
 * RECHARGE PAR MOBILE MONEY — le parcours, côté client.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CE COMPOSANT N'ENVOIE JAMAIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ni montant, ni devise de facturation, ni nombre de crédits : seulement la
 * CLÉ du pack et le pays. Tout le reste est décidé par le serveur, qui lit
 * le prix en base et convertit avec un taux daté. Un navigateur qui fixerait
 * son prix n'est pas un client.
 *
 * Le bloc n'apparaît que si le serveur déclare le moyen de paiement ouvert :
 * ni drapeau codé ici, ni liste de pays en dur.
 */
import { useEffect, useState } from 'react';
import { Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface PaysOuvert { pays: string; devise: string; nom: string }
interface Pack { key: string; name: string; amount: number; price_cents: number; active?: boolean }

export function MobileMoneyRecharge({ packs }: { packs: Pack[] }) {
  const [ouvert, setOuvert] = useState<{ pays: PaysOuvert[]; simule: boolean } | null>(null);
  const [pays, setPays] = useState('');
  const [pack, setPack] = useState('');
  const [devis, setDevis] = useState<string | null>(null);
  const [calcul, setCalcul] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/paiements/mobile-money/disponible', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.disponible && Array.isArray(j.pays) && j.pays.length > 0) {
          setOuvert({ pays: j.pays, simule: !!j.simule });
          setPays(j.pays[0].pays);
        }
      })
      .catch(() => { /* bloc simplement absent */ });
  }, []);

  const devise = ouvert?.pays.find((p) => p.pays === pays)?.devise ?? '';

  // Le montant affiché vient du SERVEUR, pas d'un calcul ici : c'est le même
  // devis que celui qui sera demandé au payeur.
  useEffect(() => {
    if (!pack || !devise) { setDevis(null); return; }
    let vivant = true;
    setCalcul(true);
    fetch('/api/paiements/cfa/devis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pack, devise }),
    })
      .then((r) => r.json())
      .then((j) => { if (vivant) setDevis(j?.devis?.annonce ?? null); })
      .catch(() => { if (vivant) setDevis(null); })
      .finally(() => { if (vivant) setCalcul(false); });
    return () => { vivant = false; };
  }, [pack, devise]);

  const payer = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await fetch('/api/paiements/mobile-money/depot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ offre: 'pack', cle: pack, pays, devise }),
      });
      const j = await r.json();
      if (!r.ok || !j?.urlRedirection) {
        setErreur(j?.error ?? 'Le paiement n’a pas pu être ouvert.');
        return;
      }
      window.location.href = j.urlRedirection as string;
    } catch {
      setErreur('Le paiement n’a pas pu être ouvert.');
    } finally {
      setEnvoi(false);
    }
  };

  if (!ouvert) return null;

  return (
    <Card data-testid="recharge-mobile-money">
      <CardHeader className="border-b border-gray-800">
        <CardTitle className="flex items-center gap-2">
          <Smartphone size={18} className="text-studiio-primary" /> Payer par Mobile Money
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {ouvert.simule && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Prestataire simulé : aucun paiement réel ne peut partir.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="mm-pays" className="block text-xs font-medium text-gray-300">Pays</label>
            <select
              id="mm-pays"
              value={pays}
              onChange={(e) => setPays(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-studiio-primary focus:outline-none"
            >
              {ouvert.pays.map((p) => (
                <option key={p.pays} value={p.pays}>{p.nom} — {p.devise}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="mm-pack" className="block text-xs font-medium text-gray-300">Recharge</label>
            <select
              id="mm-pack"
              value={pack}
              onChange={(e) => setPack(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-studiio-primary focus:outline-none"
            >
              <option value="">Choisir…</option>
              {packs.filter((p) => p.active !== false).map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        <p className="min-h-[1.25rem] text-sm text-gray-300" data-testid="mm-devis">
          {calcul ? 'Calcul du montant…' : devis ?? (pack ? 'Montant indisponible.' : 'Choisis une recharge pour voir le montant exact.')}
        </p>

        <Button variant="primary" className="w-full" disabled={!pack || !devis || envoi} onClick={payer}>
          {envoi ? <Loader2 size={16} className="mr-2 animate-spin" /> : null}
          Payer par Mobile Money
        </Button>

        {erreur && <p className="text-sm text-red-300" role="alert" data-testid="mm-erreur">{erreur}</p>}

        <p className="text-xs text-gray-500">
          Tu choisis ton opérateur sur la page de paiement sécurisée. Les crédits sont ajoutés après
          confirmation du paiement, une seule fois — même si tu fermes la page.
        </p>
      </CardContent>
    </Card>
  );
}
