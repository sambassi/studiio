'use client';

/**
 * A_6c — LA VOIX-OFF À L'ÉCRAN.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ C'EST LA PERSONNE QUI ÉCRIT, ET ELLE SEULE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Il n'y a pas de bouton « écrire mon script pour moi ». Faire composer une
 * phrase par une machine, puis la faire dire par une voix clonée, c'est
 * fabriquer une déclaration que personne n'a faite — et c'est vrai même quand
 * la vidéo s'appelle « témoignage ». L'absence de ce bouton n'est pas un
 * manque : c'est le réglage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UNE VOIX ENREGISTRÉE N'EST PAS UNE VOIX IMPOSÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le panneau distingue deux gestes : ENREGISTRER une voix-off pour le compte,
 * et l'UTILISER dans cette vidéo-ci. Générer ne coche rien tout seul — sinon
 * un essai changerait le montage en cours sans qu'on l'ait demandé.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic, Loader2, Play, Pause, Trash2, Check, AlertTriangle,
} from 'lucide-react';
import {
  fetchElevenLabsVoices, type ElevenLabsTtsVoice,
} from '@/lib/types/voice';
import { SCRIPT_MAX, type MotVoix } from '@/lib/voice/synthese';
import { BUCKET_MUSIQUE } from '@/lib/autopilot/analyse/recette-audio';

/** Ce que le serveur garde pour le compte. */
export interface VoixOffEcran {
  cle: string;
  empreinte: string;
  dureeMs: number;
  script: string;
  voiceId: string;
  creeeLe: string;
  mots: readonly MotVoix[];
}

/** L'adresse d'écoute — le proxy de stockage, comme pour les musiques. */
export function adresseVoix(cle: string): string {
  return `/storage/v1/object/public/${BUCKET_MUSIQUE}/${
    cle.split('/').map(encodeURIComponent).join('/')}`;
}

export interface PanneauVoixOffProps {
  /** La voix-off enregistrée du compte, ou `null`. */
  voixOff: VoixOffEcran | null;
  /** `true` quand cette vidéo l'emploie. */
  utilisee: boolean;
  onUtiliser: (utiliser: boolean) => void;
  onEnregistree: (v: VoixOffEcran | null) => void;
  desactive?: boolean;
}

