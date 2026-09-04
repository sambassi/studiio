'use client';

import { useState } from 'react';
import {
  Music, Volume2, VolumeX, Check, Loader2, RotateCcw, Save, Trash2,
} from 'lucide-react';
import MenuActions, { type ActionMenu } from '@/components/ui/MenuActions';
import { MediaLibrary } from '@/components/shared/MediaLibrary';
import {
  BUCKET_MUSIQUE, RECETTE_AUDIO_DEFAUT, arrondirVolume, type RecetteAudio,
} from '@/lib/autopilot/analyse/recette-audio';

/**
 * LOT 2A — LES REGLAGES AUDIO, AVANT « Creer ma video ».
 *
 * ---------------------------------------------------------------------------
 * ⚠️ AUCUN CONTROLE QUI NE SOIT REELLEMENT RENDU
 * ---------------------------------------------------------------------------
 *
 * Les quatre reglages affiches ici — musique, volume musique, son original,
 * volume du son original — sont exactement ceux que `argumentsRendu` sait
 * appliquer, et rien d'autre. Pas de fondu reglable, pas d'egaliseur, pas de
 * ducking : le moteur ne les honore pas, ils ne s'affichent pas.
 *
 * ---------------------------------------------------------------------------
 * DEUX GESTES DISTINCTS, ET C'EST VOULU
 * ---------------------------------------------------------------------------
 *
 * Modifier un curseur ne change QUE la video en cours de creation : la recette
 * part dans le corps de `POST /rendu`. Les habitudes de l'utilisateur ne
 * bougent que s'il clique « Enregistrer comme reglage par defaut », qui ecrit
 * dans `designStyle.audio`. Un reglage d'essai ne doit pas s'installer sans
 * qu'on l'ait demande.
 */

/** Le volume affiche : une part interne, un pourcentage a l'ecran. */
function pourcent(v: number): number {
  return Math.round(v * 100);
}

