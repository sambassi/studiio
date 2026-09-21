'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, UserSquare2 } from 'lucide-react';
import { lireEtatJumeau, type EtatJumeau } from '@/lib/creer/jumeau';

/**
 * JUMEAU NUMÉRIQUE — le bloc de l'étape Sujet.
 *
 * Un interrupteur, « Utiliser mon jumeau », désactivé par défaut, et l'état
 * tel que le SERVEUR le voit : prêt (avatar validé, voix nommée) ou le motif
 * qui l'empêche, avec l'action qui débloque. Rien n'est décidé ici : quand
 * ce n'est pas prêt, l'interrupteur reste inerte — jamais un faux « prêt ».
 */
export default function JumeauPanel(props: { actif: boolean; onChange: (actif: boolean) => void }) {
  const [etat, setEtat] = useState<EtatJumeau | null | 'chargement'>('chargement');

  useEffect(() => {
    let vivant = true;
    void lireEtatJumeau().then((e) => { if (vivant) setEtat(e); });
    return () => { vivant = false; };
  }, []);

  // Si le serveur ne dit plus « prêt », l'intention tombe : on ne garde pas
  // un interrupteur allumé au-dessus d'un jumeau indisponible.
  useEffect(() => {
    if (etat !== 'chargement' && props.actif && !(etat && etat.pret)) props.onChange(false);
  }, [etat, props]);

  const pret = etat !== 'chargement' && !!etat && etat.pret;
  const action = (motif: string | null): { libelle: string; href: string } => (
    motif === 'voix_absente' || motif === 'choix_voix_requis' || motif === 'voix_inutilisable'
      ? { libelle: 'Configurer ma voix', href: '/dashboard/avatar' }
      : { libelle: 'Gérer mon avatar', href: '/dashboard/avatar' }
  );

  return (
    <div data-jumeau-panel className="rounded-xl border border-white/10 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold text-sm"><UserSquare2 className="w-4 h-4" /> Jumeau numérique</div>
        <label className={`flex items-center gap-2 text-sm ${pret ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            role="switch"
            data-jumeau-interrupteur
            aria-label="Utiliser mon jumeau"
            checked={props.actif}
            disabled={!pret}
            onChange={(e) => props.onChange(e.target.checked && pret)}
            className="h-4 w-4 accent-purple-500"
          />
          Utiliser mon jumeau
        </label>
      </div>
      <p className="text-xs text-gray-400">Votre avatar et votre voix personnelle seront utilisés pour présenter cette vidéo.</p>

      {etat === 'chargement' && (
        <div className="text-xs text-gray-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Vérification de votre jumeau…</div>
      )}
      {etat === null && (
        <div data-jumeau-etat="indisponible" className="text-xs text-gray-400">Votre jumeau n’a pas pu être vérifié pour le moment.</div>
      )}
      {etat !== 'chargement' && etat && etat.pret && etat.jumeau && (
        <div data-jumeau-etat="pret" className="text-xs space-y-1">
          <div className="text-emerald-300 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Votre jumeau est prêt</div>
          <div className="text-gray-300">Avatar : Validé</div>
          <div className="text-gray-300">Voix : Ma voix — {etat.jumeau.voix.nom}</div>
          {etat.jumeau.prononciations > 0 && (
            <div className="text-gray-500">{etat.jumeau.prononciations} prononciation{etat.jumeau.prononciations > 1 ? 's' : ''} personnalisée{etat.jumeau.prononciations > 1 ? 's' : ''} seront appliquées au texte prononcé.</div>
          )}
          {/* Dite AVANT d'activer, pas seulement apres : l'utilisateur doit
              savoir ce que « Utiliser mon jumeau » produira (ou pas) avec
              SON avatar — un avatar D-ID a une voix utilisable mais pas
              encore de moteur video. */}
          {!etat.moteurDisponible && etat.messageMoteur && (
            <div data-jumeau-moteur="indisponible" className="text-amber-200 mt-1">{etat.messageMoteur}</div>
          )}
        </div>
      )}
      {etat !== 'chargement' && etat && !etat.pret && (
        <div data-jumeau-etat={etat.motif ?? 'inconnu'} className="text-xs space-y-1">
          <div className="text-gray-300">{etat.message}</div>
          <Link data-jumeau-action href={action(etat.motif).href} className="text-purple-300 hover:text-purple-200 underline">{action(etat.motif).libelle}</Link>
        </div>
      )}
    </div>
  );
}
