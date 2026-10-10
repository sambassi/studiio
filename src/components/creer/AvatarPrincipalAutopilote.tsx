'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, Loader2, UserSquare2 } from 'lucide-react';
import { lireEtatJumeau, type EtatJumeau } from '@/lib/creer/jumeau';
import type { AvatarPret } from '@/lib/autopilot/medias-prevus';

/**
 * SOURCE « Mon avatar » — une des trois sources de la vidéo (étape Rushes).
 *
 * ⚠️ UNE SOURCE PARMI D'AUTRES. L'avatar se combine aux rushes personnels et
 * aux médias stock (voir `lib/autopilot/sources`) ; il n'est plus un parcours
 * « avatar seul ».
 *
 * ⚠️ AUCUN NOUVEAU RÉGLAGE. La case est le réglage EXISTANT `jumeauAvatar`
 * (« Monter la vidéo de mon jumeau », colonne `jumeau_avatar`), enregistré par
 * le même `enregistrer` du panneau : cocher ici ou dans « Mon jumeau » est le
 * même geste.
 *
 * ⚠️ LECTURE SEULE. La disponibilité vient de `GET /api/creer/jumeau` (la même
 * vérification que Créer : avatar actif + voix + moteur vidéo disponible pour
 * ce fournisseur) — une lecture en base, aucun appel fournisseur. Rien n'est
 * créé, rien n'est généré, rien n'est débité ici. La vignette est la source
 * déjà conservée de la version active (`/api/avatars/versions/:id/source`).
 *
 * Avatar pas prêt : la case ne s'active pas, et l'écran dit pourquoi avec un
 * lien vers « Mon avatar ». Déjà cochée (configuration plus ancienne) alors
 * que l'avatar n'est plus prêt : le panneau bloque l'étape, explicitement.
 */

/** La vignette de l'avatar choisi (ou par défaut) : la source de sa version active. */
export interface VignetteAvatar { url: string; type: 'photo' | 'video' }