function Curseur({ libelle, valeur, onChange, desactive }: {
  libelle: string;
  valeur: number;
  onChange: (v: number) => void;
  desactive?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${desactive ? 'opacity-40' : ''}`}>
      <span className="w-24 shrink-0 text-[11px] text-gray-400">{libelle}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pourcent(valeur)}
        disabled={desactive}
        onChange={(e) => onChange(arrondirVolume(Number(e.target.value) / 100))}
        className="min-w-0 flex-1 accent-purple-500"
      />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-gray-300">
        {pourcent(valeur)} %
      </span>
    </label>
  );
}

export interface ReglagesAudioProps {
  /** La recette en cours d'edition. */
  valeur: RecetteAudio;
  onChange: (recette: RecetteAudio) => void;
  /** Enregistre la recette comme defaut du compte. Absent = bouton masque. */
  onEnregistrerDefaut?: (recette: RecetteAudio) => Promise<boolean>;
  desactive?: boolean;
}

export default function ReglagesAudio({
  valeur, onChange, onEnregistrerDefaut, desactive,
}: ReglagesAudioProps) {
  const [mediatheque, setMediatheque] = useState(false);
  const [nomMusique, setNomMusique] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<'inactif' | 'encours' | 'fait'>('inactif');

  const majuscule = (r: Partial<RecetteAudio>) => {
    setEnregistrement('inactif');
    onChange({ ...valeur, ...r });
  };

  /**
   * ⚠️ LA MEDIATHEQUE REND UNE URL ; LE MOTEUR VEUT UNE CLE.
   *
   * `MediaLibrary` a ete ecrite pour des `<img>` et des `<audio>`, elle rend
   * donc l'URL publique. La recette, elle, ne transporte JAMAIS d'URL — c'est
   * la garde qui empeche le moteur d'aller chercher une adresse arbitraire. On
   * retrouve la cle a partir du chemin de stockage, qui est la fin de cette
   * URL, et le serveur reverifie de toute facon qu'elle est bien dans le
   * perimetre du compte.
   */
  const choisir = (url: string, nom: string) => {
    const marque = `/storage/v1/object/public/${BUCKET_MUSIQUE}/`;
    const i = url.indexOf(marque);
    if (i < 0) return;
    const cle = decodeURIComponent(url.slice(i + marque.length).split('?')[0]);
    if (!cle) return;
    setNomMusique(nom);
    majuscule({ musique: { bucket: BUCKET_MUSIQUE, cle } });
    setMediatheque(false);
  };

  const nomAffiche = valeur.musique === null
    ? null
    : nomMusique ?? valeur.musique.cle.split('/').pop() ?? 'musique';

  /**
   * ⚠️ TOUT CE QUI N'EST PAS UN CURSEUR PART DANS LE « ⋯ ».
   *
   * Choisir, retirer, enregistrer un defaut, reinitialiser : quatre gestes
   * rares. En boutons permanents, ils pesaient plus lourd que les deux
   * reglages qu'on utilise vraiment. Les curseurs restent, eux, parce qu'ils
   * changent le resultat a chaque video.
   */
  const actions: ActionMenu[] = [
    {
      libelle: valeur.musique === null ? 'Choisir une musique' : 'Changer la musique',
      icone: <Music className="h-3.5 w-3.5" />,
      onClick: () => setMediatheque(true),
      desactive,
    },
    {
      libelle: 'Retirer la musique',
      icone: <Trash2 className="h-3.5 w-3.5" />,
      onClick: () => { setNomMusique(null); majuscule({ musique: null }); },
      desactive: desactive || valeur.musique === null,
    },
    ...(onEnregistrerDefaut ? [{
      libelle: enregistrement === 'fait'
        ? 'Réglage par défaut enregistré'
        : 'Enregistrer comme réglage par défaut',
      icone: enregistrement === 'fait'
        ? <Check className="h-3.5 w-3.5" />
        : <Save className="h-3.5 w-3.5" />,
      desactive: desactive || enregistrement === 'encours',
      onClick: async () => {
        setEnregistrement('encours');
        const ok = await onEnregistrerDefaut(valeur);
        setEnregistrement(ok ? 'fait' : 'inactif');
      },
    } as ActionMenu] : []),
    {
      libelle: 'Réinitialiser',
      icone: <RotateCcw className="h-3.5 w-3.5" />,
      onClick: () => { setNomMusique(null); onChange(RECETTE_AUDIO_DEFAUT); setEnregistrement('inactif'); },
      desactive,
    },
  ];

  return (
    <section className="space-y-2" data-reglages-audio>
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-500">
          <Music className="h-3 w-3" aria-hidden="true" /> Audio
        </h4>
        <span className="flex items-center gap-1">
          {enregistrement === 'encours' && (
            <Loader2 className="h-3 w-3 animate-spin text-gray-500" aria-hidden="true" />
          )}
          {enregistrement === 'fait' && (
            <Check className="h-3 w-3 text-gray-400" aria-hidden="true" />
          )}
          <MenuActions
            compact
            marqueur="audio"
            etiquette="Actions audio"
            actions={actions}
          />
        </span>
      </div>

      {/* La musique en une ligne : son nom, ou l'absence dite simplement. */}
      <p
        className="flex items-center gap-1.5 truncate text-[12px] text-gray-300"
        title={nomAffiche ?? undefined}
        data-audio-musique={valeur.musique === null ? 'aucune' : 'choisie'}
      >
        <Music className="h-3 w-3 shrink-0 text-gray-500" aria-hidden="true" />
        <span className="truncate">{nomAffiche ?? 'Aucune musique'}</span>
      </p>

      {/* ⚠️ Le volume ne s'affiche QUE s'il y a une musique : un curseur sans
          source ne reglerait rien, et le moteur l'ignore d'ailleurs. */}
      {valeur.musique !== null && (
        <Curseur
          libelle="Musique"
          valeur={valeur.volumeMusique}
          desactive={desactive}
          onChange={(v) => majuscule({ volumeMusique: v })}
        />
      )}

      {/* ── Le son original ───────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[11px] text-gray-400">Son original</span>
        <button
          type="button"
          disabled={desactive}
          onClick={() => majuscule({ sonOriginal: !valeur.sonOriginal })}
          aria-pressed={valeur.sonOriginal}
          data-audio-son-original={valeur.sonOriginal ? 'on' : 'off'}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]
            font-medium transition-colors focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-purple-500 disabled:opacity-40 ${valeur.sonOriginal
              ? 'border-purple-500/50 bg-purple-500/10 text-purple-200'
              : 'border-white/10 text-gray-500 hover:text-gray-300'}`}
        >
          {valeur.sonOriginal
            ? <Volume2 className="h-3 w-3" aria-hidden="true" />
            : <VolumeX className="h-3 w-3" aria-hidden="true" />}
          {valeur.sonOriginal ? 'ON' : 'OFF'}
        </button>
      </div>
      {/* Même règle que la musique : pas de curseur sans source. */}
      {valeur.sonOriginal && (
        <Curseur
          libelle="Volume original"
          valeur={valeur.volumeSonOriginal}
          desactive={desactive}
          onChange={(v) => majuscule({ volumeSonOriginal: v })}
        />
      )}

      {mediatheque && (
        <MediaLibrary
          isOpen
          mediaType="audio"
          onClose={() => setMediatheque(false)}
          onSelect={choisir}
        />
      )}
    </section>
  );
}

/** Le point de depart de l'ecran quand le compte n'a rien enregistre. */
export const RECETTE_ECRAN_DEFAUT = RECETTE_AUDIO_DEFAUT;