export default function PanneauVoixOff({
  voixOff, utilisee, onUtiliser, onEnregistree, desactive = false,
}: PanneauVoixOffProps) {
  const [voix, setVoix] = useState<readonly ElevenLabsTtsVoice[]>([]);
  const [voiceId, setVoiceId] = useState<string>('');
  const [script, setScript] = useState(voixOff?.script ?? '');
  const [travaille, setTravaille] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ecoute, setEcoute] = useState(false);
  const lecteur = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let vivant = true;
    void fetchElevenLabsVoices().then((v) => {
      if (!vivant) return;
      setVoix(v);
      /* ⚠️ LA VOIX CLONÉE D'ABORD. C'est celle qu'on vient chercher ; la
         proposer en dernier derrière un catalogue obligerait à la trouver. */
      const sienne = v.find((x) => x.cloned);
      setVoiceId((actuel) => actuel || voixOff?.voiceId || sienne?.id || v[0]?.id || '');
    });
    return () => { vivant = false; };
  }, [voixOff?.voiceId]);

  const clonees = useMemo(() => voix.filter((v) => v.cloned), [voix]);
  const catalogue = useMemo(() => voix.filter((v) => !v.cloned), [voix]);

  const generer = async () => {
    if (travaille || script.trim().length === 0 || voiceId === '') return;
    setErreur(null);
    setTravaille(true);
    try {
      const r = await fetch('/api/autopilot/voix-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ script, voiceId }),
      });
      const j = await r.json();
      if (j?.ok && j.voixOff) {
        /* ⚠️ GÉNÉRER NE COCHE RIEN. La voix est enregistrée pour le compte ;
           l'employer dans CETTE vidéo reste un second geste. */
        onEnregistree(j.voixOff as VoixOffEcran);
      } else {
        setErreur(typeof j?.error === 'string' ? j.error : 'La voix n’a pas pu être générée.');
      }
    } catch {
      setErreur('La voix n’a pas pu être générée. Réessaie.');
    } finally {
      setTravaille(false);
    }
  };

  const retirer = async () => {
    setErreur(null);
    try {
      const r = await fetch('/api/autopilot/voix-off', {
        method: 'DELETE', credentials: 'same-origin',
      });
      const j = await r.json();
      if (j?.ok) { onEnregistree(null); onUtiliser(false); }
      else setErreur('La voix n’a pas pu être retirée.');
    } catch {
      setErreur('La voix n’a pas pu être retirée.');
    }
  };

  const basculerEcoute = () => {
    const a = lecteur.current;
    if (!a || !voixOff) return;
    if (ecoute) { a.pause(); setEcoute(false); return; }
    a.src = adresseVoix(voixOff.cle);
    void a.play().then(() => setEcoute(true)).catch(() => setEcoute(false));
  };

  const secondes = voixOff ? Math.round(voixOff.dureeMs / 1000) : 0;

  return (
    <section className="space-y-2" data-panneau-voix-off>
      <p className="text-[11px] font-medium text-gray-400">Voix-off</p>

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={lecteur}
        preload="none"
        data-voix-lecteur
        onEnded={() => setEcoute(false)}
        onPause={() => setEcoute(false)}
      />

      {voix.length === 0 ? (
        <p data-voix-aucune className="text-[10px] text-gray-500">
          Aucune voix disponible. Clone ta voix depuis l’onglet Avatar pour l’utiliser ici.
        </p>
      ) : (
        <label className="block text-[10px] text-gray-500">
          Voix
          <select
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            disabled={desactive || travaille}
            data-voix-selecteur
            className="mt-0.5 w-full rounded-lg border border-gray-800 bg-gray-900/60 px-2 py-1
              text-[11px] text-gray-200 focus:border-purple-500/50 focus:outline-none"
          >
            {clonees.length > 0 && (
              <optgroup label="Ma voix">
                {clonees.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </optgroup>
            )}
            {catalogue.length > 0 && (
              <optgroup label="Catalogue">
                {catalogue.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}

      <label className="block text-[10px] text-gray-500">
        Ce que ta voix doit dire
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value.slice(0, SCRIPT_MAX))}
          rows={3}
          disabled={desactive || travaille}
          placeholder="Écris ton texte. Studiio ne l’écrit jamais à ta place."
          data-voix-script
          className="mt-0.5 w-full resize-y rounded-lg border border-gray-800 bg-gray-900/60
            px-2 py-1 text-[11px] text-gray-200 placeholder:text-gray-600
            focus:border-purple-500/50 focus:outline-none"
        />
        <span className="text-[9px] text-gray-600">
          {script.length} / {SCRIPT_MAX}
        </span>
      </label>

      <button
        type="button"
        onClick={() => void generer()}
        disabled={desactive || travaille || script.trim().length === 0 || voiceId === ''}
        data-voix-generer
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border
          border-dashed border-gray-700 px-2 py-1.5 text-[11px] text-gray-300 transition
          hover:border-purple-500/50 hover:text-purple-200 disabled:opacity-40
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
      >
        {travaille ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Génération de la voix…
          </>
        ) : (
          <>
            <Mic className="h-3 w-3" aria-hidden="true" />
            {voixOff ? 'Regénérer la voix' : 'Générer la voix'}
          </>
        )}
      </button>

      {erreur && (
        <p data-voix-erreur className="flex items-start gap-1 text-[10px] text-amber-400">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          {erreur}
        </p>
      )}

      {voixOff && (
        <div
          data-voix-enregistree
          className={`rounded-lg border px-2 py-1.5 ${
            utilisee ? 'border-purple-500/70 bg-purple-500/[0.06]' : 'border-gray-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={basculerEcoute}
              aria-label={ecoute ? 'Arrêter l’écoute' : 'Écouter la voix'}
              data-voix-ecouter
              className="shrink-0 rounded-full bg-gray-800 p-1.5 text-gray-300
                transition hover:text-purple-300"
            >
              {ecoute
                ? <Pause className="h-3 w-3" aria-hidden="true" />
                : <Play className="h-3 w-3" aria-hidden="true" />}
            </button>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] text-gray-200">{voixOff.script}</span>
              <span className="block text-[9px] text-gray-500">
                {secondes} s
                {voixOff.mots.length > 0
                  ? ` · ${voixOff.mots.length} mots datés — sous-titrable`
                  : ' · sans minutage — non sous-titrable'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void retirer()}
              aria-label="Retirer la voix-off"
              data-voix-retirer
              className="shrink-0 rounded-full p-1 text-gray-400 hover:text-red-300"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          {/* ⚠️ ENREGISTRER ET UTILISER SONT DEUX GESTES. Générer ne change
              pas le montage en cours ; ce bouton, si. */}
          <button
            type="button"
            onClick={() => onUtiliser(!utilisee)}
            aria-pressed={utilisee}
            disabled={desactive}
            data-voix-utiliser
            className={`mt-1.5 flex w-full items-center justify-center gap-1 rounded-lg
              px-2 py-1 text-[10px] transition ${
              utilisee
                ? 'bg-purple-500/20 text-purple-300'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {utilisee && <Check className="h-3 w-3" aria-hidden="true" />}
            {utilisee ? 'Utilisée dans cette vidéo' : 'Utiliser dans cette vidéo'}
          </button>
        </div>
      )}
    </section>
  );
}
