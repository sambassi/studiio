'use client';
/**
 * Le débit de parole PROPRE AU COMPTE (car./s), lu par `GET /api/autopilot/config`
 * (`debitParole`, calibré sur les rendus précédents — `lireDebitParoleCompte`).
 * `null` tant qu'il n'est pas lu, sans rendu calibrant, ou en cas d'échec :
 * l'aperçu garde alors le débit par défaut. Lu seulement quand l'avatar est actif.
 */
import { useEffect, useState } from 'react';

export function useDebitParoleCompte(actif: boolean): number | null {
  const [debit, setDebit] = useState<number | null>(null);
  useEffect(() => {
    if (!actif) return;
    let vivant = true;
    fetch('/api/autopilot/config', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivant && typeof d?.debitParole === 'number' && Number.isFinite(d.debitParole)) setDebit(d.debitParole);
      })
      .catch(() => { /* débit par défaut */ });
    return () => { vivant = false; };
  }, [actif]);
  return debit;
}
