'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import {
  jumeauActivable, lienJumeauCreer, messageJumeauCreer, type EtatJumeauCreer,
} from '@/lib/avatar/jumeau-creer';

/**
 * A_8h — « UTILISER MON CLONE » DANS LE PARCOURS « CREER ».
 *
 * ═════════════════════════════════════════════════════════════════════════
 * UN CONSENTEMENT PAR VIDEO, JAMAIS UNE ACTIVATION AUTOMATIQUE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * L'interrupteur est ETEINT par defaut, sur chaque nouveau projet, meme si un
 * clone parfait existe. Il ne s'allume que d'un geste, et seulement quand le
 * serveur dit que le clone peut servir — entraine, valide, avec la voix du
 * compte choisie dans « Ma voix ». Sinon l'ecran dit ce qui manque, et le
 * geste qui debloque.
 *
 * ⚠️ L'ECRAN NE DECIDE RIEN. L'etat vient de `GET /api/creer/jumeau`, qui
 * passe par le meme portail qu'Autopilote. Un brouillon relu avec
 * l'interrupteur allume mais un clone devenu indisponible est REMIS A ZERO,
 * et on le dit : une intention d'hier ne vaut pas un clone d'aujourd'hui.
 *
 * ⚠️ AUCUNE PREVIEW SYNTHETIQUE. Rien ici ne montre un visage : le bloc est
 * un interrupteur et une phrase.
 */

interface Props {
  actif: boolean;
  onChange: (actif: boolean) => void;
}

export default function JumeauCreerPanel({ actif, onChange }: Props) {
  const [etat, setEtat] = useState<EtatJumeauCreer>({ etat: 'chargement' });
  const [remisAZero, setRemisAZero] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const j = await (await fetch('/api/creer/jumeau')).json();
        if (annule) return;
        if (j?.ok && j.etat === 'pret' && j.voix) setEtat({ etat: 'pret', voix: j.voix });
        else setEtat({ etat: 'bloque', motif: typeof j?.motif === 'string' ? j.motif : 'avatar_absent' });
      } catch {
        if (!annule) setEtat({ etat: 'bloque', motif: 'avatar_absent' });
      }
    })();
    return () => { annule = true; };
  }, []);

  /* Un brouillon allume sur un clone qui ne peut plus servir : eteint, et dit. */
  useEffect(() => {
    if (etat.etat === 'bloque' && actif) { onChange(false); setRemisAZero(true); }
  }, [etat, actif, onChange]);

  const activable = jumeauActivable(etat);

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-2" data-jumeau-creer>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
          <Bot className="w-4 h-4 text-cyan-300" />
        </div>
        <div className="min-w-0 flex-1">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className={activable ? 'text-gray-200 font-medium' : 'text-gray-500 font-medium'}>
              Utiliser mon clone
            </span>
            <input
              type="checkbox"
              checked={actif && activable}
              disabled={!activable}
              onChange={(e) => onChange(e.target.checked)}
              data-jumeau-creer-toggle
              className="accent-cyan-600 disabled:opacity-40"
            />
          </label>
          <p className="text-xs text-gray-500 mt-0.5">
            Présentez cette vidéo avec votre jumeau numérique.
          </p>
        </div>
      </div>

      {etat.etat === 'chargement' && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Vérification de votre clone…
        </div>
      )}

      {etat.etat === 'bloque' && (
        <p className="text-xs text-gray-400" data-jumeau-creer-empechement>
          {messageJumeauCreer(etat.motif)}{' '}
          <a href={lienJumeauCreer(etat.motif).href} className="underline text-cyan-300">
            {lienJumeauCreer(etat.motif).libelle}
          </a>
          {remisAZero && (
            <span className="block text-amber-200/80 mt-1" data-jumeau-creer-remis-a-zero>
              « Utiliser mon clone » a été désactivé : votre clone doit être revalidé avant de servir.
            </span>
          )}
        </p>
      )}

      {etat.etat === 'pret' && (
        <p className="text-xs text-gray-400" data-jumeau-creer-voix>
          Voix : <span className="text-gray-200">{etat.voix.nom ?? 'ma voix'}</span>
          {actif && (
            <span className="block text-cyan-200/80 mt-1" data-jumeau-creer-attente-moteur>
              Votre clone est prêt. La génération avec le clone sera activée lors de la mise en
              service du moteur Digital Twin — aucune vidéo ordinaire ne sera produite à sa place.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