/** Lit `GET /api/avatars` et rend la source conservée de l'avatar utilisé. `null` si aucune. */
export async function lireVignetteAvatar(avatarId: string | null, fetchImpl: typeof fetch = fetch): Promise<VignetteAvatar | null> {
  try {
    const r = await fetchImpl('/api/avatars', { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok || !j?.success || !Array.isArray(j?.data?.avatars)) return null;
    type A = { id: string; parDefaut?: boolean; utilisable?: boolean; type?: string; versionActive?: { id?: string; source?: boolean; type?: string } | null };
    const avatars = j.data.avatars as A[];
    const choisi = (avatarId && avatars.find((a) => a.id === avatarId && a.utilisable))
      || avatars.find((a) => a.parDefaut && a.utilisable)
      || avatars.find((a) => a.utilisable);
    const v = choisi?.versionActive;
    if (!v?.id || !v.source) return null;
    return { url: `/api/avatars/versions/${encodeURIComponent(v.id)}/source`, type: (v.type ?? choisi?.type) === 'video' ? 'video' : 'photo' };
  } catch {
    return null;
  }
}

/** L'avatar est-il prêt POUR LES MONTAGES (avatar + voix + moteur vidéo) ? */
export function avatarPretPourMontage(etat: EtatJumeau | null, colonneReady: boolean): AvatarPret {
  if (!etat) return null;
  return etat.pret && etat.moteurDisponible && colonneReady;
}

/** Petite vignette ; repli sur l'icône si la source est illisible. */
export function MiniatureAvatar({ vignette, className = 'w-10 h-10' }: { vignette: VignetteAvatar | null; className?: string }) {
  const [echec, setEchec] = useState(false);
  useEffect(() => { setEchec(false); }, [vignette?.url]);
  if (!vignette || echec) {
    return (
      <span className={`${className} shrink-0 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400`} data-avatar-vignette="icone">
        <UserSquare2 className="w-1/2 h-1/2" />
      </span>
    );
  }
  return vignette.type === 'video' ? (
    <video
      src={vignette.url}
      muted
      playsInline
      preload="metadata"
      onError={() => setEchec(true)}
      className={`${className} shrink-0 rounded-lg object-cover bg-gray-800`}
      data-avatar-vignette="video"
    />
  ) : (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={vignette.url}
      alt="Mon avatar"
      onError={() => setEchec(true)}
      className={`${className} shrink-0 rounded-lg object-cover bg-gray-800`}
      data-avatar-vignette="photo"
    />
  );
}

export default function AvatarPrincipalAutopilote(props: {
  /** `config.jumeauAvatar` — la vidéo du jumeau montée dans les montages. */
  actif: boolean;
  /** `config.jumeauAvatarId` — l'avatar logique choisi (`null` = par défaut). */
  avatarId: string | null;
  /** La colonne `jumeau_avatar` existe-t-elle ? Sans elle, rien ne s'enregistre. */
  jumeauReady: boolean;
  disabled?: boolean;
  onChange: (actif: boolean) => void;
  /** Remonte la disponibilité (pour la validation de l'étape et le résumé). */
  onPret?: (pret: AvatarPret) => void;
  onVignette?: (v: VignetteAvatar | null) => void;
}) {
  const { avatarId, jumeauReady, onPret, onVignette } = props;
  const [etat, setEtat] = useState<EtatJumeau | null | 'chargement'>('chargement');
  const [vignette, setVignette] = useState<VignetteAvatar | null>(null);

  useEffect(() => {
    let vivant = true;
    setEtat('chargement');
    void lireEtatJumeau(fetch, avatarId).then((e) => { if (vivant) setEtat(e ?? null); });
    return () => { vivant = false; };
  }, [avatarId]);

  const lu = etat === 'chargement' ? undefined : etat;
  const pret: AvatarPret = lu === undefined ? null : avatarPretPourMontage(lu, jumeauReady);

  useEffect(() => { onPret?.(pret); }, [pret, onPret]);

  // La vignette n'est lue que pour un avatar PRÊT : sans lui, rien à montrer.
  useEffect(() => {
    if (pret !== true) { setVignette(null); return; }
    let vivant = true;
    void lireVignetteAvatar(avatarId).then((v) => { if (vivant) setVignette(v); });
    return () => { vivant = false; };
  }, [pret, avatarId]);
  useEffect(() => { onVignette?.(vignette); }, [vignette, onVignette]);

  // Pourquoi l'avatar n'est pas utilisable — dit en une phrase, jamais le fournisseur.
  const raison = lu === null
    ? 'Votre avatar n’a pas pu être vérifié pour le moment.'
    : lu && !lu.pret
      ? (lu.message || 'Aucun avatar n’est prêt sur votre compte.')
      : lu && !lu.moteurDisponible
        ? (lu.messageMoteur || 'La vidéo de votre avatar n’est pas disponible sur ce serveur pour le moment.')
        : lu && !jumeauReady
          ? 'Le réglage de l’avatar n’est pas encore enregistrable (migration 2026-09-23-autopilot-jumeau.sql à appliquer).'
          : null;

  const cocheePossible = pret === true;
  const coche = props.actif && cocheePossible;

  return (
    <div
      className="space-y-1.5 min-w-0"
      data-autopilot-avatar-principal
      data-avatar-pret={pret === null ? 'inconnu' : pret ? 'oui' : 'non'}
    >
      <label className={`flex items-start gap-2 ${cocheePossible && !props.disabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
        <input
          type="checkbox"
          checked={coche}
          disabled={!cocheePossible || props.disabled}
          onChange={(e) => props.onChange(e.target.checked && cocheePossible)}
          data-autopilot-avatar-case
          className="mt-0.5"
        />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-gray-300">Mon avatar</span>
          <span className="block text-[11px] text-gray-500">Votre avatar parlant, seul ou combiné à vos rushes et aux médias stock.</span>
        </span>
        {pret === true && <MiniatureAvatar vignette={vignette} className="w-9 h-9 ml-auto" />}
      </label>

      {etat === 'chargement' && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-500" data-autopilot-avatar-etat="chargement">
          <Loader2 className="w-3 h-3 animate-spin" /> Vérification de votre avatar…
        </p>
      )}
      {pret === true && (
        <p className="flex items-start gap-1.5 text-[11px] text-emerald-400" data-autopilot-avatar-etat="pret">
          <Check className="w-3 h-3 mt-0.5 shrink-0" />
          {coche
            ? 'Votre avatar parlant (sur votre voix clonée) prend place dans la séquence Vidéo, avec vos autres sources. Facturé en plus du rendu, à chaque montage.'
            : 'Votre avatar est prêt.'}
        </p>
      )}
      {pret !== true && etat !== 'chargement' && (
        <div className="space-y-1" data-autopilot-avatar-etat="non-pret">
          <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
            <span><span className="font-medium">Aucun avatar prêt.</span>{raison ? ` ${raison}` : ''}</span>
          </p>
          <Link
            href="/dashboard/avatar"
            data-autopilot-avatar-configurer
            className="inline-block text-[11px] text-purple-300 hover:text-purple-200 underline underline-offset-2"
          >
            Configurer mon avatar
          </Link>
        </div>
      )}
    </div>
  );
}
