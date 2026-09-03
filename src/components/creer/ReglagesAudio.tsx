'use client';

import { useState } from 'react';
import { Music, Volume2, VolumeX, Check, Loader2 } from 'lucide-react';
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
    <label className={`block ${desactive ? 'opacity-40' : ''}`}>
      <span className="flex items-center justify-between text-[11px] text-gray-400">
        {libelle}
        <span className="tabular-nums text-gray-300">{pourcent(valeur)} %</span>
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pourcent(valeur)}
        disabled={desactive}
        onChange={(e) => onChange(arrondirVolume(Number(e.target.value) / 100))}
        className="mt-1 w-full accent-purple-500"
      />
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

  return (
    <section className="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-200">
        <Music className="h-3.5 w-3.5 text-cyan-400" /> Audio
      </h4>

      {/* ── La musique ────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-gray-400">Musique</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={desactive}
            onClick={() => { setNomMusique(null); majuscule({ musique: null }); }}
            className={`rounded px-2 py-1 text-[11px] ${valeur.musique === null
              ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
          >
            Aucune
          </button>
          <button
            type="button"
            disabled={desactive}
            onClick={() => setMediatheque(true)}
            className={`rounded px-2 py-1 text-[11px] ${valeur.musique !== null
              ? 'bg-purple-600 text-white' : 'bg-white/5 text-gray-300 hover:bg-white/10'}`}
          >
            {valeur.musique === null ? 'Choisir une musique' : 'Changer'}
          </button>
        </div>
        {valeur.musique !== null && (
          <p className="truncate text-[11px] text-gray-400" title={nomMusique ?? valeur.musique.cle}>
            {nomMusique ?? valeur.musique.cle.split('/').pop()}
          </p>
        )}
      </div>

      {/* ⚠️ Le volume ne s'affiche QUE s'il y a une musique : un curseur sans
          source ne reglerait rien, et le moteur l'ignore d'ailleurs. */}
      {valeur.musique !== null && (
        <Curseur
          libelle="Volume musique"
          valeur={valeur.volumeMusique}
          desactive={desactive}
          onChange={(v) => majuscule({ volumeMusique: v })}
        />
      )}

      {/* ── Le son original ───────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <button
          type="button"
          disabled={desactive}
          onClick={() => majuscule({ sonOriginal: !valeur.sonOriginal })}
          className="flex w-full items-center justify-between rounded bg-white/5 px-2 py-1.5 text-[11px] text-gray-200 hover:bg-white/10"
        >
          <span className="flex items-center gap-1.5">
            {valeur.sonOriginal
              ? <Volume2 className="h-3.5 w-3.5 text-emerald-400" />
              : <VolumeX className="h-3.5 w-3.5 text-gray-500" />}
            Son original du rush
          </span>
          <span className={valeur.sonOriginal ? 'text-emerald-400' : 'text-gray-500'}>
            {valeur.sonOriginal ? 'Activé' : 'Désactivé'}
          </span>
        </button>
        {/* Même règle que la musique : pas de curseur sans source. */}
        {valeur.sonOriginal && (
          <Curseur
            libelle="Volume son original"
            valeur={valeur.volumeSonOriginal}
            desactive={desactive}
            onChange={(v) => majuscule({ volumeSonOriginal: v })}
          />
        )}
      </div>

      {onEnregistrerDefaut && (
        <button
          type="button"
          disabled={desactive || enregistrement === 'encours'}
          onClick={async () => {
            setEnregistrement('encours');
            const ok = await onEnregistrerDefaut(valeur);
            setEnregistrement(ok ? 'fait' : 'inactif');
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-white/10 px-2 py-1.5 text-[11px] text-gray-300 hover:bg-white/5"
        >
          {enregistrement === 'encours' && <Loader2 className="h-3 w-3 animate-spin" />}
          {enregistrement === 'fait' && <Check className="h-3 w-3 text-emerald-400" />}
          {enregistrement === 'fait' ? 'Réglage par défaut enregistré' : 'Enregistrer comme réglage par défaut'}
        </button>
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
