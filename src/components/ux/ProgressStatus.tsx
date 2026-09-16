'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Check, XCircle, Loader2 } from 'lucide-react';

/**
 * LA progression de Studiio — une seule forme pour toute opération longue
 * (cahier UX, Annexe A).
 *
 * Règle absolue : le composant N'INVENTE JAMAIS un pourcentage. Il affiche
 * `pourcentage` si l'appelant en tient un RÉEL (octets transférés, frames
 * rendues) ; sinon la barre est indéterminée. Le seul chiffre qu'il calcule
 * est la progression du WORKFLOW — étapes terminées / total — parce qu'elle
 * repose sur des étapes réelles données par l'appelant, et il la nomme
 * séparément (« Progression du workflow ») pour ne jamais la confondre avec
 * la progression de l'opération courante.
 *
 * Le temps écoulé est reconstruit depuis `debutLe` (un horodatage, de
 * préférence serveur) : il survit donc au rechargement de la page. L'estimé
 * restant n'est affiché que si l'appelant le fournit — c'est à lui de ne le
 * fournir que quand il est mesuré.
 */

export type StatutProgression = 'en_cours' | 'succes' | 'info' | 'avertissement' | 'erreur';
export type EtatEtapeProgression = 'terminee' | 'courante' | 'a_venir' | 'echouee';

export interface EtapeProgression { libelle: string; etat: EtatEtapeProgression }
export interface ActionProgression { libelle: string; onClick: () => void; principale?: boolean }

export interface ProgressStatusProps {
  titre: string;
  statut: StatutProgression;
  description?: string;
  /** Pourcentage RÉEL de l'opération courante (0–100). Absent = indéterminé. */
  pourcentage?: number;
  /** Position dans le workflow, si l'appelant ne fournit pas `etapes`. */
  etapeCourante?: number;
  totalEtapes?: number;
  /** Les étapes réelles : la progression du workflow en découle (terminées / total). */
  etapes?: EtapeProgression[];
  /** Détail de l'étape courante : « Rush 11 sur 24 », « 34,2 Mo / 46,8 Mo ». */
  detail?: string;
  /** Début de l'opération (ms epoch ou ISO) : « Durée écoulée : 01:42 », mis à jour chaque seconde. */
  debutLe?: number | string;
  /** Estimé restant, DÉJÀ formaté par l'appelant, et seulement s'il est mesuré. */
  resteEstime?: string;
  /** En échec : où, pourquoi, quoi faire. */
  echec?: { etape?: string; motif: string; actions?: ActionProgression[] };
  /** Terminé : l'action suivante. */
  suite?: ActionProgression[];
  /** Mobile : trois lignes et une barre fine. */
  compact?: boolean;
  /** Phrase de rassurance sous la barre (par défaut selon le statut). */
  note?: string | null;
  className?: string;
  children?: ReactNode;
}

const ACCENT = '#7C3AED';

export function formaterDuree(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Terminées / total, arrondi — la seule arithmétique du composant. */
export function pourcentageWorkflow(etapes: readonly EtapeProgression[]): number | null {
  if (etapes.length === 0) return null;
  const terminees = etapes.filter((e) => e.etat === 'terminee').length;
  return Math.round((terminees / etapes.length) * 100);
}

function borne(p: number): number {
  if (!Number.isFinite(p)) return 0;
  return Math.min(100, Math.max(0, Math.round(p)));
}

function useDureeEcoulee(debutLe?: number | string): string | null {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (debutLe === undefined) return;
    const id = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(id);
  }, [debutLe]);
  if (debutLe === undefined) return null;
  const t = typeof debutLe === 'number' ? debutLe : new Date(debutLe).getTime();
  if (!Number.isFinite(t)) return null;
  return formaterDuree(maintenant - t);
}

