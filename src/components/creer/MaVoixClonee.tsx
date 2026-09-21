'use client';

import Link from 'next/link';
import { Check, Loader2, Mic } from 'lucide-react';
import type { TtsVoice } from '@/lib/tts/edge-tts-client';

/**
 * MA VOIX CLONÉE — la carte de Créer > Audio.
 *
 * Vu en prod (2026-09-21) : le compte avait « Bassi (ma voix) » en tête de
 * `/api/tts/elevenlabs`, et l'étape Audio affichait « Henri » — la voix
 * clonée était noyée dans un sélecteur plat de ~130 entrées, sans rien qui
 * la distingue. L'Autopilote, lui, a un bloc dédié : c'est LA différence
 * entre les deux parcours. Cette carte la comble.
 *
 * Elle ne charge rien : les voix viennent d'`AudioStudioPanel`, qui les a
 * déjà demandées (`fetchCustomVoices`) — un second appel proposerait une
 * autre liste que le sélecteur juste en dessous. Elle ne clone rien non
 * plus : seul `POST /api/voice/clone` le fait, depuis la page Mon avatar,
 * vers laquelle le lien renvoie.
 */

/** Chemin du parcours EXISTANT de gestion de la voix (section « Ma voix » de Mon avatar). */
export const LIEN_GERER_MA_VOIX = '/dashboard/avatar#ma-voix';

export interface MaVoixCloneeProps {
  /** Toutes les voix listées à la volée ; la carte ne garde que `cloned: true`. */
  voices: ReadonlyArray<TtsVoice>;
  /** true tant que `fetchCustomVoices()` n'a pas répondu. */
  loading: boolean;
  /** Voix TTS courante — celle du wizard (une seule voix pour tout). */
  voiceId: string;
  /** Remonte le choix au parent, qui l'applique au TTS global ET aux voix par séquence. */
  onVoiceIdChange: (id: string) => void;
}

export default function MaVoixClonee({ voices, loading, voiceId, onVoiceIdChange }: MaVoixCloneeProps) {
  const clonees = voices.filter((v) => v.cloned === true);

  return (
    <div data-ma-voix-clonee className="rounded-lg border border-purple-500/30 bg-purple-500/[0.06] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-purple-200">
          <Mic size={12} className="text-purple-400" /> Ma voix clonée
        </div>
        <Link
          href={LIEN_GERER_MA_VOIX}
          data-ma-voix-clonee-gerer
          className="text-[10px] text-purple-300 underline underline-offset-2 hover:text-white"
        >
          Gérer / cloner ma voix
        </Link>
      </div>

      {loading ? (
        <div data-ma-voix-clonee-chargement className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <Loader2 size={12} className="animate-spin" /> Recherche de votre voix clonée…
        </div>
      ) : clonees.length === 0 ? (
        <p data-ma-voix-clonee-aucune className="text-[11px] text-gray-400">
          Aucune voix clonée sur ce compte.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {clonees.map((v) => {
            const utilisee = v.id === voiceId;
            return (
              <li
                key={v.id}
                data-ma-voix-clonee-voix={v.id}
                data-utilisee={utilisee ? 'true' : 'false'}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                  utilisee ? 'border-purple-500/60 bg-gray-800' : 'border-gray-800 bg-gray-900/60'
                }`}
              >
                <span className="text-sm" aria-hidden>{v.flag}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-xs font-medium text-white">{v.name}</span>
                  <span className="mt-0.5 inline-flex items-center gap-1.5 text-[9px]">
                    <span className="rounded bg-purple-500/20 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-purple-200">
                      voix clonée
                    </span>
                    {utilisee && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-300">
                        <Check size={10} /> utilisée
                      </span>
                    )}
                  </span>
                </span>
                {!utilisee && (
                  <button
                    type="button"
                    onClick={() => onVoiceIdChange(v.id)}
                    className="flex-shrink-0 rounded-md bg-purple-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-purple-500 transition"
                  >
                    Utiliser ma voix
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
