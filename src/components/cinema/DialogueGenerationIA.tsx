'use client';

/**
 * CINEMA IA — LA FENETRE « PREPARER L'IMAGE » : on regarde avant de creer, et on confirme.
 *
 * Un bouton qui ne reagit pas est le pire des defauts : cette fenetre s'ouvre TOUJOURS, au clic
 * sur « Preparer l'image avec l'IA » (comme sur l'etoile d'un visuel). Elle dit :
 *   - ce qui va etre cree (scene, visuel, description) ;
 *   - ce qui a ete verifie (style, personnages et photos de reference, points de l'histoire,
 *     disponibilite du moteur) ;
 *   - ce que cela coute (jamais debite avant le bouton « Confirmer ») ;
 *   - et, si quelque chose bloque, POURQUOI et QUOI FAIRE — le bouton de confirmation reste alors
 *     eteint. Elle ne decide de rien : le serveur re-verifie tout (plafonds, ecarts critiques,
 *     solde) et refuse seul ce qu'il doit refuser ; son message s'affiche ici.
 *
 * Le double clic est neutre : « Confirmer » s'eteint des le premier appel et se verrouille aussi
 * par une reference, avant meme que l'etat React ne soit rafraichi.
 */
import { useEffect, useRef } from 'react';
import { AlertTriangle, Check, Info, Loader2, Sparkles, X } from 'lucide-react';
import { useTranslations } from '@/i18n/client';

export interface Verification {
  /** `ok` : verifie ; `info` : a savoir, ne bloque rien ; `bloque` : empeche la creation. */
  etat: 'ok' | 'info' | 'bloque';
  texte: string;
  /** Un geste pour regler le point (ex. « Voir les points »). */
  action?: { libelle: string; surClic: () => void };
}

export interface DonneesDialogue {
  titre: string;
  /** « Scene 1 · NINA ENTRE SALLE — visuel 1 » */
  cible: string;
  /** Ce que le visuel montrera (la phrase du plan). */
  description: string;
  verifications: Verification[];
  /** « Coût estimé : 5 crédits » — ou « gratuit » en demonstration. */
  cout: string;
  /** Le mode simule n'est jamais presente comme une creation payante ni comme une vraie image. */
  payant: boolean;
  libelleConfirmer: string;
}

export default function DialogueGenerationIA({ donnees, enCours, erreur, surConfirmer, surAnnuler }: {
  donnees: DonneesDialogue;
  enCours: boolean;
  erreur: string | null;
  surConfirmer: () => void;
  surAnnuler: () => void;
}) {
  const tUi = useTranslations('ui.componentsCinemaDialogueGenerationIA');
  const verrou = useRef(false);
  const bloque = donnees.verifications.some((v) => v.etat === 'bloque');
  const premiereAction = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const touche = (e: KeyboardEvent) => { if (e.key === 'Escape' && !enCours) surAnnuler(); };
    document.addEventListener('keydown', touche);
    premiereAction.current?.focus();
    return () => document.removeEventListener('keydown', touche);
  }, [surAnnuler, enCours]);
  // Le verrou se libere quand l'appel est termine (succes ou echec) : on peut reessayer apres une erreur.
  useEffect(() => { if (!enCours) verrou.current = false; }, [enCours]);

  const confirmer = () => {
    if (bloque || enCours || verrou.current) return;
    verrou.current = true;
    surConfirmer();
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={donnees.titre}
      className="fixed inset-0 flex items-center justify-center bg-slate-950/80 p-3"
      style={{ zIndex: 70 }}
      onClick={(e) => { if (e.target === e.currentTarget && !enCours) surAnnuler(); }}
      data-dialogue-ia
    >
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl">
        <div className="mb-2 flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
          <h2 className="min-w-0 flex-1 text-sm font-semibold text-slate-50">{donnees.titre}</h2>
          <button type="button" onClick={surAnnuler} disabled={enCours} aria-label={tUi('fermer')} title={tUi('fermer')}
            className="rounded p-1 text-slate-400 hover:text-slate-100 disabled:opacity-40">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-xs font-medium text-slate-200" data-cible>{donnees.cible}</p>
        {donnees.description && <p className="mt-0.5 line-clamp-3 text-[11px] text-slate-400">« {donnees.description} »</p>}

        <ul className="mt-3 space-y-1.5" aria-label={tUi('ce_qui_a_ete_verifie')}>
          {donnees.verifications.map((v, k) => (
            <li key={k} className={`flex items-start gap-2 text-xs leading-snug ${v.etat === 'bloque' ? 'text-amber-200' : v.etat === 'info' ? 'text-slate-400' : 'text-slate-300'}`} data-verif={v.etat}>
              {v.etat === 'bloque' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                : v.etat === 'info' ? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                {v.texte}
                {v.action && (
                  <button type="button" onClick={v.action.surClic} className="ml-2 underline hover:text-slate-100">{v.action.libelle}</button>
                )}
              </span>
            </li>
          ))}
        </ul>

        <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${donnees.payant ? 'border-amber-500/40 bg-amber-500/10 text-amber-100' : 'border-slate-700 bg-slate-950/60 text-slate-300'}`} data-cout>
          {donnees.cout}
        </p>

        {erreur && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200" data-erreur-dialogue>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {erreur}
          </p>
        )}

        <div
          role="group"
          aria-label={donnees.payant ? tUi('confirmer_la_generation_payante') : tUi('confirmer_la_creation_du_visuel_de_dem')}
          className="mt-4 flex flex-wrap items-center justify-end gap-2"
        >
          <button ref={premiereAction} type="button" onClick={surAnnuler} disabled={enCours}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-400 disabled:opacity-40">
            {tUi('annuler')}
          </button>
          <button
            type="button" onClick={confirmer} disabled={bloque || enCours} data-cinema-confirmer
            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enCours ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
            {enCours ? tUi('creation_en_cours') : donnees.libelleConfirmer}
          </button>
        </div>
      </div>
    </div>
  );
}