export default function ProgressStatus({
  titre, statut, description, pourcentage, etapeCourante, totalEtapes, etapes, detail, debutLe, resteEstime,
  echec, suite, compact = false, note, className = '', children,
}: ProgressStatusProps) {
  const ecoulee = useDureeEcoulee(debutLe);
  const determinee = statut === 'succes' ? true : typeof pourcentage === 'number';
  const valeur = statut === 'succes' ? 100 : determinee ? borne(pourcentage as number) : null;
  const workflow = etapes ? pourcentageWorkflow(etapes) : null;
  const total = etapes?.length ?? totalEtapes;
  const courante = etapes ? etapes.findIndex((e) => e.etat === 'courante' || e.etat === 'echouee') + 1 || undefined : etapeCourante;
  const enCours = statut === 'en_cours' || statut === 'info';
  const couleurBarre = statut === 'erreur' ? '#EF4444' : statut === 'avertissement' ? '#F59E0B' : statut === 'succes' ? '#10B981' : ACCENT;
  const noteAffichee = note === null ? null : note ?? (enCours ? 'Cette page se met à jour automatiquement.' : null);

  return (
    <section
      data-progress-status={statut}
      data-progress-determinee={determinee ? 'oui' : 'non'}
      className={`rounded-xl border border-gray-800 bg-gray-900/60 ${compact ? 'p-3 space-y-2' : 'p-4 space-y-3'} ${className}`}
      aria-live="polite"
    >
      {/* Ligne de titre : pourcentage réel (s'il existe) + titre + position */}
      <div className="flex items-baseline gap-3 min-w-0">
        {valeur !== null ? (
          <span data-progress-pourcentage className={`${compact ? 'text-xl' : 'text-2xl'} font-bold tabular-nums text-white`}>{valeur} %</span>
        ) : enCours ? (
          <Loader2 className="w-5 h-5 animate-spin text-purple-300 flex-shrink-0" aria-hidden />
        ) : statut === 'erreur' ? (
          <XCircle className="w-5 h-5 text-red-300 flex-shrink-0" aria-hidden />
        ) : (
          <Check className="w-5 h-5 text-emerald-300 flex-shrink-0" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate" data-progress-titre>{statut === 'succes' && valeur === 100 ? `✓ ${titre}` : titre}</p>
          {(courante !== undefined && total !== undefined) && (
            <p className="text-[11px] text-gray-400" data-progress-etape>
              Étape {courante} sur {total}{etapes && courante ? ` — ${etapes[courante - 1]?.libelle ?? ''}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* La barre : déterminée (valeur réelle) ou indéterminée (animation) */}
      <div
        role="progressbar"
        aria-label={titre}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(valeur !== null ? { 'aria-valuenow': valeur } : { 'aria-busy': enCours || undefined })}
        aria-valuetext={valeur !== null ? `${valeur} %` : enCours ? 'progression inconnue, en cours' : undefined}
        className={`w-full rounded-full overflow-hidden ${compact ? 'h-1' : 'h-1.5'}`}
        style={{ backgroundColor: '#1F2937' }}
        data-progress-barre={valeur !== null ? 'determinee' : 'indeterminee'}
      >
        {valeur !== null ? (
          <div className="h-full rounded-full" style={{ width: `${valeur}%`, backgroundColor: couleurBarre, transition: 'width 300ms ease-out' }} />
        ) : enCours ? (
          <div className="h-full w-1/3 rounded-full animate-pulse" style={{ backgroundColor: couleurBarre }} />
        ) : null}
      </div>

      {description && !compact && <p className="text-[13px] text-gray-300" data-progress-description>{description}</p>}

      {/* Le workflow : étapes réelles, ✓ ● ○ ✕ — et son propre pourcentage, nommé */}
      {etapes && etapes.length > 0 && !compact && (
        <div className="space-y-1.5">
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" data-progress-etapes>
            {etapes.map((e, i) => (
              <li key={`${e.libelle}-${i}`} data-progress-etape-etat={e.etat} className={`flex items-center gap-1 ${e.etat === 'terminee' ? 'text-emerald-300' : e.etat === 'courante' ? 'text-white font-medium' : e.etat === 'echouee' ? 'text-red-300' : 'text-gray-500'}`}>
                {e.etat === 'terminee' && <Check className="w-3 h-3" aria-hidden />}
                {e.etat === 'courante' && <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: ACCENT }} aria-hidden />}
                {e.etat === 'a_venir' && <span className="w-2.5 h-2.5 rounded-full border border-gray-600 inline-block" aria-hidden />}
                {e.etat === 'echouee' && <XCircle className="w-3 h-3" aria-hidden />}
                <span className="sr-only">{e.etat === 'terminee' ? 'terminée : ' : e.etat === 'courante' ? 'en cours : ' : e.etat === 'echouee' ? 'échouée : ' : 'à venir : '}</span>
                {e.libelle}
              </li>
            ))}
          </ol>
          {workflow !== null && (
            <p className="text-[11px] text-gray-400" data-progress-workflow={workflow}>
              Progression du workflow : <span className="text-gray-200 tabular-nums">{workflow} %</span>
              {valeur === null && enCours && <span> — opération en cours : progression inconnue</span>}
            </p>
          )}
        </div>
      )}

      {/* Détail, temps écoulé, estimé */}
      {(detail || ecoulee || resteEstime) && (
        <p className="text-[11px] text-gray-400 flex flex-wrap gap-x-3 gap-y-0.5" data-progress-temps>
          {detail && <span data-progress-detail>{detail}</span>}
          {ecoulee && enCours && <span data-progress-ecoulee>Durée écoulée : <span className="tabular-nums text-gray-200">{ecoulee}</span></span>}
          {resteEstime && enCours && <span data-progress-reste>Temps estimé restant : {resteEstime}</span>}
        </p>
      )}

      {/* Échec : où, pourquoi, quoi faire — la barre reste où elle était */}
      {statut === 'erreur' && echec && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-[13px] text-red-100 space-y-2" role="alert" data-progress-echec>
          <p className="font-medium">Échec{echec.etape ? ` à l’étape « ${echec.etape} »` : ''}</p>
          {etapes && <p className="text-[11px] opacity-90">Progression avant interruption : {etapes.filter((e) => e.etat === 'terminee').length}/{etapes.length} étapes</p>}
          <p className="text-[12px] opacity-90">Motif : {echec.motif}</p>
          {echec.actions && echec.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {echec.actions.map((a) => (
                <button key={a.libelle} type="button" onClick={a.onClick} className={`${a.principale ? 'button-primary' : 'button-ghost'} text-[12px] px-3 py-1.5`} data-progress-action={a.libelle}>{a.libelle}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Terminé : la suite */}
      {statut === 'succes' && suite && suite.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1" data-progress-suite>
          {suite.map((a) => (
            <button key={a.libelle} type="button" onClick={a.onClick} className={`${a.principale ? 'button-primary' : 'button-ghost'} text-[12px] px-3 py-1.5`} data-progress-action={a.libelle}>{a.libelle}</button>
          ))}
        </div>
      )}

      {children}
      {noteAffichee && !compact && <p className="text-[11px] text-gray-500">{noteAffichee}</p>}
    </section>
  );
}
