'use client';

/**
 * « APERÇU DE MON MONTAGE » PENDANT LA VÉRIFICATION DE L'AVATAR.
 *
 * ⚠️ UN CHARGEMENT A UN DÉLAI ET UNE ERREUR VISIBLE. Si la disponibilité de
 * l'avatar ne se résout pas en `DELAI_VERIFICATION_AVATAR_MS` (ou si sa lecture
 * échoue — `EVENEMENT_ECHEC_AVATAR`), l'écran sort de « Vérification… » vers un
 * emplacement EXPLICITE (« Aperçu de votre avatar indisponible pour le moment
 * — il sera utilisé au rendu ») avec « Réessayer ». Jamais un média stock à
 * sa place, jamais un spinner infini.
 *
 * « Réessayer » relance la MÊME lecture que le panneau
 * (`useDisponibiliteAvatarAutopilote` écoute `EVENEMENT_RELIRE_AVATAR`) —
 * aucune génération, aucun fournisseur.
 */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, UserRound } from 'lucide-react';
import { EVENEMENT_ECHEC_AVATAR, relireDisponibiliteAvatar } from '@/components/creer/AvatarPrincipalAutopilote';

export const DELAI_VERIFICATION_AVATAR_MS = 8000;
export const MESSAGE_AVATAR_APERCU_INDISPONIBLE = 'Aperçu de votre avatar indisponible pour le moment — il sera utilisé au rendu';

export default function AttenteAvatarMontage({ delaiMs = DELAI_VERIFICATION_AVATAR_MS }: { delaiMs?: number }) {
  const [etat, setEtat] = useState<'attente' | 'indisponible'>('attente');
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    if (etat !== 'attente') return;
    const id = window.setTimeout(() => setEtat('indisponible'), delaiMs);
    const echec = () => setEtat('indisponible');
    window.addEventListener(EVENEMENT_ECHEC_AVATAR, echec);
    return () => { window.clearTimeout(id); window.removeEventListener(EVENEMENT_ECHEC_AVATAR, echec); };
  }, [etat, essai, delaiMs]);

  const reessayer = useCallback(() => {
    setEtat('attente');
    setEssai((n) => n + 1);
    relireDisponibiliteAvatar();
  }, []);

  return (
    <section
      data-autopilot-montage-prevu={etat === 'attente' ? 'chargement' : 'avatar-indisponible'}
      className="mt-3 rounded-xl bg-gray-900/50 ring-1 ring-white/10 p-3 min-w-0"
    >
      <h3 className="text-sm font-semibold text-gray-100">Aperçu de mon montage</h3>
      {etat === 'attente' ? (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400" data-autopilot-avatar-verification>
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          Vérification de votre avatar… Le montage s’affichera avec lui.
        </p>
      ) : (
        <div className="mt-2 flex items-start gap-2" data-autopilot-avatar-apercu-indisponible>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-800 text-gray-400">
            <UserRound className="w-5 h-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <p className="text-[11px] text-amber-300">{MESSAGE_AVATAR_APERCU_INDISPONIBLE}</p>
            <button
              type="button"
              onClick={reessayer}
              data-autopilot-avatar-reessayer
              className="flex items-center gap-1 rounded-lg bg-gray-800 hover:bg-gray-700 px-2.5 py-1 text-[11px] font-medium text-gray-100 transition"
            >
              <RotateCcw className="w-3 h-3" /> Réessayer
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
