'use client';

/**
 * CINEMA IA — COMMENT LE FILM EST RACONTE : deux petites cartes, un seul choix.
 *
 * « Les personnages parlent »  : chacun dit ses repliques avec SA voix ; aucun narrateur.
 * « Une voix raconte l'histoire » : une voix off lit le recit ; les repliques ne sont pas lues.
 *
 * Deux modes EXCLUSIFS, pas de troisieme mode. Un film d'avant (sans mode) n'est jamais change en
 * silence : tant qu'aucune carte n'est choisie, il garde son ancien comportement et le dit.
 */
import { MessageSquare, Mic } from 'lucide-react';
import { useTranslations } from '@/i18n/client';

export type ModeAudio = 'personnages' | 'narrateur';

export const LIBELLES_MODE: Record<ModeAudio, { titre: string; phrase: string }> = {
  personnages: { titre: 'Les personnages parlent', phrase: 'Chacun dit ses répliques avec sa propre voix. Pas de narrateur : les actions restent muettes.' },
  narrateur: { titre: 'Une voix raconte l’histoire', phrase: 'Une voix off lit ton récit. Les répliques s’affichent mais ne sont pas lues.' },
};

export default function ModeAudioCartes({ valeur, surChoisir, historique = false, deduit = false }: {
  /** Le mode choisi ; `null` = aucun (film historique). */
  valeur: ModeAudio | null;
  surChoisir: (m: ModeAudio) => void;
  /** Film d'avant : on dit qu'il garde son ancien comportement tant qu'on ne choisit pas. */
  historique?: boolean;
  /** Le mode a ete propose d'apres le texte (aucune carte cliquee encore). */
  deduit?: boolean;
}) {
  const tUi = useTranslations('ui.componentsCinemaModeAudio');
  return (
    <section className="mt-4" aria-label={tUi('comment_ton_film_est_raconte')} data-mode-audio-cartes>
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        <Mic className="h-3.5 w-3.5 text-violet-400" aria-hidden="true" /> {tUi('comment_ton_film_est_raconte')}
      </h3>
      <div role="radiogroup" aria-label="Mode audio" className="grid gap-2 sm:grid-cols-2">
        {(['personnages', 'narrateur'] as const).map((m) => {
          const actif = valeur === m;
          const Icone = m === 'personnages' ? MessageSquare : Mic;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={actif}
              onClick={() => surChoisir(m)}
              data-mode-audio={m}
              className={`rounded-lg border p-3 text-left transition-colors ${actif ? 'border-violet-500/80 bg-violet-500/10 ring-1 ring-violet-500/40' : 'border-slate-700 bg-slate-900/40 hover:border-violet-500/50'}`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                <Icone className={`h-4 w-4 shrink-0 ${actif ? 'text-violet-300' : 'text-slate-400'}`} aria-hidden="true" /> {LIBELLES_MODE[m].titre}
              </span>
              <span className="mt-1 block text-[11px] leading-snug text-slate-400">{LIBELLES_MODE[m].phrase}</span>
            </button>
          );
        })}
      </div>
      {historique && valeur === null && (
        <p className="mt-1.5 text-[11px] text-slate-400" data-mode-historique>
          {tUi('ce_film_garde_son_ancien_reglage_audio')}
        </p>
      )}
      {deduit && valeur && <p className="mt-1.5 text-[11px] text-slate-500">{tUi('propose_d_apres_ton_texte_tu_peux_chan')}</p>}
    </section>
  );
}
