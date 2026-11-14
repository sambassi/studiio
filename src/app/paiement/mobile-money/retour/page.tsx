'use client';

/**
 * RETOUR DU PAYEUR — `/paiement/mobile-money/retour?depot=...`.
 *
 * ⚠️ CETTE PAGE NE CRÉDITE RIEN. Elle interroge `/api/paiements/mobile-money/etat`,
 * qui relit le paiement AUPRÈS DU PRESTATAIRE et crédite seulement s'il est
 * confirmé au bon montant. Revenir ici sans avoir payé ne donne rien, et y
 * revenir dix fois ne donne pas dix fois.
 *
 * Un paiement mobile se confirme parfois après le retour du navigateur : la
 * page réinterroge donc quelques fois, puis dit honnêtement que la
 * confirmation prend du temps — sans jamais prétendre que c'est perdu, parce
 * que la réconciliation reprendra le dépôt.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';

interface Etat {
  issue: string;
  statut: string;
  credits: number;
  montant: number;
  devise: string;
  message: string | null;
}

const TENTATIVES_MAX = 6;
const ATTENTE_MS = 5_000;

function Contenu() {
  const depot = useSearchParams().get('depot') ?? '';
  const [etat, setEtat] = useState<Etat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tentatives, setTentatives] = useState(0);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  const interroger = useCallback(async () => {
    try {
      const r = await fetch(`/api/paiements/mobile-money/etat?depot=${encodeURIComponent(depot)}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) { setErreur(j?.error ?? 'État indisponible.'); return null; }
      setEtat(j as Etat);
      return j as Etat;
    } catch {
      setErreur('État indisponible.');
      return null;
    }
  }, [depot]);

  useEffect(() => {
    if (!depot) { setErreur('Référence de paiement absente.'); return; }
    let vivant = true;
    const tour = async (n: number) => {
      const j = await interroger();
      if (!vivant) return;
      setTentatives(n);
      const fini = j && ['credite', 'deja_credite', 'echoue', 'refuse'].includes(j.issue);
      if (!fini && n < TENTATIVES_MAX) {
        minuteur.current = setTimeout(() => tour(n + 1), ATTENTE_MS);
      }
    };
    tour(1);
    return () => { vivant = false; if (minuteur.current) clearTimeout(minuteur.current); };
  }, [depot, interroger]);

  const credite = etat && (etat.issue === 'credite' || etat.issue === 'deja_credite');
  const echoue = etat && (etat.issue === 'echoue' || etat.issue === 'refuse');

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <div className="card-base space-y-4" style={{ padding: 20 }}>
        {credite && (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-green-300">
              <CheckCircle2 size={22} /> Paiement confirmé
            </p>
            <p className="text-sm text-gray-300">
              {etat!.credits.toLocaleString('fr-CH')} crédits ont été ajoutés à ton compte
              ({etat!.montant.toLocaleString('fr-CH')} {etat!.devise}).
            </p>
          </>
        )}

        {echoue && (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-red-300">
              <XCircle size={22} /> Paiement non abouti
            </p>
            <p className="text-sm text-gray-300">
              {etat!.message ?? 'Aucun crédit n’a été ajouté, et rien ne t’a été débité par Studiio.'}
            </p>
          </>
        )}

        {!credite && !echoue && !erreur && (
          <>
            <p className="flex items-center gap-2 text-lg font-semibold text-amber-300">
              {tentatives >= TENTATIVES_MAX ? <Clock size={22} /> : <Loader2 size={22} className="animate-spin" />}
              {tentatives >= TENTATIVES_MAX ? 'Confirmation en cours' : 'Vérification du paiement'}
            </p>
            <p className="text-sm text-gray-300">
              {tentatives >= TENTATIVES_MAX
                ? 'Le prestataire n’a pas encore confirmé. Ce n’est pas perdu : dès que la '
                  + 'confirmation arrive, tes crédits sont ajoutés automatiquement, même si tu fermes cette page.'
                : 'Nous vérifions auprès du prestataire. Ne ferme pas cette page.'}
            </p>
          </>
        )}

        {erreur && <p className="text-sm text-red-300" role="alert">{erreur}</p>}

        <Link href="/dashboard/settings?tab=abonnement" className="inline-block text-sm text-studiio-primary hover:underline">
          Revenir à mon abonnement
        </Link>
      </div>
    </div>
  );
}

export default function RetourMobileMoney() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-400">Chargement…</div>}>
      <Contenu />
    </Suspense>
  );
}
