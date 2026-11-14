'use client';

/**
 * BANDEAU « données fictives ».
 *
 * Deux usages, volontairement distincts :
 *
 *   - `<BandeauDemo />` interroge `/api/mode` et n'apparaît que si la base
 *     servie est une base de PRÉVISUALISATION. En production, la route rend
 *     `false` par construction : le bandeau est alors absent.
 *   - `<BandeauExemples />` est INCONDITIONNEL : il accompagne des chiffres
 *     écrits en dur dans l'écran, qui sont fictifs partout, y compris en
 *     production.
 *
 * Le bandeau ne masque aucune alerte : il se place au-dessus du contenu, il
 * ne remplace rien, et il ne peut pas être refermé — une donnée fictive ne
 * doit pas pouvoir se faire passer pour réelle après un clic.
 */
import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import {
  DETAIL_DEMO, DETAIL_EXEMPLES, MENTION_DEMO, MENTION_EXEMPLES,
} from '@/lib/apercu/mode-demo';

function Bandeau({ titre, detail, testid }: { titre: string; detail: string; testid: string }) {
  return (
    <div
      role="status"
      data-testid={testid}
      className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3"
    >
      <FlaskConical size={18} className="mt-0.5 shrink-0 text-amber-300" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-amber-200">{titre}</p>
        <p className="mt-0.5 text-xs text-amber-200/80">{detail}</p>
      </div>
    </div>
  );
}

/** Affiché seulement quand la base servie est une base de prévisualisation. */
export function BandeauDemo() {
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    let vivant = true;
    fetch('/api/mode', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivant && j?.demonstration === true) setDemo(true); })
      .catch(() => { /* silence : l'absence de bandeau est le cas normal */ });
    return () => { vivant = false; };
  }, []);

  if (!demo) return null;
  return <Bandeau titre={MENTION_DEMO} detail={DETAIL_DEMO} testid="bandeau-demonstration" />;
}

/**
 * Toujours affiché. Accompagne des chiffres inscrits dans l'écran, qui ne
 * sont pas une mesure — en production comme ailleurs.
 */
export function BandeauExemples({ detail }: { detail?: string }) {
  return (
    <Bandeau
      titre={MENTION_EXEMPLES}
      detail={detail ?? DETAIL_EXEMPLES}
      testid="bandeau-exemples"
    />
  );
}
