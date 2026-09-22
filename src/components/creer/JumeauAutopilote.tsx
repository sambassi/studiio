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
 *
 * ⚠️ L'IDENTIFIANT ENREGISTRE EST CELUI DU MOTEUR. Le contrat Jumeau designe
 * la voix par son identifiant DE COMPTE (`voix.id` = `user_voices.id`) — jamais
 * un identifiant fournisseur. La configuration Autopilote, elle, attend
 * l'identifiant Studiio `elevenlabs-…` des voix du compte (GET /api/voice/clone).
 * Le bloc fait la correspondance EXACTE par `accountVoiceId` — jamais par le
 * nom, deux voix pouvant s'appeler pareil — et n'active rien sans elle.
 */
export default function JumeauAutopilote(props: {
  /** La voix du jumeau est-elle celle de l'Autopilote (voiceEnabled + voiceId) ? */
  actif: boolean;
  /** Active/desactive la voix du jumeau ; `voixId` = l'identifiant Studiio (`elevenlabs-…`) a poser. */
  onChange: (actif: boolean, voixId: string | null) => void;
  /** Les voix du compte (GET /api/voice/clone) ; `null` tant qu'elles ne sont pas relues. */
  voixCompte: Array<{ id: string; accountVoiceId?: string }> | null;
  /**
   * La VIDÉO du jumeau est-elle montée dans les montages (config.jumeauAvatar) ?
   * Distinct de la voix : c'est l'avatar À L'IMAGE, généré côté serveur.
   */
  avatarActif?: boolean;
  /** La colonne `jumeau_avatar` existe-t-elle (migration appliquée) ? */
  jumeauReady?: boolean;
  /** Active/désactive la vidéo du jumeau dans les montages. Absent : option masquée. */
  onAvatarChange?: (actif: boolean) => void;
}) {
  const [etat, setEtat] = useState<EtatJumeau | null | 'chargement'>('chargement');
  useEffect(() => {
    let vivant = true;
    void lireEtatJumeau().then((e) => { if (vivant) setEtat(e); });
    return () => { vivant = false; };
  }, []);

  const etatLu = etat !== 'chargement' && etat ? etat : null;
  const jumeau = etatLu && etatLu.pret ? etatLu.jumeau : null;
  // La voix du jumeau, retrouvée parmi celles du compte par son identifiant de
  // compte (correspondance exacte). Sans elle, l'interrupteur reste inerte.
  const voixReliee = jumeau && props.voixCompte ? props.voixCompte.find((v) => v.accountVoiceId === jumeau.voix.id) ?? null : null;
  const voixEnAttente = !!jumeau && props.voixCompte === null;
  const pret = !!jumeau && !!voixReliee;
  const voixId = voixReliee ? voixReliee.id : null;
  // Le moteur VIDÉO du jumeau est-il disponible sur ce serveur POUR cet avatar ?
  // (D-ID configuré + voix ElevenLabs — voir `moteurJumeauDisponiblePour`.)
  const moteurVideo = !!etatLu?.moteurDisponible;

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

      {(etat === 'chargement' || voixEnAttente) && (
        <div className="text-xs text-gray-500 flex items-center gap-1.5" data-jumeau-autopilote-etat="chargement">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Vérification de votre jumeau…
        </div>
      )}
      {etat === null && (
        <div data-jumeau-autopilote-etat="indisponible" className="text-xs text-gray-400">
          Votre jumeau n’a pas pu être vérifié pour le moment.
        </div>
      )}
      {jumeau && !voixEnAttente && !voixReliee && (
        <div data-jumeau-autopilote-etat="voix_non_reliee" className="text-xs space-y-1">
          <div className="text-amber-200 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> La voix de votre jumeau doit être vérifiée</div>
          <div className="text-gray-300">
            Votre jumeau est prêt, mais sa voix (« {jumeau.voix.nom} ») n’est pas dans la liste des voix clonées de votre compte :
            l’Autopilote ne peut pas la poser. Rechargez la page ou vérifiez votre voix dans Mon avatar.
          </div>
        </div>
      )}
      {jumeau && voixReliee && (
        <div data-jumeau-autopilote-etat="pret" className="text-xs space-y-1">
          {/* Le titre dit CE QUI est prêt ici : la voix, pour la narration —
              pas « votre jumeau », qui laisserait croire à l'avatar à l'image
              que la ligne suivante dément. */}
          <div className="text-emerald-300 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Voix du jumeau prête pour la narration</div>
          <div className="text-gray-300">Avatar : validé (v{jumeau.avatar.version}) · Voix : {jumeau.voix.nom}</div>
          <div className="text-gray-400">
            Avec l’interrupteur, la narration de chaque vidéo produite par l’Autopilote est dite avec cette voix.
          </div>

          {/* ── La VIDÉO du jumeau, montée dans les montages ─────────────── */}
          {props.onAvatarChange && moteurVideo && props.jumeauReady && (
            <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2.5 space-y-1.5" data-jumeau-autopilote-video="disponible">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  role="switch"
                  data-jumeau-autopilote-avatar
                  aria-label="Monter la vidéo de mon jumeau"
                  checked={!!props.avatarActif}
                  onChange={(e) => props.onAvatarChange?.(e.target.checked)}
                  className="h-4 w-4 accent-purple-500"
                />
                <span className="text-emerald-200 font-medium">Monter la vidéo de mon jumeau</span>
              </label>
              <div className="text-gray-400">
                Votre avatar parlant (sur votre voix clonée) devient la séquence « Vidéo » des montages produits — « Produire maintenant » et les générations programmées, même page fermée.
              </div>
              <div className="text-gray-500">
                Chaque montage génère alors un avatar (facturé en plus du rendu) et arrive dans le Calendrier quelques minutes après. En cas d’échec, le montage sort sans l’avatar et le signale.
              </div>
            </div>
          )}
          {props.onAvatarChange && moteurVideo && props.jumeauReady === false && (
            <div className="flex items-start gap-1.5 text-gray-500" data-jumeau-autopilote-video="migration">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-300/80" />
              <span>
                La vidéo du jumeau est disponible sur le serveur, mais le réglage n’est pas encore enregistrable (migration <code>2026-09-23-autopilot-jumeau.sql</code> à appliquer).
              </span>
            </div>
          )}
          {!moteurVideo && (
            <div className="flex items-start gap-1.5 text-gray-500" data-jumeau-autopilote-video="indisponible">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-300/80" />
              <span>
                {etatLu?.messageMoteur
                  || 'La vidéo de votre avatar n’est pas disponible sur ce serveur pour le moment — la voix reste utilisable pour la narration.'}
              </span>
            </div>
          )}
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
