'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Loader2 } from 'lucide-react';
import { CREDIT_PACKAGES } from '@/lib/stripe/constants';

interface BuyCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BuyCreditsModal({ isOpen, onClose }: BuyCreditsModalProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const buy = async (pack: string) => {
    setLoading(pack);
    try {
      const res = await fetch('/api/credits/purchase-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert(data.error || 'Erreur');
    } catch {
      alert('Erreur de connexion');
    } finally {
      setLoading(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Acheter des crédits" size="lg">
      <div className="grid sm:grid-cols-2 gap-4">
        {Object.entries(CREDIT_PACKAGES).map(([key, pkg]) => {
          const isPopular = (pkg as any).popular;
          return (
            <div
              key={key}
              className={`relative rounded-xl border p-4 ${
                isPopular ? 'border-studiio-accent bg-studiio-accent/5' : 'border-gray-800 bg-gray-900'
              }`}
            >
              {isPopular && (
                <span className="absolute -top-2 left-4 bg-purple-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  Populaire
                </span>
              )}
              <div className="text-lg font-bold text-white">{pkg.name}</div>
              <div className="text-2xl font-bold text-white mt-2">{pkg.priceFr}</div>
              <div className="text-xs text-gray-400 mt-1">{(pkg as any).unitPrice}</div>
              <Button
                variant={isPopular ? 'primary' : 'secondary'}
                className="w-full mt-4"
                onClick={() => buy(key)}
                disabled={loading === key}
              >
                {loading === key ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Acheter'}
              </Button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
