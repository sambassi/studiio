'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ChoixPaiement, type OffreChoisie } from '@/components/billing/ChoixPaiement';

interface Pack {
  key: string; name: string; amount: number; price_cents: number; popular?: boolean;
}

function centsToFr(cents: number): string {
  const francs = cents / 100;
  return francs % 1 === 0 ? `${francs} CHF` : `${francs.toFixed(2).replace('.', ',')} CHF`;
}

interface BuyCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BuyCreditsModal({ isOpen, onClose }: BuyCreditsModalProps) {
  const [offre, setOffre] = useState<OffreChoisie | null>(null);
  // ⚠️ `onCredite` ne ferme PAS la fenêtre : il la fermait, et l'écran de
  // confirmation qu'elle portait disparaissait avant d'être lu — le compte
  // était crédité, l'utilisateur ne voyait rien. On note seulement qu'un
  // crédit a eu lieu ; la fenêtre se ferme quand il clique « Fermer ».
  const [aCredite, setACredite] = useState(false);
  const [packs, setPacks] = useState<Pack[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/pricing', { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d.packs) setPacks(d.packs);
    }).catch(() => {});
  }, [isOpen]);

  /*
    Même changement que pour les abonnements : le clic ouvre le choix du
    moyen de paiement — carte ou Mobile Money — au lieu de lancer la carte
    et de finir sur un `alert()` du navigateur quand rien n'est configuré.
  */
  const buy = (pack: string) => {
    const p = packs.find((x) => x.key === pack);
    if (!p) return;
    setOffre({ type: 'pack', cle: pack, nom: p.name, prix: centsToFr(p.price_cents) });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Acheter des crédits" size="lg">
      <div className="grid sm:grid-cols-2 gap-4">
        {packs.map((pkg) => {
          const unitLabel = pkg.amount > 0 ? `${centsToFr(Math.round(pkg.price_cents / pkg.amount * 100) / 100)}/crédit` : '';
          return (
            <div key={pkg.key}
              className={`relative rounded-xl border p-4 ${pkg.popular ? 'border-studiio-accent bg-studiio-accent/5' : 'border-gray-800 bg-gray-900'}`}>
              {pkg.popular && (
                <span className="absolute -top-2 left-4 bg-purple-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">Populaire</span>
              )}
              <div className="text-lg font-bold text-white">{pkg.name}</div>
              <div className="text-2xl font-bold text-white mt-2">{centsToFr(pkg.price_cents)}</div>
              <div className="text-xs text-gray-400 mt-1">{unitLabel}</div>
              <Button variant={pkg.popular ? 'primary' : 'secondary'} className="w-full mt-4"
                onClick={() => buy(pkg.key)}>
                Acheter
              </Button>
            </div>
          );
        })}
      </div>
      <ChoixPaiement
        offre={offre}
        onCredite={() => setACredite(true)}
        onFermer={() => {
          setOffre(null);
          if (aCredite) { setACredite(false); onClose(); }
        }}
      />
    </Modal>
  );
}
