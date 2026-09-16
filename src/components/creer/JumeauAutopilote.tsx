'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Check, UserSquare2, AlertTriangle } from 'lucide-react';
import { lireEtatJumeau, type EtatJumeau } from '@/lib/creer/jumeau';

/**
 * MON JUMEAU DANS L'AUTOPILOTE — le meme etat serveur que le bloc de Creer
 * une video (`JumeauPanel` / `GET /api/creer/jumeau`), dit honnetement.
 *
 * Ce que l'Autopilote SAIT faire aujourd'hui avec le jumeau : narrer avec sa
 * VOIX clonee (le cron lit `voiceEnabled` + `voiceId`). Ce qu'il ne fait
 * PAS encore : monter la VIDEO de l'avatar dans les sequences — cela n'existe
 * que dans Creer une video. L'interrupteur branche donc la voix du jumeau
 * (reel), et l'ecran dit ou la video de l'avatar est disponible. Jamais une
 * option qui promet ce que le serveur ne produit pas.
 */
export default function JumeauAutopilote(props: {
  /** La voix du jumeau est-elle celle de l'Autopilote (voiceEnabled + voiceId) ? */
  actif: boolean;
  /** Active/desactive la voix du jumeau ; `voixId` = la voix a poser. */
  onChange: (actif: boolean, voixId: string | null) => void;
}) {
  const [etat, setEtat] = useState<EtatJumeau | null | 'chargement'>('chargement');
  useEffect(() => {
    let vivant = true;
    void lireEtatJumeau().then((e) => { if (vivant) setEtat(e); });
    return () => { vivant = false; };
  }, []);

  const jumeau = etat !== 'chargement' && etat && etat.pret ? etat.jumeau : null;
  const pret = !!jumeau;
  const voixId = jumeau ? jumeau.voix.id : null;

  return (
    <div data-jumeau-autopilote className="rounded-xl border border-white/10 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-semibold text-sm"><UserSquare2 className="w-4 h-4" /> Mon jumeau</div>
        <label className={`flex items-center gap-2 text-sm ${pret ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
          <input
            type="checkbox"
            role="switch"
            data-jumeau-autopilote-interrupteur
            aria-label="Utiliser mon jumeau"
            checked={props.actif && pret}
            disabled={!pret}
            onChange={(e) => props.onChange(e.target.checked && pret, voixId)}
            className="h-4 w-4 accent-purple-500"
          />
          Utiliser mon jumeau
        </label>
      </div>

      {etat === 'chargement' && (
        <div className="text-xs text-gray-500 flex items-center gap-1.5" data-jumeau-autopilote-etat="chargement">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Vérification de votre jumeau…
        </div>
      )}
      {etat === null && (
        <div data-jumeau-autopilote-etat="indisponible" className="text-xs text-gray-400">
          Votre jumeau n’a pas pu être vérifié pour le moment.
        </div>
      )}
      {etat !== 'chargement' && etat && etat.pret && etat.jumeau && (
        <div data-jumeau-autopilote-etat="pret" className="text-xs space-y-1">
          <div className="text-emerald-300 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Votre jumeau est prêt</div>
          <div className="text-gray-300">Avatar : validé (v{etat.jumeau.avatar.version}) · Voix : {etat.jumeau.voix.nom}</div>
          <div className="text-gray-400">
            Dans l’Autopilote, votre jumeau parle : sa voix narre chaque vidéo produite.
          </div>
          <div className="flex items-start gap-1.5 text-gray-500" data-jumeau-autopilote-video>
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-300/80" />
            <span>
              {etat.moteurDisponible
                ? 'La vidéo de votre avatar n’est pas encore montée par l’Autopilote : pour une vidéo avec votre jumeau à l’image, passez par Créer une vidéo.'
                : (etat.messageMoteur || 'La vidéo de votre avatar n’est pas disponible pour le moment.')}
            </span>
          </div>
        </div>
      )}
      {etat !== 'chargement' && etat && !etat.pret && (
        <div data-jumeau-autopilote-etat={etat.motif ?? 'inconnu'} className="text-xs space-y-1">
          <div className="text-gray-300">{etat.message || 'Votre jumeau n’est pas prêt.'}</div>
        </div>
      )}

      <Link
        href="/dashboard/avatar"
        data-jumeau-autopilote-lien
        className="inline-block text-xs text-purple-300 hover:text-purple-200 underline underline-offset-2"
      >
        Gérer mon avatar
      </Link>
    </div>
  );
}
